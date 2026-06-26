import { indexById } from '@vinland/data';
import { assertNever } from '../brand.js';
import type { Command } from '../commands.js';
import {
  Armor,
  Building,
  Health,
  HerdMember,
  JobAssignment,
  Position,
  Settler,
  Stockpile,
  Vehicle,
} from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { ONE, fx } from '../fixed.js';
import type { System, SystemContext } from './context.js';
import { buildingEnabled, tribeShipsUnlocked } from './progression.js';
import { animalHitpoints, herdParams } from './readviews/index.js';

/**
 * CommandSystem — the ONLY way sim state mutates from the outside. It runs first each tick, drains
 * the per-sim {@link CommandQueue} (`ctx.commands`), and applies each command in enqueue order,
 * appending it to the append-only command log (the save / replay / lockstep record). Every other
 * system reacts to the world these commands shape; nothing outside this seam pokes the world.
 *
 * Why a system and not a method: routing all mutation through one serializable command type (a
 * discriminated union, exhaustively handled via {@link assertNever}) is what makes "a save is a
 * command log" and lockstep multiplayer possible — the same commands replayed on the same ticks from
 * the same seed reproduce byte-identical state. Determinism: the queue is a plain FIFO array, so
 * apply order is exactly enqueue order — no Map/Set iteration, no wall-clock, no RNG.
 *
 * The command variants:
 *  - `placeBuilding` — create a {@link Building} of the given type at (x,y) for a tribe, with a
 *    {@link Stockpile} seeded from the building type's `stock` slots (`initial` amounts). Emits
 *    `buildingPlaced`. Gated by the tribe's `jobEnablesHouse` tech-graph (see {@link buildingEnabled}):
 *    a house locked behind a not-yet-present job is skipped. (Construction/material delivery is a
 *    Phase-3 ConstructionSystem; for the slice a placed, enabled building is immediately `built`.)
 *  - `spawnSettler` — create a {@link Settler} of the given job at (x,y) for a tribe. Emits
 *    `settlerBorn`.
 *  - `spawnAnimalHerd` — place a **herd of an animal tribe** around (x,y): `maximumgroupsize`
 *    creatures scattered within the animal's `maximumdistancetobirthpoint`, each a {@link Settler} of
 *    that animal tribe carrying a {@link Health} pool from `hitpoints_adult`, with a leader designated
 *    when `searchforleader` (see {@link spawnAnimalHerd}). Emits one `settlerBorn` per spawned creature.
 *    Skipped for a non-animal tribe (no `animaltypes` record).
 *  - `placeBoat` — place a **boat hull** (a {@link Vehicle}) of a ship type at (x,y) for a tribe, carrying
 *    an empty {@link Stockpile} (the "boats as mobile stores" entity). Emits `boatPlaced`. Gated by the
 *    tribe's ship-unlock tech graph ({@link tribeShipsUnlocked}): a cart/catapult/unknown/not-yet-unlocked
 *    type is skipped (still logged), the same stance as a tech-gated `placeBuilding` (see {@link placeBoat}).
 *  - `setProduction` — point a workplace's production at a good (currently a no-op marker until the
 *    recipe-selection slice; recorded in the log so replay stays faithful).
 *  - `demolish` — destroy a building entity (ids are never recycled), **first unbinding every
 *    settler employed there** (see {@link unbindWorkersOf}) so a worker isn't left latched to a dead
 *    workplace — it returns to idle and the JobSystem re-employs it elsewhere next tick.
 *
 * A command that references an unknown type id or a dead entity is a recoverable boundary failure
 * (bad UI input / a stale command), not a programmer bug: it is skipped (the log still records it,
 * so replay is faithful) rather than throwing — one bad command must not abort the tick.
 */
export const commandSystem: System = (world, ctx) => {
  for (const command of ctx.commands.drain()) {
    applyCommand(world, ctx, command);
    ctx.commands.record(ctx.tick, command);
  }
};

function applyCommand(world: World, ctx: SystemContext, command: Command): void {
  switch (command.kind) {
    case 'placeBuilding':
      placeBuilding(world, ctx, command);
      return;
    case 'spawnSettler':
      spawnSettler(world, ctx, command);
      return;
    case 'spawnAnimalHerd':
      spawnAnimalHerd(world, ctx, command);
      return;
    case 'placeBoat':
      placeBoat(world, ctx, command);
      return;
    case 'setProduction':
      // No state change yet: recipe/output selection is a later slice. The command is still logged
      // by the caller so a replay reaches the same state once this is implemented.
      return;
    case 'demolish':
      if (world.isAlive(command.building)) {
        unbindWorkersOf(world, command.building);
        world.destroy(command.building);
      }
      return;
    default:
      assertNever(command);
  }
}

/**
 * Release every settler bound to `building` ({@link JobAssignment}) before it is destroyed: drop the
 * binding and reset the settler to idle (`jobType = null`). Without this, a demolished workplace would
 * strand its operators — the binding would dangle on a dead entity (the AI/JobSystem consumers only
 * *defend* against a stale binding, none *clears* it), so the worker would neither produce (its
 * workplace is gone) nor be re-employable (it still looks employed-and-bound to the JobSystem). Faithful
 * to the original: pulling down a building turns its workers back into job-seekers.
 *
 * Determinism: a `query(Settler, JobAssignment)` scan that only *mutates the matched settlers* (drops
 * the binding, resets the job) — order-independent, no chosen-entity pick, so iterating store order is
 * permitted (CLAUDE.md: only a scan whose result depends on *which* entity wins needs the canonical
 * order). The matches are collected before mutating because `world.remove` deletes from the
 * `JobAssignment` store, which `world.query` may be iterating — snapshot first, then mutate.
 */
function unbindWorkersOf(world: World, building: Entity): void {
  const bound: Entity[] = [];
  for (const e of world.query(Settler, JobAssignment)) {
    if (world.get(e, JobAssignment).workplace === building) bound.push(e);
  }
  for (const e of bound) {
    world.remove(e, JobAssignment);
    world.get(e, Settler).jobType = null; // back to idle — the JobSystem re-assigns it next tick
  }
}

function placeBuilding(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'placeBuilding' }>,
): void {
  const type = indexById(ctx.content.buildings).get(command.buildingType);
  if (type === undefined) return; // unknown building type — skip (recoverable bad input)

  // Tech-graph gate: a house may be locked until a settler of an enabling job exists in the tribe
  // (`jobEnablesHouse`). A gated-out placement is a recoverable boundary failure (a stale/illegal UI
  // command), so it is skipped here but still recorded by commandSystem — replay stays faithful.
  if (!buildingEnabled(world, ctx, command.tribe, command.buildingType)) return;

  const e = world.create();
  world.add(e, Position, { x: fx.fromInt(command.x), y: fx.fromInt(command.y) });
  // `underConstruction` starts the building at built=0 — the ConstructionSystem advances it to ONE once
  // its `construction` material cost is delivered into its stockpile. Omitted (the default) places it
  // already built (the slice / golden path). An under-construction site begins with an EMPTY hold (it
  // accumulates delivered materials); a finished placement is seeded from the type's stock `initial`s so
  // a headquarters arrives with its starting goods — exactly as the tests construct one by hand.
  const built = command.underConstruction ? fx.fromInt(0) : ONE;
  world.add(e, Building, { buildingType: command.buildingType, tribe: command.tribe, built, level: 0 });
  const amounts = new Map<number, number>();
  if (!command.underConstruction) {
    for (const slot of type.stock) {
      if (slot.initial > 0) amounts.set(slot.goodType, slot.initial);
    }
  }
  world.add(e, Stockpile, { amounts });
  ctx.events.emit({ kind: 'buildingPlaced', entity: e, at: { x: command.x, y: command.y } });
}

/**
 * Place a **boat hull** — the boat analogue of {@link placeBuilding}: it creates a {@link Vehicle} hull
 * at (x,y) carrying an empty {@link Stockpile} (the "boats as mobile stores" entity the Sea/Northland
 * roadmap item names — a ship is a movable stockpile, its capacity being the ship type's `stockSlots`).
 *
 * The placement is gated by the tribe's **ship-unlock tech graph** ({@link tribeShipsUnlocked}): only a
 * `vehicleType` that is a ship the tribe has currently UNLOCKED (a `vehicle_ship` row — `passengerSlots > 0`
 * — whose `jobEnablesVehicle` edge is satisfied) is placed. A cart, a catapult, an unknown id, or a
 * not-yet-unlocked ship is a recoverable bad command — skipped (still recorded by commandSystem so replay
 * stays faithful), exactly the tech-gated-`placeBuilding` stance. Unlike a building the hull is seeded with
 * an **empty** hold: a boat is loaded by hauling cargo to it (applying the `cargoGoods` filter — a deferred
 * load slice), not pre-stocked with starting goods.
 *
 * FIDELITY: pinned to the extracted vehicle IR on both axes the entity reads — the ship/cart split is the
 * `passengerslots` param (`shipVehicles`/`isShipVehicle`) and the unlock is the `jobEnablesVehicle` edge
 * ({@link tribeShipsUnlocked}). The hull is a *static* placed store here: movement, passenger embark/disembark, the
 * cargo-load filter, and water-valency terrain (which cells it floats on) are deferred follow-ups
 * (docs/FIDELITY.md "Sea/Northland — boat hull entity"). Determinism: a pure read of the unlocked-ship set
 * (a filtered/sorted content scan + an order-independent live-settler membership query) then a single
 * `create()`; no RNG, no wall-clock.
 */
function placeBoat(world: World, ctx: SystemContext, command: Extract<Command, { kind: 'placeBoat' }>): void {
  // Only an UNLOCKED ship of this tribe may be fielded. tribeShipsUnlocked already excludes carts /
  // catapults (not ships), unknown ids, and ships behind an unmet tech edge — so a `vehicleType` absent
  // from it is bad input (a stale/illegal command), skipped here but still logged for faithful replay.
  const unlocked = tribeShipsUnlocked(world, ctx, command.tribe);
  if (!unlocked.some((v) => v.typeId === command.vehicleType)) return;

  const e = world.create();
  world.add(e, Position, { x: fx.fromInt(command.x), y: fx.fromInt(command.y) });
  world.add(e, Vehicle, { vehicleType: command.vehicleType, tribe: command.tribe });
  // A hull arrives EMPTY — a boat-as-mobile-store is filled by hauling cargo to it (the `cargoGoods`
  // load filter, a deferred slice), not pre-seeded with starting goods like a headquarters. Its hold
  // CAPACITY is the ship type's `stockSlots` (read off the VehicleType, like `largestShipCapacity`).
  world.add(e, Stockpile, { amounts: new Map<number, number>() });
  ctx.events.emit({ kind: 'boatPlaced', entity: e, at: { x: command.x, y: command.y } });
}

function spawnSettler(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'spawnSettler' }>,
): void {
  // jobType 0 ("idle"/unemployed) is allowed; only an id absent from the job table is bad input.
  if (indexById(ctx.content.jobs).get(command.jobType) === undefined) return;

  const e = world.create();
  world.add(e, Position, { x: fx.fromInt(command.x), y: fx.fromInt(command.y) });
  world.add(e, Settler, {
    tribe: command.tribe,
    jobType: command.jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  // A combatant settler carries a `Health` pool stamped from the command (the settler analogue of the
  // animal `hitpoints_adult` stamp — a civilization becomes a fighter FROM THE COMMAND DATA, through the
  // mutation seam, rather than a test reaching into the world). Only a positive pool is stamped; absent /
  // non-positive `hitpoints` (the default — the non-combatant / golden / vertical-slice path) leaves the
  // settler `Health`-less and the hash untouched, the separate-optional-component pattern. The MAGNITUDE
  // is caller-supplied and *approximated* — a human's hitpoints are below the readable `.ini`
  // (docs/FIDELITY.md "Combat hit resolution").
  if (command.hitpoints !== undefined && command.hitpoints > 0) {
    world.add(e, Health, { hitpoints: command.hitpoints, max: command.hitpoints });
  }
  // A combatant wearing armor carries an `Armor` class (the settler analogue of the `Health` stamp): an
  // incoming hit is mitigated by that tier's `blockingValue` rather than landing on the unarmored class 0.
  // Only a positive class is stamped; absent / non-positive `armorClass` (the default) leaves the settler
  // unarmored, the separate-optional-component pattern that keeps the golden hash untouched.
  if (command.armorClass !== undefined && command.armorClass > 0) {
    world.add(e, Armor, { armorClass: command.armorClass });
  }
  ctx.events.emit({ kind: 'settlerBorn', entity: e });
}

/**
 * Spawn a **herd of an animal tribe** around a birth point — the animal-placement mechanic the ROADMAP
 * Phase-4 "animals as non-controllable tribes" item names: it actually puts a group of creatures on the
 * map, consuming the {@link herdParams}/{@link animalHitpoints} read views the previous slices landed.
 *
 * The herd is `max(1, maximumgroupsize)` creatures (`maximumgroupsize` 0 — a source-omitted/solitary
 * animal — still yields one), each a {@link Settler} of the animal `tribe` (animals reuse the **same
 * entity/AI model** as a settler — the ROADMAP requirement, not a bolt-on) at `jobType: null` (an animal
 * isn't born into a trade) carrying a {@link Health} pool stamped from its `hitpoints_adult`
 * ({@link animalHitpoints}). The creatures are scattered around (x,y) within `maximumdistancetobirthpoint`
 * by a **deterministic** offset ({@link herdMemberOffset} — an expanding 8-direction ring, no RNG), so a
 * herd spreads out instead of stacking on one tile, reproducibly. When the animal's `searchforleader` is
 * set the herd gets a **leader** — its lowest-id member (the first created), which every member (including
 * the leader, self-referentially) records via a {@link HerdMember} — the relation the follow-the-leader
 * movement drive (`herdingSystem`) reads to keep a strayed follower within `maximumleaderdistance`; a
 * solitary (`searchforleader` false) animal carries no `HerdMember`.
 *
 * A `tribe` with no `animaltypes` record (a civilization, or an unknown tribe) is bad input — there are
 * no herd params to read — so the command is skipped (still logged by commandSystem, so replay stays
 * faithful), the same recoverable-boundary-failure stance as an unknown building/job id.
 *
 * FIDELITY: the **group size**, **HP pool**, **birth-point range**, and **leader presence** are the
 * verbatim extracted `animaltypes.ini` params (faithful). **Approximated (no oracle):** the *scatter
 * pattern* (where within the range each creature lands), that animals spawn at `jobType: null` (so they
 * carry no weapon yet — the animal→weapon `(tribeType, typeId)` binding is a deferred refinement), and
 * that the spawn is a one-shot placement with no respawn/territory upkeep — the original's herd-AI is the
 * undocumented "soul" (recorded in docs/FIDELITY.md). No births→growth here: an animal is spawned adult
 * (carries no {@link Age}); the per-tribe spawn cadence / map populator is a later slice.
 *
 * Determinism: the leader is the herd's lowest-id member (creation is monotonic, so the first `create()`
 * is the lowest id — a canonical pick), the scatter offsets are a fixed function of the member index, and
 * `animalHitpoints`/`herdParams` are pure content reads — no RNG, no wall-clock.
 */
function spawnAnimalHerd(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'spawnAnimalHerd' }>,
): void {
  const herd = herdParams(ctx.content, command.tribe);
  if (herd === null) return; // not an animal tribe (a civilization / unknown) — bad input, skip
  const hitpoints = animalHitpoints(ctx.content, command.tribe) ?? 0; // an animal record always has both

  const count = Math.max(1, herd.maxGroupSize); // a 0/solitary group still yields one creature
  const range = Math.max(0, herd.birthPointRange);
  const members: Entity[] = [];
  for (let i = 0; i < count; i++) {
    const off = herdMemberOffset(i, range);
    const e = world.create();
    world.add(e, Position, { x: fx.fromInt(command.x + off.dx), y: fx.fromInt(command.y + off.dy) });
    world.add(e, Settler, {
      tribe: command.tribe,
      jobType: null, // an animal isn't born into a trade (no weapon binding yet — see fidelity note)
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map<number, number>(),
    });
    world.add(e, Health, { hitpoints, max: hitpoints });
    members.push(e);
    ctx.events.emit({ kind: 'settlerBorn', entity: e });
  }

  // A herd whose animal seeks a leader gets one: the lowest-id member (members[0] — `create()` ids are
  // monotonic, so the first is the lowest), which every member records via HerdMember (the leader points
  // at itself). A solitary (searchforleader false) animal carries no HerdMember.
  if (herd.searchForLeader) {
    const leader = members[0];
    if (leader !== undefined) for (const e of members) world.add(e, HerdMember, { leader });
  }
}

/**
 * The deterministic (no-RNG) tile offset for the `i`-th member of a herd, kept within `range` of the
 * birth point. Member 0 lands ON the birth point; the rest spiral out along an expanding 8-direction
 * ring (`(±r, ±r)` / axis steps), the radius growing each time the 8 directions are exhausted and
 * **clamped at `range`** so no creature strays past `maximumdistancetobirthpoint`. A fixed function of
 * `(i, range)`, so the same herd command always scatters identically — reproducible, hashable.
 *
 * Distinct tiles hold up to **9** members (the centre + 8 first-ring directions) given `range >= 1`;
 * beyond that — or with `range` 0 — the radius clamp re-uses ring directions, so two creatures can land
 * on the same tile. That is harmless (the sim places no position-uniqueness invariant — entities share
 * tiles freely) and never reached by real data (`animaltypes` `maximumgroupsize` is 3..6, well under 9);
 * the scatter is an explicitly *approximated* placement (docs/FIDELITY.md), not a packing guarantee.
 */
function herdMemberOffset(i: number, range: number): { dx: number; dy: number } {
  if (i === 0 || range <= 0) return { dx: 0, dy: 0 }; // the first (leader) sits on the birth point
  // 8 compass directions, in a fixed canonical order. Ring `r` (1-based) places up to 8 members at
  // radius `min(r, range)`; member index within the ring picks the direction.
  const DIRS: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ];
  const ring = Math.floor((i - 1) / DIRS.length) + 1; // 1, 2, 3, … as the rings fill
  const dir = DIRS[(i - 1) % DIRS.length] as readonly [number, number];
  const radius = Math.min(ring, range); // never past the birth-point range
  return { dx: dir[0] * radius, dy: dir[1] * radius };
}
