import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/ecs/world.js';
import {
  CORE_INVARIANTS,
  type Command,
  checkInvariants,
  type LoggedCommand,
  Rng,
  replay,
  Simulation,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * COMMAND-STREAM FUZZ — the "desync hunter" the golden tests can't be. The goldens pin ONE curated
 * scenario; nondeterminism and command-validation bugs hide in the input space they never
 * construct. This suite drives the real `step()` schedule with SEEDED-RANDOM command streams —
 * including deliberately INVALID commands (unknown type ids, stale/wrong-kind entity targets,
 * tech-gated placements) — and asserts the three properties every stream must hold:
 *
 *  1. **run-twice determinism** — two live runs from the same seeds are byte-identical, checked at
 *     hash checkpoints through the run (not just the end, so a divergence names its window);
 *  2. **replay fidelity** — replaying the recorded command log reproduces the live run's final hash
 *     (the log really IS the save format, for arbitrary streams, skipped-bad-commands included);
 *  3. **invariants + cache coherence every tick** — no stream may drive the world into an invalid
 *     state, and every incrementally-maintained cache re-derives clean (`cachesCoherent`).
 *
 * Invalid commands are IN the stream on purpose: in lockstep any peer can send anything, and a
 * command's target can die between issue and apply — rejection must happen at EXECUTION time,
 * deterministically and identically on every peer, so the fuzzer exercises the skip paths as
 * first-class inputs.
 *
 * The generator is a pure function of its OWN Rng (never of world state): both live runs and the
 * replay see byte-identical streams by construction, and a failure reproduces from the fuzz seed.
 */

const VIKING = 1;
/** A type id absent from every fixture table — the unknown-id skip path. */
const INVALID_TYPE = 99;
/** A FOOTPRINTED building type added on top of the fixture tables (see {@link fuzzContent}), so the
 *  stream exercises the ground-collision gate and `force`'s collision-skip — random anchors on the
 *  small map often clip the reserved ring off the edge or overlap an earlier house. */
const FOOTPRINTED_TYPE = 5;
/** Building types: HQ / sawmill / temple / tech-gated smithy / footprinted hut / unknown. */
const BUILDING_TYPES = [1, 2, 3, 4, FOOTPRINTED_TYPE, INVALID_TYPE] as const;

/** A footprinted RESOURCE good the stream drops at runtime via `placeResource` — reuses the fixture's
 *  wood good (typeId 1, whose felling lifecycle is already modelled), joined to a landscape logic type +
 *  a gfx record carrying a 1-cell walk/build/work footprint. With this, a `placeResource{good:1}` runs
 *  the CREATE path (footprint stamp + the incremental blocked-cell cache) under the fuzzed stream, not
 *  just the skip path; other goods stay footprint-less and skip. Fuzz-local (the golden fixtures stay
 *  untouched — a footprint on a shared good would re-gate their pinned resource placements). */
const RESOURCE_GOOD = 1;
const RESOURCE_LANDSCAPE_TYPE = 20;
const RESOURCE_GFX_INDEX = 200;

/** The fixture content plus the footprinted hut + the footprinted wood resource — fuzz-local so the
 *  golden fixtures stay untouched (a footprint on a shared type would re-gate the goldens' pinned
 *  placements). */
function fuzzContent() {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
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
        // [state, x, y, run] — one blocked cell at the node's own tile (the full-state footprint).
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
/** Job types: idle / woodcutter / carpenter / hunter / carrier / unknown. */
const JOB_TYPES = [0, 1, 2, 15, 36, INVALID_TYPE] as const;
/** Herd tribes: bear pack / bee / boar / cow / deer, plus two non-animals (viking, unknown) — skipped. */
const HERD_TRIBES = [10, 11, 12, 13, 14, VIKING, INVALID_TYPE] as const;
/** The viking woodcutter's weapon (test_axe) and leather armor — the combatant-spawn extras. */
const AXE = 7;
const LEATHER = 1;
const COMBATANT_HITPOINTS = 500;
// Equip good typeIds (the original's equip set) — the Equipment component stores them verbatim (no
// content validation), so the fuzz exercises the spawn `equipment` stamp + the pct→Fixed conversion.
const SHOES_GOOD = 30;
const MEAD_GOOD = 43;
const MAX_USE_PCT = 100;
/** Owner slots: two valid players + one out-of-range (skipped → neutral) — exercises `stampOwner`. */
const OWNERS = [0, 1, 99] as const;
/** Military-mode ids: the five valid `MILITARY_MODE`s + one out-of-range (skipped) — exercises `setStance`. */
const STANCE_MODES = [0, 1, 2, 3, 4, 7] as const;
/** Fog modes: the three valid `FOG_MODE`s + one out-of-range (skipped) — exercises `setFogMode`, the
 *  VisionSystem's rebuild/downgrade/reset paths, and the fog-mask bytes `hashState` mixes in. */
const FOG_MODES = [0, 1, 2, 9] as const;
/** Entity-targeting commands draw ids from [1, TARGET_ID_RANGE] — live, dead, and never-created. */
const TARGET_ID_RANGE = 80;
/** ~1 command every this-many ticks keeps the stream busy without swamping the map. */
const COMMAND_EVERY = 4;
/** Hash checkpoint cadence — a run-twice divergence is localized to a 50-tick window. */
const CHECKPOINT_EVERY = 50;

// A 12×12-CELL map — the graph is its 24×24 half-cell lattice, and command coords draw from the
// full NODE range so the fuzz exercises off-centre anchors (buildings/spawns on any half-cell).
const MAP_W = 12;
const MAP_H = 12;
const NODE_W = MAP_W * 2;
const NODE_H = MAP_H * 2;
const FUZZ_SEEDS = [11, 29, 47] as const;
const TICKS = 300;

function pick<T>(rng: Rng, options: readonly T[]): T {
  const v = options[rng.int(options.length)];
  if (v === undefined) throw new Error('pick from empty options');
  return v;
}

/** One random command — a pure function of `rng` alone (NEVER world state; see the module doc). */
function nextCommand(rng: Rng): Command {
  const x = rng.int(NODE_W);
  const y = rng.int(NODE_H);
  const roll = rng.int(20);
  switch (roll) {
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
        // Occasionally the settler also wears equipment (an `Equipment` stamp) — the used-up percent
        // varies with the rng so the pct→Fixed conversion is fuzzed for run-twice + replay equality.
        ...(rng.int(3) === 0
          ? {
              equipment: {
                boots: { goodType: SHOES_GOOD, degreeOfUsePct: rng.int(MAX_USE_PCT + 1) },
                misc: [{ goodType: MEAD_GOOD, degreeOfUsePct: rng.int(MAX_USE_PCT + 1) }, null],
              },
            }
          : {}),
        ...(rng.int(2) === 0 ? { owner: pick(rng, OWNERS) } : {}),
      };
    }
    case 2:
      return { kind: 'spawnAnimalHerd', tribe: pick(rng, HERD_TRIBES), x, y };
    case 3:
      // The fixture ships no vehicles, so EVERY placeBoat is the skipped-but-logged path — replay
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
      // Random target ids hit live buildings, live NON-buildings (settlers, herds — must be
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
      // A resource node dropped at a random tile: good 1 (wood — FOOTPRINTED, so the create path runs:
      // footprint stamp + the incremental blocked-cell cache, including overlap counts when nodes stack)
      // and good 4 / unknown (no footprint → the skip path, still logged). One lifecycle marker per node
      // (tree / deposit / pluck-whole) — mutually exclusive, per the command contract.
      const life = rng.int(3);
      return {
        kind: 'placeResource',
        good: pick(rng, [RESOURCE_GOOD, 4, INVALID_TYPE]),
        x,
        y,
        remaining: rng.int(6) + 1,
        harvestAtomic: 24,
        ...(life === 0 ? { felling: { chopsLeft: rng.int(4) + 1 } } : {}),
        ...(life === 1 ? { deposit: { levels: rng.int(4) + 1 } } : {}),
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
        // A fuzzed preference list (0..2 job ids, valid + unknown) — exercises the priority walk, the
        // building-doesn't-offer skip, and the empty-list no-op path.
        jobPriority: Array.from({ length: rng.int(3) }, () => pick(rng, JOB_TYPES)),
      };
    case 10:
      // A loose good pile dropped at a random tile: good 1 (wood — in the catalog, so the CREATE path runs:
      // a bare Stockpile+Position loose pile, NO GroundDrop, that rests in place) and an unknown good / a
      // zero amount (the skip path, still logged). Exercises `dropGood` under the fuzzed stream.
      return {
        kind: 'dropGood',
        good: pick(rng, [RESOURCE_GOOD, INVALID_TYPE]),
        x,
        y,
        amount: rng.int(4), // 0..3 — 0 hits the non-positive-amount skip
      };
    case 11:
      // A work-flag order at a random id + tile: hits owned gatherers (a flag is created, then relocated on
      // a repeat), non-gatherer / unowned / dead ids (skipped). Exercises setWorkFlag's create/move/skip
      // paths — including a WorkFlag/DeliveryFlag entity conjured mid-stream, whose delivery then spreads a
      // yard heap the drop/reap machinery must handle.
      return { kind: 'setWorkFlag', entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity, x, y };
    case 12:
      // The global needs toggle: flips the WorldRules singleton mid-stream (creating it on first use),
      // freezing/unfreezing needs + starvation — the world-scope rule must hash and replay like any state.
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
      // built/non-building/dead ids (skipped — no UnderConstruction marker). Exercises the force-finish.
      return { kind: 'debugCompleteConstruction', target: (rng.int(TARGET_ID_RANGE) + 1) as Entity };
    case 17:
      // The fog-of-war mode: flips the FogRules singleton mid-stream across all three modes (plus an
      // invalid one — the skip path). Exercises the VisionSystem's RECON rebuild/downgrade,
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
    default:
      // A profession change at a random id: valid + unknown jobs, owned/unowned/dead targets.
      return {
        kind: 'setJob',
        entity: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        jobType: pick(rng, JOB_TYPES),
      };
  }
}

interface FuzzRun {
  readonly finalHash: string;
  /** `hashState()` at every CHECKPOINT_EVERY-th tick — localizes a run-twice divergence. */
  readonly checkpoints: readonly string[];
  readonly violations: readonly string[];
  readonly log: readonly LoggedCommand[];
}

function runFuzz(fuzzSeed: number, ticks: number): FuzzRun {
  const sim = new Simulation({ seed: fuzzSeed, content: fuzzContent(), map: grassMap(MAP_W, MAP_H) });
  // An independent generator stream (any fixed derivation of the fuzz seed works — it only must
  // differ from the sim's seed so the two streams aren't trivially correlated).
  const gen = new Rng(fuzzSeed ^ 0x5eed);
  const checkpoints: string[] = [];
  const violations: string[] = [];
  for (let t = 0; t < ticks; t++) {
    if (gen.int(COMMAND_EVERY) === 0) sim.enqueue(nextCommand(gen));
    sim.step();
    if (violations.length === 0) {
      const v = checkInvariants(sim.world, CORE_INVARIANTS);
      if (v.length > 0) violations.push(`tick ${sim.tick}: ${v.join('; ')}`);
    }
    if (sim.tick % CHECKPOINT_EVERY === 0) checkpoints.push(sim.hashState());
  }
  // The log is plain data owned by this sim instance — copy the array so it outlives store reuse.
  return { finalHash: sim.hashState(), checkpoints, violations, log: [...sim.commands.log] };
}

describe('fuzz: randomized command streams stay deterministic, replayable, and invariant-clean', () => {
  for (const seed of FUZZ_SEEDS) {
    it(`seed ${seed}: two live runs are byte-identical and invariant-clean`, () => {
      const a = runFuzz(seed, TICKS);
      const b = runFuzz(seed, TICKS);
      expect(a.violations).toEqual([]);
      expect(b.violations).toEqual([]);
      // Checkpoint-wise equality first: on a divergence the failing index names the 50-tick window.
      expect(b.checkpoints).toEqual(a.checkpoints);
      expect(b.finalHash).toBe(a.finalHash);
    });

    it(`seed ${seed}: replaying the recorded log reproduces the final state`, () => {
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
