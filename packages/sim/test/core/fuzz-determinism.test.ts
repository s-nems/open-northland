import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, JobAssignment, Settler, Sheltering } from '../../src/components/index.js';
import { COMMAND_ISSUER } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  CORE_INVARIANTS,
  type Command,
  checkInvariants,
  exportSaveGame,
  type LoggedCommand,
  type PlayerCommand,
  parseCommandEnvelope,
  parseSaveGame,
  playerCommand,
  Rng,
  replay,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
  setupCommand,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * Seeded command-stream fuzz covers input combinations that curated goldens miss. It checks
 * run-twice hashes, command replay, save round-trips, invariants, and cache coherence. Invalid
 * commands are included so stale targets and rejected orders remain deterministic; generation
 * depends only on its own RNG.
 */

const VIKING = 1;
/** A type id absent from every fixture table - the unknown-id skip path. */
const INVALID_TYPE = 99;
/** A FOOTPRINTED building type added on top of the fixture tables (see {@link fuzzContent}), so the
 *  stream exercises the ground-collision gate and `force`'s collision-skip - random anchors on the
 *  small map often clip the reserved ring off the edge or overlap an earlier house. */
const FOOTPRINTED_TYPE = 5;
/** A HOME building type added on top of the fixture tables (see {@link fuzzContent}) so `assignHouse`
 *  and the family loop reach their ACCEPT paths - without it every fuzzed house assignment dies on the
 *  `builtHomeType` gate and the wedding/birth machinery never runs under the harness. The id must be
 *  FREE in the fixture (9; 1–8 are taken): `contentIndex.buildings` is first-wins, so a shadowed id
 *  would place as this type but resolve to the fixture's entry in every system. */
const HOME_TYPE = 9;
/** The fuzz home's upgrade target (`HOME_TYPE.upgradeTarget`), so `upgradeBuilding` rolls reach the
 *  ACCEPT path: the home re-opens as an upgrade site (stash + separate hold + difference bill) and can
 *  organically finish when the fuzzed stream happens to deliver its wood and hammer it. Id 10 is free. */
const HOME_TIER2_TYPE = 10;
/** The garrison-capable type the harness alarms (see {@link fuzzContent}). Free in the fixture, which
 *  ids 5 and 9 are NOT any more - `contentIndex.buildings` is first-wins, so `footprinted_hut` and
 *  `fuzz_home` currently resolve to the fixture's `farm` and `forge`
 *  (`docs/tickets/sim/fuzz-fixture-type-shadowing.md`). */
const SHELTER_TYPE = 30;
/** The fixture's `food_simple` good - what the fuzz home's larder stocks and the preamble drops. */
const FOOD_GOOD = 3;
/** Building types: HQ / sawmill / temple / tech-gated smithy / footprinted hut / home / unknown. */
const BUILDING_TYPES = [1, 2, 3, 4, FOOTPRINTED_TYPE, HOME_TYPE, INVALID_TYPE] as const;

/** A footprinted RESOURCE good the stream drops at runtime via `placeResource` - reuses the fixture's
 *  wood good (typeId 1, whose felling lifecycle is already modelled), joined to a landscape logic type +
 *  a gfx record carrying a 1-cell walk/build/work footprint. With this, a `placeResource{good:1}` runs
 *  the CREATE path (footprint stamp + the incremental blocked-cell cache) under the fuzzed stream, not
 *  just the skip path; other goods stay footprint-less and skip. Fuzz-local (the golden fixtures stay
 *  untouched - a footprint on a shared good would re-gate their pinned resource placements). */
const RESOURCE_GOOD = 1;
const RESOURCE_LANDSCAPE_TYPE = 20;
const RESOURCE_GFX_INDEX = 200;
/** Every swing frees a unit. */
const SINGLE_STRIKE = 1;

/** The fixture content plus the footprinted hut, the home, the woman job, and the footprinted wood
 *  resource - all fuzz-local so the golden fixtures stay untouched (a footprint on a shared type would
 *  re-gate the goldens' pinned placements; a female slug would re-sex their spawns). */
function fuzzContent() {
  const base = testContent();
  return parseContentSet({
    ...base,
    jobs: [...base.jobs, { typeId: WOMAN_TYPE, id: 'woman' }],
    buildings: [
      ...base.buildings,
      {
        typeId: HOME_TYPE,
        id: 'fuzz_home',
        kind: 'home',
        homeSize: 2,
        // A stocked larder is what arms the birth path.
        stock: [{ goodType: FOOD_GOOD, capacity: 5 }],
        upgradeTarget: HOME_TIER2_TYPE,
      },
      {
        typeId: HOME_TIER2_TYPE,
        id: 'fuzz_home_tier2',
        kind: 'home',
        homeSize: 3,
        stock: [{ goodType: FOOD_GOOD, capacity: 5 }],
        // The upgrade difference bill: 1 wood - deliverable by the fuzzed carriers/drops.
        construction: [{ goodType: RESOURCE_GOOD, amount: 1 }],
      },
      {
        typeId: SHELTER_TYPE,
        id: 'fuzz_shelter',
        kind: 'workplace',
        // The one fuzzed type that takes a garrison, placed in the preamble and alarmed mid-run, so the
        // claim and release protocol interleaves with the fuzzed demolish, upgrade, job-change and kill
        // streams instead of every `setDefenceMode` roll dying on the no-garrison gate.
        shelterCapacity: 2,
      },
      {
        typeId: FOOTPRINTED_TYPE,
        id: 'footprinted_hut',
        kind: 'workplace',
        footprint: {
          blocked: [{ dx: 0, dy: 0 }],
          familyBody: [
            { dx: 0, dy: 0 },
            { dx: 1, dy: 0 },
          ],
          reserved: [-1, 0, 1].flatMap((dy) => [-1, 0, 1, 2].map((dx) => ({ dx, dy }))),
        },
      },
    ],
    landscape: [
      ...base.landscape,
      { typeId: RESOURCE_LANDSCAPE_TYPE, id: 'wood_node', walkable: true, buildable: true },
    ],
    landscapeGfx: [
      ...base.landscapeGfx,
      {
        index: RESOURCE_GFX_INDEX,
        editName: 'fuzz wood node',
        logicType: RESOURCE_LANDSCAPE_TYPE,
        maxValency: 3,
        isWorkable: true,
        // [state, x, y, run] - one blocked cell at the node's own tile (the full-state footprint).
        walkBlockAreas: [[1, 0, 0, 1]],
        buildBlockAreas: [[1, 0, 0, 1]],
        workAreas: [[1, 0, 0, 1]],
      },
    ],
    gatheringPipeline: [
      ...base.gatheringPipeline,
      {
        goodType: RESOURCE_GOOD,
        goodId: 'wood',
        harvestAtomic: 24,
        bioLandscape: true,
        harvest: { landscapeType: RESOURCE_LANDSCAPE_TYPE, gfxIndices: [RESOURCE_GFX_INDEX] },
      },
    ],
  });
}
/** A `woman`-slug job added on top of the fixture tables (see {@link fuzzContent}): a spawn with it
 *  stamps {@link import('../../src/components/index.js').Female}, so `marry` can find opposite-sex
 *  pairs and `makeChild`/the hoard rung run their accept paths - the fixture's own jobs are all male. */
const WOMAN_TYPE = 7;
/** Job types: idle / woodcutter / carpenter / hunter / scout / carrier / woman / unknown. */
const JOB_TYPES = [0, 1, 2, 15, 27, 36, WOMAN_TYPE, INVALID_TYPE] as const;
/** Herd tribes: bear pack / bee / boar / cow / deer, the hitpoints-0 decorative butterfly (spawns
 *  nothing), plus two non-animals (viking, unknown) - skipped. */
const HERD_TRIBES = [10, 11, 12, 13, 14, 15, VIKING, INVALID_TYPE] as const;
/** The viking woodcutter's weapon (test_axe) and leather armor - the combatant-spawn extras. */
const AXE = 7;
const LEATHER = 1;
const COMBATANT_HITPOINTS = 500;
// The worn goods some spawn rolls stamp. All three resolve in `fuzzContent()`, so the effects that
// read the content class - boots speed + walking wear, the tool credit + per-cycle wear, an auto-drunk
// mead and the healing death save - actually run under the stream instead of short-circuiting on an
// unknown good.
const SHOES_GOOD = 8;
const MEAD_GOOD = 13;
const HEAL_POTION_GOOD = 16;
const MAX_USE_PCT = 100;
/** The fixture's wooden tool - the good a fighter may not wear, worn by some spawn rolls so the
 *  enlist shed (join-the-hands, ground drop, part-used destroy) runs mid-stream. */
const TOOL_GOOD = 11;
/** An equip id no fixture good defines: the unknown-good skip path of the order validation. */
const UNKNOWN_EQUIP_GOOD = 30;
/** Equip-order slot groups: the five valid categories the `equipGood`/`unequipGood` rolls draw from. */
const EQUIP_GROUPS = ['boots', 'tool', 'weapon', 'armor', 'misc'] as const;
/** Equip-order goods: the fixture's equippables (shoes/sword/fur_boots/wooden tool), a non-equippable
 *  (wood), an id outside the fixture and a wild invalid one - the accept + every skip path of the
 *  `equipGood` validation, the tool including the fighter-refusal and the shed-on-enlist branches. */
const EQUIP_ORDER_GOODS = [
  SHOES_GOOD,
  9,
  10,
  TOOL_GOOD,
  RESOURCE_GOOD,
  UNKNOWN_EQUIP_GOOD,
  INVALID_TYPE,
] as const;
/** Owner slots: two valid players + one out-of-range (rejects the whole command) - exercises the
 *  command system's owner-field check. */
const OWNERS = [0, 1, 99] as const;
/** The seat the stream's player envelopes claim - the preamble's owner, so a share of them reach the
 *  gate's ACCEPT branch instead of only its refusals. */
const FUZZ_SEAT = 0;
/** The first tick the harness raises its scripted alarms on, and how often it puts them back up. Raising
 *  once is not enough: the stream's own alarm flips (case 43) and a seat handed to the strategic AI - which
 *  stands its town back up when it sees no enemy (`ai-player/military/defence/alarm.ts`) - both take a
 *  raised alarm off again, and a seed that lost it before any civilian claimed would quietly turn the whole
 *  defence half of the stream into a skip path. A raise on an already-alarmed building is a no-op, so the
 *  cadence perturbs nothing on its own. */
const ALARM_RAISED_FROM = 200;
const ALARM_RERAISE_EVERY = 20;
/** Military-mode ids: the five valid `MILITARY_MODE`s + one out-of-range (skipped) - exercises `setStance`. */
const STANCE_MODES = [0, 1, 2, 3, 4, 7] as const;
/** Fog modes: the three valid `FOG_MODE`s + one out-of-range (skipped) - exercises `setFogMode`, the
 *  VisionSystem's rebuild/downgrade/reset paths, and the fog-mask bytes `hashState` mixes in. */
const FOG_MODES = [0, 1, 2, 9] as const;
/** Entity-targeting commands draw ids from [1, TARGET_ID_RANGE] - live, dead, and never-created. */
const TARGET_ID_RANGE = 80;
/** The AIMED family commands (rolls 24–26) draw ids from [1, NUCLEUS_ID_RANGE] instead - the band the
 *  {@link runFuzz} preamble's home + six adults land in (plus early stream spawns/buildings, so
 *  wrong-kind and same-sex skips stay in the mix). The wide-range variants (rolls 21–23) alone
 *  virtually never hit an eligible target in a 300-tick stream, leaving the wedding/household/birth
 *  machinery - RNG-consuming, mid-tick-spawning, the likeliest desync source - fuzz-untouched. */
const NUCLEUS_ID_RANGE = 8;
/** ~1 command every this-many ticks keeps the stream busy without swamping the map. */
const COMMAND_EVERY = 4;
/** Hash checkpoint cadence - a run-twice divergence is localized to a 50-tick window. The save
 *  self-check round-trips at the same points, so its cost stays a dozen exports per run. */
const CHECKPOINT_EVERY = 50;

// A 12×12-CELL map - the graph is its 24×24 half-cell lattice, and command coords draw from the
// full NODE range so the fuzz exercises off-centre anchors (buildings/spawns on any half-cell).
const MAP_W = 12;
const MAP_H = 12;
const NODE_W = MAP_W * 2;
const NODE_H = MAP_H * 2;
/** The anchor {@link runFuzz}'s preamble builds its home on - the one node an authored attachment can bind
 *  to before the stream places anything. */
const PREAMBLE_HOME_NODE = { x: 10, y: 10 } as const;
/** The trade the preamble's attached settler spawns in: the one worker slot the type at
 *  {@link PREAMBLE_HOME_NODE} resolves to, since an attachment is only ever posted in its own trade. */
const ATTACH_TRADE = 2;
/** The preamble's attached settler: the last entity it creates. The attach assertion pins the id, so a
 *  preamble that grows another entity fails loudly here rather than quietly stopping the coverage. */
const ATTACHED_SETTLER = 11 as Entity;
const FUZZ_SEEDS = [11, 29, 47] as const;
const TICKS = 600;

function pick<T>(rng: Rng, options: readonly T[]): T {
  const v = options[rng.int(options.length)];
  if (v === undefined) throw new Error('pick from empty options');
  return v;
}

/** One random command - a pure function of `rng` alone (NEVER world state; see the module doc). */
function nextCommand(rng: Rng): Command {
  const x = rng.int(NODE_W);
  const y = rng.int(NODE_H);
  // Every roll is an explicit case, so a modulus that drifts past the case list throws below instead
  // of silently dropping a command kind from the stream.
  const roll = rng.int(46);
  switch (roll) {
    case 31:
      // An AI-seat flip: valid players (the AiPlayer carrier created/updated/destroyed - the
      // AiPlayerSystem then runs its cadence over the seat) + an out-of-range one (skipped, still
      // logged). Sometimes with a partial module override - the full-record fill must hash and
      // replay identically.
      return {
        kind: 'setPlayerAi',
        player: pick(rng, OWNERS),
        enabled: rng.int(2) === 0,
        ...(rng.int(3) === 0
          ? { modules: { military: rng.int(2) === 0, houseBuild: rng.int(2) === 0 } }
          : {}),
      };
    case 24:
      // A marry order at a random id: live adults, children, already-married, unowned/dead targets.
      return { kind: 'marry', entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity };
    case 25:
      // A house assignment at random ids: real homes, wrong-kind buildings, settlers-as-house, dead ids.
      return {
        kind: 'assignHouse',
        entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        house: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
      };
    case 26:
      // A make-child order at a random id: women/men/children/unmarried - mostly no-ops, all replayable.
      return {
        kind: 'makeChild',
        entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        child: pick(rng, ['female', 'male'] as const),
      };
    case 33:
      // A house un-assignment at a random id: real housed families, unhoused adults, children,
      // unowned/dead targets - mostly no-ops, all replayable.
      return { kind: 'unassignHouse', entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity };
    case 34:
      // An AIMED house un-assignment - likely to hit a nucleus adult the stream's assignHouse rolls housed.
      return { kind: 'unassignHouse', entity: (rng.int(NUCLEUS_ID_RANGE) + 1) as Entity };
    case 27:
      // An AIMED marry (see NUCLEUS_ID_RANGE) - likely to hit a live adult and actually start a wedding.
      return { kind: 'marry', entity: (rng.int(NUCLEUS_ID_RANGE) + 1) as Entity };
    case 28:
      // An AIMED house assignment - likely to bind a nucleus adult to the preamble's built home.
      return {
        kind: 'assignHouse',
        entity: (rng.int(NUCLEUS_ID_RANGE) + 1) as Entity,
        house: (rng.int(NUCLEUS_ID_RANGE) + 1) as Entity,
      };
    case 29:
      // An AIMED make-child order - accepted once a nucleus wife is married (the stream's weddings).
      return {
        kind: 'makeChild',
        entity: (rng.int(NUCLEUS_ID_RANGE) + 1) as Entity,
        child: pick(rng, ['female', 'male'] as const),
      };
    case 0:
      return {
        kind: 'placeBuilding',
        buildingType: pick(rng, BUILDING_TYPES),
        x,
        y,
        tribe: VIKING,
        ...(rng.int(3) === 0 ? { underConstruction: true } : {}),
        ...(rng.int(2) === 0 ? { owner: pick(rng, OWNERS) } : {}),
        // Occasionally an authored-import-style forced placement (skips the tech/collision gates).
        ...(rng.int(4) === 0 ? { force: true } : {}),
        // Occasionally an authored pre-stocked placement (every stock slot seeded to capacity).
        ...(rng.int(4) === 0 ? { fillStock: true } : {}),
        // Occasionally an authored starting stock (a decoded map's `addgoods` import).
        ...(rng.int(4) === 0 ? { initialGoods: [{ good: MEAD_GOOD, amount: rng.int(20) + 1 }] } : {}),
      };
    case 1: {
      // Every third settler is a combatant (Health + armor + a specific weapon + a walk pace) so the
      // fuzz reaches the combat/movement stamps, not just the economy.
      const combatant = rng.int(3) === 0;
      return {
        kind: 'spawnSettler',
        jobType: pick(rng, JOB_TYPES),
        x,
        y,
        tribe: VIKING,
        ...(combatant
          ? { hitpoints: COMBATANT_HITPOINTS, armorClass: LEATHER, weaponTypeId: AXE, moveSpeed: 4 }
          : {}),
        // Occasionally the settler also wears equipment (an `Equipment` stamp) - the used-up percent
        // varies with the rng so the pct→Fixed conversion is fuzzed for run-twice + replay equality.
        ...(rng.int(3) === 0
          ? {
              equipment: {
                boots: { goodType: SHOES_GOOD, degreeOfUsePct: rng.int(MAX_USE_PCT + 1) },
                tool: { goodType: TOOL_GOOD, degreeOfUsePct: rng.int(MAX_USE_PCT + 1) },
                misc: [
                  { goodType: MEAD_GOOD, degreeOfUsePct: rng.int(MAX_USE_PCT + 1) },
                  { goodType: HEAL_POTION_GOOD, degreeOfUsePct: rng.int(MAX_USE_PCT + 1) },
                ],
              },
            }
          : {}),
        ...(rng.int(2) === 0 ? { owner: pick(rng, OWNERS) } : {}),
        // Occasionally spawn a veteran (starting XP pairs) - the experience stamp must hash and
        // replay identically.
        ...(rng.int(4) === 0 ? { experience: [[rng.int(8), 1 + rng.int(200)]] as const } : {}),
        // Occasionally an authored gatherer resource pick (a decoded map's `setproducedgood`): the
        // harvestable wood good - a stamp only the gatherer trades in JOB_TYPES take - or an unknown
        // good the handler must reject. Both branches must hash and replay identically.
        ...(rng.int(4) === 0 ? { gatherGood: rng.int(2) === 0 ? RESOURCE_GOOD : INVALID_TYPE } : {}),
        // Occasionally an authored house attachment (a decoded map's `attachtohouse`), aimed at the
        // preamble's building or at a free node. Both shapes must hash and replay identically; the
        // preamble's own attached spawn is what covers the ACCEPT path.
        ...(rng.int(4) === 0
          ? { home: rng.int(2) === 0 ? PREAMBLE_HOME_NODE : { x: rng.int(NODE_W), y: rng.int(NODE_H) } }
          : {}),
        ...(rng.int(4) === 0
          ? {
              workplace: rng.int(2) === 0 ? PREAMBLE_HOME_NODE : { x: rng.int(NODE_W), y: rng.int(NODE_H) },
            }
          : {}),
      };
    }
    case 2:
      // Occasionally the count override (a map's one-record spawn), including the 0/negative shapes
      // the clamp must floor to one creature - both must hash and replay identically.
      return {
        kind: 'spawnAnimalHerd',
        tribe: pick(rng, HERD_TRIBES),
        x,
        y,
        ...(rng.int(3) === 0 ? { count: pick(rng, [0, 1, 2, -5] as const) } : {}),
      };
    case 3:
      // The fixture ships no vehicles, so EVERY placeBoat is the skipped-but-logged path - replay
      // must reproduce the same state through a log full of no-op commands.
      return {
        kind: 'placeBoat',
        vehicleType: pick(rng, [1, INVALID_TYPE]),
        x,
        y,
        tribe: VIKING,
        ...(rng.int(2) === 0 ? { owner: pick(rng, OWNERS) } : {}),
      };
    case 4:
      // Random target ids hit live buildings, live NON-buildings (settlers, herds - must be
      // skipped), dead entities, and ids never created. All four must resolve deterministically.
      return { kind: 'demolish', building: (rng.int(TARGET_ID_RANGE) + 1) as Entity };
    case 5:
      // A move order at a random id: hits owned settlers (obeyed), unowned settlers / buildings /
      // dead ids (skipped). Exercises the moveUnit skip paths + the PlayerOrder timed override.
      return { kind: 'moveUnit', entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity, x, y };
    case 6:
      // An attack order at two random ids: hits owned combatants (obeyed → AttackOrder + chase),
      // non-combatant / unowned / dead issuers (skipped) and live/dead/non-combatant targets. Exercises
      // the attackUnit skip paths + the combat engagement drive under a fuzzed stream.
      return {
        kind: 'attackUnit',
        entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        target: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
      };
    case 7:
      // A stance change at a random id: valid + out-of-range modes, owned/unowned/dead targets.
      // Exercises the setStance skip paths + the stance-gated engagement/flee drives under a fuzzed stream.
      return {
        kind: 'setStance',
        entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        mode: pick(rng, STANCE_MODES),
      };
    case 8: {
      // A resource node dropped at a random tile: good 1 (wood - FOOTPRINTED, so the create path runs:
      // footprint stamp + the incremental blocked-cell cache, including overlap counts when nodes stack)
      // and good 4 / unknown (no footprint → the skip path, still logged). One lifecycle marker per node
      // (tree / deposit / pluck-whole) - mutually exclusive, per the command contract.
      const life = rng.int(3);
      return {
        kind: 'placeResource',
        good: pick(rng, [RESOURCE_GOOD, 4, INVALID_TYPE]),
        x,
        y,
        remaining: rng.int(6) + 1,
        harvestAtomic: 24,
        ...(life === 0 ? { felling: { chopsLeft: rng.int(4) + 1 } } : {}),
        ...(life === 1 ? { deposit: { levels: rng.int(4) + 1, strikesPerUnit: SINGLE_STRIKE } } : {}),
      };
    }
    case 9:
      // A worker assignment at two random ids: owned settlers bound to live buildings (obeyed when the
      // building has an open slot), plus non-settler/unowned/dead issuers and non-building/full/dead
      // targets. Exercises the assignWorker skip paths + the JobAssignment binding under a fuzzed stream.
      return {
        kind: 'assignWorker',
        entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        building: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        // A fuzzed preference list (0..2 job ids, valid + unknown) - exercises the priority walk, the
        // building-doesn't-offer skip, and the empty-list no-op path.
        jobPriority: Array.from({ length: rng.int(3) }, () => pick(rng, JOB_TYPES)),
      };
    case 10:
      // A loose good pile dropped at a random tile: good 1 (wood - in the catalog, so the CREATE path runs:
      // a bare Stockpile+Position loose pile, NO GroundDrop, that rests in place) and an unknown good / a
      // zero amount (the skip path, still logged). Exercises `dropGood` under the fuzzed stream.
      return {
        kind: 'dropGood',
        good: pick(rng, [RESOURCE_GOOD, INVALID_TYPE]),
        x,
        y,
        amount: rng.int(4), // 0..3 - 0 hits the non-positive-amount skip
      };
    case 11:
      // A work-flag order at a random id + tile: hits owned gatherers (a flag is created, then relocated on
      // a repeat), non-gatherer / unowned / dead ids (skipped). Exercises setWorkFlag's create/move/skip
      // paths - including a WorkFlag/DeliveryFlag entity conjured mid-stream, whose delivery then spreads a
      // yard heap the drop/reap machinery must handle.
      return { kind: 'setWorkFlag', entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity, x, y };
    case 12:
      // The global needs toggle: flips the WorldRules singleton mid-stream (creating it on first use),
      // freezing/unfreezing needs + starvation - the world-scope rule must hash and replay like any state.
      return { kind: 'setNeedsEnabled', enabled: rng.int(2) === 0 };
    case 13:
      // Debug kill at a random id: hits live settlers/animals (Health drained → reaped next tick), plus
      // non-settlers (buildings, incl. under-construction ones that carry Health) / dead / never-created
      // ids (gated out by the Settler check → skipped). All resolve deterministically.
      return { kind: 'debugKill', target: (rng.int(TARGET_ID_RANGE) + 1) as Entity };
    case 14:
      // Debug needs at a random id: owned/unowned settlers (fields set) + non-settler/dead ids (skipped).
      // Each need is present only sometimes, at a fuzzed percent → the pct→Fixed conversion is fuzzed for
      // run-twice + replay equality, the same way the equipment degree-of-use is above.
      return {
        kind: 'debugSetNeeds',
        target: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        ...(rng.int(2) === 0 ? { hunger: rng.int(101) } : {}),
        ...(rng.int(2) === 0 ? { fatigue: rng.int(101) } : {}),
        ...(rng.int(2) === 0 ? { piety: rng.int(101) } : {}),
        ...(rng.int(2) === 0 ? { enjoyment: rng.int(101) } : {}),
      };
    case 15:
      // Debug fill-stockpile at a random id: hits live buildings (every stock slot maxed) + non-building /
      // dead ids (skipped). Exercises the type-slot fill + the wrong-kind no-op under the fuzzed stream.
      return { kind: 'debugFillStockpile', target: (rng.int(TARGET_ID_RANGE) + 1) as Entity };
    case 16:
      // Debug complete-construction at a random id: hits construction sites (forced to built + event) +
      // built/non-building/dead ids (skipped - no UnderConstruction marker). Exercises the force-finish.
      return { kind: 'debugCompleteConstruction', target: (rng.int(TARGET_ID_RANGE) + 1) as Entity };
    case 17:
      // The fog-of-war mode: flips the FogRules singleton mid-stream across all three modes (plus an
      // invalid one - the skip path). Exercises the VisionSystem's RECON rebuild/downgrade,
      // sticky REVEAL, the OFF reset, the combat/flee fog gates, and the mask bytes in hashState.
      return { kind: 'setFogMode', mode: pick(rng, FOG_MODES) };
    case 18:
      // A builder assignment at two random ids: owned builders pinned to live construction sites
      // (obeyed → a pinned SiteAssignment), plus non-settler/unowned/dead issuers, non-builder trades,
      // and built/non-building/dead targets. Exercises the assignBuilder skip paths + the pinned-site
      // preference in planBuilder under a fuzzed stream.
      return {
        kind: 'assignBuilder',
        entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        site: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
      };
    case 19:
      // A gatherer-filter order at a random id: valid wood, invalid/unsupported goods, and null (all),
      // against live gatherers plus wrong-kind/unowned/dead targets. The command must hash and replay even
      // when validation turns it into a no-op.
      return {
        kind: 'setGatherGood',
        entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        goodType: pick(rng, [null, RESOURCE_GOOD, 4, INVALID_TYPE]),
      };
    case 20:
      // A craft-selection order at a random id: empty (all-products reset), single and multi-good picks,
      // duplicates, and invalid goods - against bound craft workers plus unemployed/wrong-kind/dead
      // targets. The command must hash and replay even when validation turns it into a no-op.
      return {
        kind: 'setCraftGoods',
        entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        goods: Array.from({ length: rng.int(3) }, () => pick(rng, [RESOURCE_GOOD, 4, 2, INVALID_TYPE])),
      };
    case 21:
      // A signpost order at a random id + tile: hits owned scouts (walk + hammer + a Signpost entity
      // conjured mid-stream, feeding the network memo, the placement blockers, and the vision stamp),
      // plus non-scout / unowned / dead issuers and illegal spots (skipped). Exercises the placeSignpost
      // create/skip paths, the spacing gate, and the erect order's abandon paths.
      return { kind: 'placeSignpost', entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity, x, y };
    case 22:
      // The signpost-navigation toggle: flips the SignpostRules singleton mid-stream, confining/freeing
      // every civilian's target scans + move orders - the rule must hash and replay like any state.
      return { kind: 'setSignpostNavigation', enabled: rng.int(2) === 0 };
    case 23:
      // A signpost tear-down at a random id: live signposts (destroyed - the network memo, blockers, and
      // vision must all re-derive) and non-signpost / dead targets (skipped).
      return { kind: 'demolishSignpost', signpost: (rng.int(TARGET_ID_RANGE) + 1) as Entity };
    case 35:
      // The profession-progression toggle: flips the ProgressionRules singleton mid-stream, lifting and
      // restoring the needfor*/jobEnables gates on staffing, harvest picks, and AI collector re-posts -
      // the rule must hash and replay like any state (the setSignpostNavigation pattern).
      return { kind: 'setProfessionProgression', enabled: rng.int(2) === 0 };
    case 30:
      // An upgrade order at a random id: built chained homes (re-opened as an upgrade site - stash,
      // separate hold, difference bill), plus unbuilt sites / top-tier or unchained types / non-building
      // / dead ids (skipped). Exercises the upgradeBuilding accept + skip paths, the Upgrading stash in
      // hashState, and the upgrade-finish flip when the stream feeds the site.
      return { kind: 'upgradeBuilding', building: (rng.int(TARGET_ID_RANGE) + 1) as Entity };
    case 32:
      // An upgrade abort at a random id: live upgrade sites (stash restored, site hold discarded,
      // `built` back to ONE - the markers must come off in hashState), plus plain construction sites /
      // built buildings / non-building / dead ids (skipped). Exercises the cancelUpgrade accept + skip
      // paths against the upgradeBuilding rolls above.
      return { kind: 'cancelUpgrade', building: (rng.int(TARGET_ID_RANGE) + 1) as Entity };
    case 36:
      // An equip order at a random id: valid, mismatched-category, unknown and non-equippable goods
      // against slot addresses on and past both ends of the valid band - live settlers (an errand walks
      // out mid-stream), children, jobless, unowned/dead targets. Must hash and replay whether it
      // stamps an errand or validation turns it into a no-op.
      return {
        kind: 'equipGood',
        entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        group: pick(rng, EQUIP_GROUPS),
        slot: rng.int(6) - 1,
        goodType: pick(rng, EQUIP_ORDER_GOODS),
      };
    case 37:
      // The take-off twin: mostly empty-slot skips, an occasional live take-off against the spawn
      // rolls' worn boots/mead (the stow/return legs then run mid-stream).
      return {
        kind: 'unequipGood',
        entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        group: pick(rng, EQUIP_GROUPS),
        slot: rng.int(6) - 1,
      };
    case 38:
      // An assistant-grant flip: valid players (the AssistantGrants carrier created/updated/
      // destroyed, and the dispatch pre-pass then hands gear out mid-stream) + an out-of-range one
      // (skipped, still logged); wearable, non-wearable and unknown goods hit every validation path.
      return {
        kind: 'setAssistantGrant',
        player: pick(rng, OWNERS),
        goodType: pick(rng, EQUIP_ORDER_GOODS),
        enabled: rng.int(2) === 0,
      };
    case 39:
      // A profession change at a random id: valid + unknown jobs, owned/unowned/dead targets.
      return {
        kind: 'setJob',
        entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        jobType: pick(rng, JOB_TYPES),
      };
    case 40:
      // A barracks drill order at two random ids: the handler's skip paths (dead/stale issuer, a woman
      // or child, a house that is not a barracks, another tribe's or side's, a re-issue on the same
      // house) plus the drill rung itself under a fuzzed stream.
      return {
        kind: 'trainSoldier',
        entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        house: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
      };
    case 41:
      // An assistant counter write: valid + out-of-range players and values (the clamp), every kind,
      // and the infinite flag - the carrier lifecycle plus the birth/drill dispatchers and the
      // recruit-arming pass (the sim's one new rng draw) then run under the fuzzed stream.
      return {
        kind: 'setAssistantCounter',
        player: pick(rng, OWNERS),
        counter: pick(rng, [
          'extraWomen',
          'extraMen',
          'trainSoldiers',
          'trainSword',
          'trainSpear',
          'trainBow',
        ] as const),
        value: rng.int(140) - 20,
        infinite: rng.int(4) === 0,
      };
    case 42:
      // An attack-move at a random id: the moveUnit skip paths again, plus the march itself - a walk that
      // keeps the combat drives live, so a fuzzed stream interleaves it with engagement, chases and deaths
      // (the resume-after-the-fight state must hash and replay identically).
      return { kind: 'attackMoveUnit', entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity, x, y };
    case 43:
      // An alarm flip at a random id: the handler's skip paths (dead/stale/non-building/unowned, a type
      // with no garrison, a site) plus defence mode itself - so the claim/release protocol interleaves
      // with demolish, upgrade, job changes and kills under a fuzzed stream.
      return {
        kind: 'setDefenceMode',
        building: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        enabled: rng.int(2) === 0,
      };
    case 44:
      // A worker release at a random id: the posts the stream's case-9 assignments made (a mid-craft
      // producer, a carrier mid-run, a garrison stepping off its tower), plus unposted / child / woman /
      // unowned / dead targets. Exercises the unassignWorker skip paths and the unbind under the stream.
      return { kind: 'unassignWorker', entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity };
    case 45:
      // A diplomacy stance flip on a random directed pair: valid slots mutate the DiplomacyRules
      // singleton mid-stream - flipping who the combat drives may engage - and the out-of-range slot
      // hits the skip path. The table must hash and replay like any state.
      return {
        kind: 'setDiplomacy',
        from: pick(rng, OWNERS),
        to: pick(rng, OWNERS),
        state: pick(rng, ['friend', 'neutral', 'enemy'] as const),
      };
    default:
      throw new Error(`fuzz roll ${roll} has no case: widen the switch or the modulus above`);
  }
}

function issuableBySeat(command: Command): command is PlayerCommand {
  return COMMAND_ISSUER[command.kind] === 'seat';
}

/**
 * Submit one generated command the way an untrusted one arrives: JSON round-tripped and parsed, so the
 * per-kind payload contract is fuzzed alongside the handlers. A coin flip decides between a player
 * envelope, which also fuzzes the authority gate's seat branch, and trusted setup, without which the
 * authored-only placement options and the other-owner commands would stop reaching their handlers.
 */
function submit(sim: Simulation, gen: Rng, command: Command): void {
  const seat = gen.int(2) === 0 && issuableBySeat(command);
  const envelope = seat ? playerCommand(FUZZ_SEAT, command) : setupCommand(command);
  sim.enqueue(parseCommandEnvelope(JSON.parse(JSON.stringify(envelope))));
}

interface FuzzRun {
  readonly finalHash: string;
  /** `hashState()` at every CHECKPOINT_EVERY-th tick - localizes a run-twice divergence. */
  readonly checkpoints: readonly string[];
  readonly violations: readonly string[];
  readonly log: readonly LoggedCommand[];
  /** Whether any tick of the run had a civilian holding a shelter claim - the coverage the scripted alarm
   *  buys, pinned so a content or gate change cannot quietly turn the defence half of the stream into a
   *  skip path. */
  readonly sheltered: boolean;
  /** Whether the preamble's authored attachment actually took a post - pinned so a gate change cannot
   *  quietly turn every attached spawn in the stream into a refusal. */
  readonly attachedToWork: boolean;
}

/** Export → parse → restore at a live checkpoint: the restored sim must hash exactly like the live
 *  one and re-export the same bytes. */
function assertSaveRoundTrip(sim: Simulation, liveHash: string, content: ContentSet): void {
  const bytes = serializeSaveGame(exportSaveGame(sim));
  const restored = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
    content,
    map: grassMap(MAP_W, MAP_H),
  }).sim;
  if (restored.hashState() !== liveHash) {
    throw new Error(`tick ${sim.tick}: the restored sim hashes differently from the live one`);
  }
  if (serializeSaveGame(exportSaveGame(restored)) !== bytes) {
    throw new Error(`tick ${sim.tick}: the restored sim re-exports different bytes`);
  }
}

function runFuzz(fuzzSeed: number, ticks: number, opts: { saveRoundTrip?: boolean } = {}): FuzzRun {
  const content = fuzzContent();
  const sim = new Simulation({ seed: fuzzSeed, content, map: grassMap(MAP_W, MAP_H) });
  // A fixed family nucleus ahead of the stream - a built home and three owned couples-to-be - so the
  // AIMED family rolls (24–26) have eligible targets and the wedding → household → child machinery runs
  // under the fuzz harness. Part of the input by construction (identical for both live runs), and
  // recorded in the log like every command, so replay fidelity covers it too.
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HOME_TYPE, x: 10, y: 10, tribe: VIKING, owner: 0 });
  for (let i = 0; i < 3; i++) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOMAN_TYPE,
      x: 6 + 4 * i,
      y: 6,
      tribe: VIKING,
      owner: 0,
    });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: 0, x: 6 + 4 * i, y: 14, tribe: VIKING, owner: 0 });
  }
  // A settler carrying both authored attachment anchors, so the attach ACCEPT path runs on every seed
  // instead of waiting for the stream to roll one at a valid owner. Fixed input, logged like every
  // command, so replay fidelity covers it.
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: ATTACH_TRADE,
    x: 12,
    y: 12,
    tribe: VIKING,
    owner: 0,
    home: PREAMBLE_HOME_NODE,
    workplace: PREAMBLE_HOME_NODE,
  });
  // The match over the two valid owner slots plus the invalid one: the MatchRules singleton rides the
  // hash and the save round trip under the stream. Declared last, so the pinned attached id above holds;
  // the run ends before the first death check, so nobody is refused.
  sim.enqueueSetup({ kind: 'setMatchParticipants', players: [...OWNERS] });
  // Loose food outside the home - the source the housed women's hoard rung and a child order's haul
  // stage draw from.
  sim.enqueueSetup({ kind: 'dropGood', good: FOOD_GOOD, x: 14, y: 10, amount: 5 });
  // The garrison building the scripted alarm below raises, placed last so the fixed ids above hold.
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: SHELTER_TYPE,
    x: 16,
    y: 16,
    tribe: VIKING,
    owner: 0,
  });
  // An independent generator stream (any fixed derivation of the fuzz seed works - it only must
  // differ from the sim's seed so the two streams aren't trivially correlated).
  const gen = new Rng(fuzzSeed ^ 0x5eed);
  const checkpoints: string[] = [];
  const violations: string[] = [];
  let sheltered = false;
  let attachedToWork = false;
  for (let t = 0; t < ticks; t++) {
    // House one nucleus woman and man on the second tick (ids are monotonic from 1: the home, then the
    // six spawns in order). Not in the preamble: the home's `built` flips within tick 1's system run,
    // AFTER that tick's commands applied, so a tick-1 assignHouse dies on the built gate. Fixed input,
    // logged like every command - replay fidelity covers it.
    if (t === 1) {
      sim.enqueueSetup({ kind: 'assignHouse', entity: 2 as Entity, house: 1 as Entity });
      sim.enqueueSetup({ kind: 'assignHouse', entity: 3 as Entity, house: 1 as Entity });
      sim.enqueueSetup({ kind: 'marry', entity: 2 as Entity });
    }
    // A child order for the housed wife once her scripted wedding has had time to finish - arms the
    // stock-the-larder → wait-inside → MakingLove → birth stages under the stream's interference (a
    // seed where the wedding hasn't completed just exercises the unmarried skip instead).
    if (t === 150) sim.enqueueSetup({ kind: 'makeChild', entity: 2 as Entity, child: 'female' });
    // Raise the alarm on the shelter and on the nucleus home once they stand, so every seed runs the
    // shelter drive and the release pass for real; the stream's own alarm flips (case 43) then interleave
    // with it. The shelter is found by type rather than by a hard-coded id - the preamble's entity order is
    // already load-bearing enough.
    if (t >= ALARM_RAISED_FROM && (t - ALARM_RAISED_FROM) % ALARM_RERAISE_EVERY === 0) {
      for (const e of sim.world.query(Building)) {
        if (sim.world.get(e, Building).buildingType === SHELTER_TYPE) {
          sim.enqueueSetup({ kind: 'setDefenceMode', building: e, enabled: true });
        }
      }
      sim.enqueueSetup({ kind: 'setDefenceMode', building: 1 as Entity, enabled: true });
    }
    if (gen.int(COMMAND_EVERY) === 0) submit(sim, gen, nextCommand(gen));
    sim.step();
    // A per-tick snapshot populates the clone cache, arming the cachesCoherent invariant's stale-clone
    // verifier against any system write that bypassed the tracked seam. A pure read: hashes unaffected.
    sim.snapshot();
    if (violations.length === 0) {
      const v = checkInvariants(sim.world, sim.content, CORE_INVARIANTS);
      if (v.length > 0) violations.push(`tick ${sim.tick}: ${v.join('; ')}`);
    }
    if (!sheltered) for (const _ of sim.world.query(Sheltering)) sheltered = true;
    // Latched, not read at the end: the stream is free to kill or demolish its way out of the post. The
    // trade check keeps a drifted id from latching on some other settler the stream happened to employ.
    if (!attachedToWork && sim.world.tryGet(ATTACHED_SETTLER, Settler)?.jobType === ATTACH_TRADE) {
      attachedToWork = sim.world.has(ATTACHED_SETTLER, JobAssignment);
    }
    if (sim.tick % CHECKPOINT_EVERY === 0) {
      const hash = sim.hashState();
      checkpoints.push(hash);
      if (opts.saveRoundTrip === true) assertSaveRoundTrip(sim, hash, content);
    }
  }
  // The log is plain data owned by this sim instance - copy the array so it outlives store reuse.
  return {
    finalHash: sim.hashState(),
    checkpoints,
    violations,
    sheltered,
    attachedToWork,
    log: [...sim.commands.log],
  };
}

/** The per-tick snapshot+verifier pass makes a fuzz run integration-priced; headroom for a loaded box. */
const FUZZ_TIMEOUT_MS = 60_000;

describe('fuzz: randomized command streams stay deterministic, replayable, and invariant-clean', () => {
  for (const seed of FUZZ_SEEDS) {
    it(`seed ${seed}: two live runs are byte-identical and invariant-clean`, {
      timeout: FUZZ_TIMEOUT_MS,
    }, () => {
      // Only run `a` save-round-trips, so the checkpoint equality below additionally proves the
      // export/restore cycle never perturbs the live sim it snapshots.
      const a = runFuzz(seed, TICKS, { saveRoundTrip: true });
      const b = runFuzz(seed, TICKS);
      expect(a.sheltered).toBe(true); // the stream really reached defence mode, not just its skip paths
      expect(a.attachedToWork).toBe(true); // and the authored attachment really bound, not just refused
      expect(a.violations).toEqual([]);
      expect(b.violations).toEqual([]);
      // Checkpoint-wise equality first: on a divergence the failing index names the 50-tick window.
      expect(b.checkpoints).toEqual(a.checkpoints);
      expect(b.finalHash).toBe(a.finalHash);
    });

    it(`seed ${seed}: replaying the recorded log reproduces the final state`, {
      timeout: FUZZ_TIMEOUT_MS,
    }, () => {
      const live = runFuzz(seed, TICKS);
      expect(live.log.length).toBeGreaterThan(0); // the stream actually exercised the command seam
      const replayed = replay({
        content: fuzzContent(),
        seed,
        map: grassMap(MAP_W, MAP_H),
        log: live.log,
        untilTick: TICKS, // run the full recorded duration, incl. ticks after the last command
      });
      expect(replayed.hashState()).toBe(live.finalHash);
    });
  }
});
