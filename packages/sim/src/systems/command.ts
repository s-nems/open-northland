import { indexById } from '@vinland/data';
import {
  Building,
  FogRules,
  fogRulesEntity,
  Health,
  isFogMode,
  JobAssignment,
  Position,
  Settler,
  Stockpile,
  stampOwner,
  UnderConstruction,
  Vehicle,
  WorldRules,
  worldRulesEntity,
} from '../components/index.js';
import { assertNever } from '../core/brand.js';
import type { Command } from '../core/commands.js';
import { contentIndex } from '../core/content-index.js';
import { type Fixed, fx, ONE } from '../core/fixed.js';
import type { Entity, World } from '../ecs/world.js';
import { positionOfNode } from '../nav/halfcell.js';
import { dropOrStackGood } from './agents/effects-goods.js';
import { assignWorker, attackUnit, moveUnit, setJob, setStance, setWorkFlag } from './conflict/orders.js';
import { spawnAnimalHerd, spawnSettler } from './conflict/spawn.js';
import type { System, SystemContext } from './context.js';
import { forceFinishConstruction } from './economy/construction.js';
import { canPlaceBuilding, createResourceNode } from './footprint/index.js';
import { buildingEnabled, tribeShipsUnlocked } from './progression.js';

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
 *    that animal tribe carrying a {@link Health} pool from `hitpoints_adult` and — when the record sets
 *    `movespeed` — a {@link MoveSpeed} walking pace from it, with a leader designated when
 *    `searchforleader` (see {@link spawnAnimalHerd}). Emits one `settlerBorn` per spawned creature.
 *    Skipped for a non-animal tribe (no `animaltypes` record).
 *  - `placeBoat` — place a **boat hull** (a {@link Vehicle}) of a ship type at (x,y) for a tribe, carrying
 *    an empty {@link Stockpile} (the "boats as mobile stores" entity). Emits `boatPlaced`. Gated by the
 *    tribe's ship-unlock tech graph ({@link tribeShipsUnlocked}): a cart/catapult/unknown/not-yet-unlocked
 *    type is skipped (still logged), the same stance as a tech-gated `placeBuilding` (see {@link placeBoat}).
 *  - `placeResource` — create a standing {@link Resource} node (a tree / mined deposit / plucked node)
 *    of a good at (x,y) through the shared {@link createResourceNode} assembly — the runtime analogue of
 *    the scene-setup `place*` helpers, for a map/scenario editor or the debug spawn palette. Skipped
 *    (still logged) for a good with no resource footprint record (bad input).
 *  - `dropGood` — drop a loose good pile on the ground at (x,y) through the shared {@link dropOrStackGood}
 *    assembly (a bare {@link Stockpile} that draws as a per-fill heap and rests in place), STACKING onto an
 *    existing same-good pile on the tile up to `MAX_GROUND_STACK` so repeated one-unit clicks pile up. The
 *    "place this good on the ground" order behind the HUD goods tool + the admin spawn palette. Skipped
 *    (still logged) for an unknown good or a non-positive amount (bad input).
 *  - `setProduction` — point a workplace's production at a good (currently a no-op marker until the
 *    recipe-selection slice; recorded in the log so replay stays faithful).
 *  - `demolish` — destroy a building entity (ids are never recycled), **first unbinding every
 *    settler employed there** (see {@link unbindWorkersOf}) so a worker isn't left latched to a dead
 *    workplace — it returns to idle and the JobSystem re-employs it elsewhere next tick. Only an
 *    entity that actually IS a building is destroyed: a demolish aimed at anything else (a settler,
 *    a resource, a boat — a stale or hostile command) is skipped.
 *  - `moveUnit` / `setJob` / `attackUnit` / `setStance` — the PLAYER-order commands that steer an
 *    EXISTING owned settler (the RTS "go there" / "change profession" / "attack that one" / "set military
 *    mode"): `moveUnit` sets a `MoveGoal` + a `PlayerOrder` soft timed override, `setJob` swaps the
 *    `jobType` and re-idles the unit, `attackUnit` stamps an `AttackOrder` combat focus (chase + strike a
 *    target regardless of sight), `setStance` writes the unit's `Stance` military mode (auto-engage /
 *    defend / ignore / flee). All live in ./orders.ts ({@link moveUnit}/{@link setJob}/{@link attackUnit}/
 *    {@link setStance}) and skip a dead/non-settler/neutral (and, for attack, non-combatant) target (still logged).
 *  - `assignWorker` — bind an EXISTING owned settler to a SPECIFIC building as a worker (the
 *    player-directed twin of the JobSystem's auto-assignment): set its `jobType` to the building's open
 *    worker slot and stamp its `JobAssignment` binding, through the same per-building openness gate the
 *    JobSystem applies (see {@link assignWorker}). Skipped for a full/wrong-tribe/non-workplace target.
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
    case 'placeResource':
      // Build a standing resource node through the shared assembly. A `good` with no footprint record
      // is bad input — createResourceNode returns null (world untouched); the command is skipped (still
      // logged for faithful replay), the same stance as an unknown building/job id.
      createResourceNode(world, ctx.content, {
        good: command.good,
        x: command.x,
        y: command.y,
        remaining: command.remaining,
        harvestAtomic: command.harvestAtomic,
        ...(command.felling !== undefined ? { felling: command.felling } : {}),
        ...(command.deposit !== undefined ? { deposit: command.deposit } : {}),
      });
      return;
    case 'dropGood': {
      // Drop a loose good pile, STACKING onto an existing pile of the same good on the tile (capped at
      // MAX_GROUND_STACK) so repeated one-unit clicks pile up rather than littering entities. An
      // `amount <= 0` or a good absent from the catalog is bad input — an id-neutral skip (no `create()`,
      // still logged for faithful replay), the same stance as an unknown building/job/resource id.
      if (command.amount <= 0) return;
      if (!contentIndex(ctx.content).goods.has(command.good)) return;
      const pos = positionOfNode(command.x, command.y);
      dropOrStackGood(world, pos.x, pos.y, command.good, command.amount);
      return;
    }
    case 'setProduction':
      // No state change yet: recipe/output selection is a later slice. The command is still logged
      // by the caller so a replay reaches the same state once this is implemented.
      return;
    case 'demolish':
      // Validate the TARGET KIND at execution, not just liveness: in lockstep any peer can send any
      // command (and a queued command's target can change between issue and apply), so a demolish
      // aimed at a non-building entity — a settler, a resource node, a boat — must be a skip, never
      // a destroy. Same recoverable-bad-input stance as an unknown type id (still logged for replay).
      if (world.has(command.building, Building)) {
        unbindWorkersOf(world, command.building);
        world.destroy(command.building);
      }
      return;
    case 'moveUnit':
      moveUnit(world, ctx, command);
      return;
    case 'setJob':
      setJob(world, ctx, command);
      return;
    case 'attackUnit':
      attackUnit(world, ctx, command);
      return;
    case 'setStance':
      setStance(world, ctx, command);
      return;
    case 'assignWorker':
      assignWorker(world, ctx, command);
      return;
    case 'setWorkFlag':
      setWorkFlag(world, ctx, command);
      return;
    case 'setNeedsEnabled': {
      // Set the WorldRules SINGLETON (created lazily on first use, mutated thereafter) — the toggle is
      // simulated state, so it hashes/replays like any component. Idempotent re-sends just overwrite.
      const rules = worldRulesEntity(world);
      if (rules === null) world.add(world.create(), WorldRules, { needsEnabled: command.enabled });
      else world.get(rules, WorldRules).needsEnabled = command.enabled;
      return;
    }
    case 'setFogMode': {
      // Set the FogRules SINGLETON (the WorldRules pattern: created lazily, mutated thereafter) — the
      // fog mode is simulated state (combat gates on visibility), so it hashes/replays like any
      // component. The VisionSystem sees the new mode THIS tick (it runs after commandSystem) and
      // rebuilds the masks off-cadence. A mode outside the four FOG_MODE ids is recoverable bad input:
      // skipped, still logged for faithful replay.
      if (!isFogMode(command.mode)) return;
      const fogRules = fogRulesEntity(world);
      if (fogRules === null) world.add(world.create(), FogRules, { mode: command.mode });
      else world.get(fogRules, FogRules).mode = command.mode;
      return;
    }
    case 'debugKill': {
      // Only a UNIT (a settler — animals are settlers too) is killable. Gate on Settler so a building
      // that carries a Health pool WHILE UNDER CONSTRUCTION can't be drained-and-reaped here: that would
      // destroy the building through CleanupSystem, bypassing demolish's worker-unbind seam and emitting a
      // settlerDied cue for a non-settler. Then drain the pool to 0 and let CleanupSystem reap it next tick
      // (the real death path + event), rather than a silent destroy. A non-settler / already-reaped target
      // is a no-op — the same recoverable-bad-input stance as demolish/attackUnit.
      if (!world.has(command.target, Settler)) return;
      const health = world.tryGet(command.target, Health);
      if (health !== undefined) health.hitpoints = 0;
      return;
    }
    case 'debugSetNeeds': {
      // Set the needs the panel names to whole-percent levels (0 sated … 100 maxed). A non-settler
      // target is a no-op. Percent → 0..ONE need Fixed with a single truncation (fx.mulDiv).
      const settler = world.tryGet(command.target, Settler);
      if (settler === undefined) return;
      if (command.hunger !== undefined) settler.hunger = needFixedFromPct(command.hunger);
      if (command.fatigue !== undefined) settler.fatigue = needFixedFromPct(command.fatigue);
      if (command.piety !== undefined) settler.piety = needFixedFromPct(command.piety);
      if (command.enjoyment !== undefined) settler.enjoyment = needFixedFromPct(command.enjoyment);
      return;
    }
    case 'debugFillStockpile': {
      // Set every good the building TYPE declares a stock slot for to that slot's capacity (its "100%").
      // A non-building target, one without a Stockpile, or an unknown type is a no-op.
      const building = world.tryGet(command.target, Building);
      if (building === undefined || !world.has(command.target, Stockpile)) return;
      const type = indexById(ctx.content.buildings).get(building.buildingType);
      if (type === undefined) return;
      const stock = world.get(command.target, Stockpile).amounts;
      for (const slot of type.stock) stock.set(slot.goodType, slot.capacity);
      return;
    }
    case 'debugCompleteConstruction':
      forceFinishConstruction(world, ctx, command.target);
      return;
    default:
      assertNever(command);
  }
}

/** A whole-percent need level (`0..100`, clamped) as the `0..ONE` need `Fixed` — a single truncation
 *  (`ONE · pct / 100`) so 0 → sated and 100 → maxed exactly, the debug-needs command's one conversion. */
function needFixedFromPct(pct: number): Fixed {
  const clamped = pct < 0 ? 0 : pct > 100 ? 100 : Math.trunc(pct);
  return fx.mulDiv(ONE, fx.fromInt(clamped), fx.fromInt(100));
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
 * permitted (AGENTS.md: only a scan whose result depends on *which* entity wins needs the canonical
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

  // `force` (map-authored imports + pinned demo fixtures) skips BOTH gates below: the original loads
  // a decoded map's houses verbatim — it never re-validates authored state against the interactive
  // placement rule (source basis: observed original behavior — scenario maps open with houses that
  // the free-placement rule would reject, e.g. packed villages).
  if (command.force !== true) {
    // Tech-graph gate: a house may be locked until a settler of an enabling job exists in the tribe
    // (`jobEnablesHouse`). A gated-out placement is a recoverable boundary failure (a stale/illegal UI
    // command), so it is skipped here but still recorded by commandSystem — replay stays faithful.
    if (!buildingEnabled(world, ctx, command.tribe, command.buildingType)) return;

    // Ground-collision gate — the original's FREE placement rule: the type's footprint must fit here
    // (its reserved zone on buildable ground, clear of resource nodes, its walls and every existing
    // building's walls outside each other's zones — see {@link canPlaceBuilding}). A placement that
    // doesn't fit is the same recoverable boundary failure as a tech-gated one: skipped, still logged.
    // A mapless sim (no terrain) or a footprint-less type (synthetic content) validates trivially.
    if (
      ctx.terrain !== undefined &&
      !canPlaceBuilding(world, ctx, ctx.terrain, command.buildingType, command.x, command.y)
    ) {
      return;
    }
  }

  const e = world.create();
  // The anchor is a half-cell node; its Position is the node's fractional tile coords (the render
  // projects Positions, so the building draws exactly on its authored half-cell).
  world.add(e, Position, positionOfNode(command.x, command.y));
  // `underConstruction` starts the building at built=0 — the ConstructionSystem advances it to ONE once
  // its `construction` material cost is delivered into its stockpile. Omitted (the default) places it
  // already built (the slice / golden path). An under-construction site begins with an EMPTY hold (it
  // accumulates delivered materials); a finished placement is seeded from the type's stock `initial`s so
  // a headquarters arrives with its starting goods — exactly as the tests construct one by hand.
  const built = command.underConstruction ? fx.fromInt(0) : ONE;
  world.add(e, Building, { buildingType: command.buildingType, tribe: command.tribe, built, level: 0 });
  const amounts = new Map<number, number>();
  if (command.underConstruction) {
    // A construction site: the builder-work marker (starts at 0 labor — a bare grey foundation) plus,
    // when the type has a hitpoints pool, a Health pool the ConstructionSystem ramps up as it rises
    // (stamped at 1 so the foundation is never a 0-HP corpse the CleanupSystem reaps). A type with no
    // extracted `hitpoints` (synthetic content) carries no Health — it still builds, just without a life
    // pool. Only an under-construction placement gets these; an already-built placement (the golden /
    // vertical-slice path) is a plain Building, hash untouched.
    world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
    if (type.hitpoints !== undefined) world.add(e, Health, { hitpoints: 1, max: type.hitpoints });
  } else {
    for (const slot of type.stock) {
      if (slot.initial > 0) amounts.set(slot.goodType, slot.initial);
    }
  }
  world.add(e, Stockpile, { amounts });
  // A building placed for a specific PLAYER carries an `Owner` (the separate-optional stamp): it is
  // that player's to select/command. Omitted / out-of-range leaves it neutral (golden path).
  stampOwner(world, e, command.owner);
  ctx.events.emit({ kind: 'buildingPlaced', entity: e, at: { x: command.x, y: command.y } });
}

/**
 * Place a **boat hull** — the boat analogue of {@link placeBuilding}: it creates a {@link Vehicle} hull
 * at (x,y) carrying an empty {@link Stockpile} (the "boats as mobile stores" entity the Sea/Northland
 * plan item names — a ship is a movable stockpile, its capacity being the ship type's `stockSlots`).
 *
 * The placement is gated by the tribe's **ship-unlock tech graph** ({@link tribeShipsUnlocked}): only a
 * `vehicleType` that is a ship the tribe has currently UNLOCKED (a `vehicle_ship` row — `passengerSlots > 0`
 * — whose `jobEnablesVehicle` edge is satisfied) is placed. A cart, a catapult, an unknown id, or a
 * not-yet-unlocked ship is a recoverable bad command — skipped (still recorded by commandSystem so replay
 * stays faithful), exactly the tech-gated-`placeBuilding` stance. Unlike a building the hull is seeded with
 * an **empty** hold: a boat is loaded by hauling cargo to it (applying the `cargoGoods` filter — a deferred
 * load slice), not pre-stocked with starting goods.
 *
 * source-basis: pinned to the extracted vehicle IR on both axes the entity reads — the ship/cart split is the
 * `passengerslots` param (`shipVehicles`/`isShipVehicle`) and the unlock is the `jobEnablesVehicle` edge
 * ({@link tribeShipsUnlocked}). The hull is a *static* placed store here: movement, passenger embark/disembark, the
 * cargo-load filter, and water-valency terrain (which cells it floats on) are deferred follow-ups
 * (source basis "Sea/Northland — boat hull entity"). Determinism: a pure read of the unlocked-ship set
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
  world.add(e, Position, positionOfNode(command.x, command.y));
  world.add(e, Vehicle, { vehicleType: command.vehicleType, tribe: command.tribe });
  // A hull placed for a specific PLAYER carries an `Owner` (the separate-optional stamp). Omitted /
  // out-of-range leaves it neutral (golden path).
  stampOwner(world, e, command.owner);
  // A hull arrives EMPTY — a boat-as-mobile-store is filled by hauling cargo to it (the `cargoGoods`
  // load filter, a deferred slice), not pre-seeded with starting goods like a headquarters. Its hold
  // CAPACITY is the ship type's `stockSlots` (read off the VehicleType, like `largestShipCapacity`).
  world.add(e, Stockpile, { amounts: new Map<number, number>() });
  ctx.events.emit({ kind: 'boatPlaced', entity: e, at: { x: command.x, y: command.y } });
}
