import {
  Building,
  FogRules,
  fogRulesEntity,
  Health,
  isFogMode,
  Settler,
  Stockpile,
  Vehicle,
  WorldRules,
  worldRulesEntity,
} from '../../components/index.js';
import { assertNever } from '../../core/brand.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import { dropOrStackGood } from '../agents/effects-goods/index.js';
import { spawnAnimalHerd, spawnSettler } from '../conflict/spawn/index.js';
import type { System, SystemContext } from '../context.js';
import { forceFinishConstruction } from '../economy/construction.js';
import { createResourceNode } from '../footprint/index.js';
import {
  assignBuilder,
  assignWorker,
  attackUnit,
  moveUnit,
  setGatherGood,
  setJob,
  setStance,
  setWorkFlag,
} from '../orders/index.js';
import { buildingEnabled, tribeShipsUnlocked } from '../progression/index.js';

import { placeBoat, placeBuilding, unbindWorkersOf } from './placement.js';
/**
 * CommandSystem — the only way sim state mutates from the outside. It runs first each tick, drains the
 * per-sim {@link CommandQueue} (`ctx.commands`), and applies each command in enqueue order, appending it to
 * the append-only command log (the save / replay / lockstep record). Every other system reacts to the world
 * these commands shape; nothing outside this seam pokes the world.
 *
 * Why a system and not a method: routing all mutation through one serializable command type (a discriminated
 * union, exhaustively handled via {@link assertNever}) is what makes "a save is a command log" and lockstep
 * multiplayer possible — the same commands replayed on the same ticks from the same seed reproduce
 * byte-identical state. The queue is a plain FIFO array, so apply order is exactly enqueue order — no Map/Set
 * iteration, no wall-clock, no RNG.
 *
 * The command variants:
 *  - `placeBuilding` — create a {@link Building} of the given type at (x,y) for a tribe, with a
 *    {@link Stockpile} seeded from the building type's `stock` slots (`initial` amounts). Emits
 *    `buildingPlaced`. Gated by the tribe's `jobEnablesHouse` tech-graph (see {@link buildingEnabled}): a
 *    house locked behind a not-yet-present job is skipped.
 *  - `spawnSettler` — create a {@link Settler} of the given job at (x,y) for a tribe. Emits `settlerBorn`.
 *  - `spawnAnimalHerd` — place a herd of an animal tribe around (x,y): `maximumgroupsize` creatures
 *    scattered within the animal's `maximumdistancetobirthpoint`, each a {@link Settler} of that animal tribe
 *    carrying a {@link Health} pool from `hitpoints_adult` and — when the record sets `movespeed` — a
 *    {@link MoveSpeed} walking pace from it, with a leader designated when `searchforleader` (see
 *    {@link spawnAnimalHerd}). Emits one `settlerBorn` per spawned creature. Skipped for a non-animal tribe.
 *  - `placeBoat` — place a boat hull (a {@link Vehicle}) of a ship type at (x,y) for a tribe, carrying an
 *    empty {@link Stockpile} (the "boats as mobile stores" entity). Emits `boatPlaced`. Gated by the tribe's
 *    ship-unlock tech graph ({@link tribeShipsUnlocked}): a cart/catapult/unknown/not-yet-unlocked type is
 *    skipped (still logged), the same stance as a tech-gated `placeBuilding` (see {@link placeBoat}).
 *  - `placeResource` — create a standing {@link Resource} node (a tree / mined deposit / plucked node) of a
 *    good at (x,y) through the shared {@link createResourceNode} assembly — the runtime analogue of the
 *    scene-setup `place*` helpers, for a map/scenario editor or the debug spawn palette. Skipped (still
 *    logged) for a good with no resource footprint record.
 *  - `dropGood` — drop a loose good pile on the ground at (x,y) through the shared {@link dropOrStackGood}
 *    assembly (a bare {@link Stockpile} that draws as a per-fill heap and rests in place), stacking onto an
 *    existing same-good pile on the tile up to `MAX_GROUND_STACK`. The "place this good on the ground" order
 *    behind the HUD goods tool + the admin spawn palette. Skipped (still logged) for an unknown good or a
 *    non-positive amount.
 *  - `demolish` — destroy a building entity (ids are never recycled), first unbinding every settler employed
 *    there (see {@link unbindWorkersOf}) so a worker isn't left latched to a dead workplace. Only an entity
 *    that actually is a building is destroyed: a demolish aimed at anything else (a settler, a resource, a
 *    boat — a stale or hostile command) is skipped.
 *  - `moveUnit` / `setJob` / `attackUnit` / `setStance` / `assignWorker` / `assignBuilder` / `setWorkFlag` —
 *    the player-order commands that steer an existing owned settler; each lives in ../orders/ and documents
 *    its own semantics and skip conditions on the {@link Command} type. Each skips a dead/non-settler/neutral
 *    target (still logged).
 *
 * A command that references an unknown type id or a dead entity is a recoverable boundary failure (bad UI
 * input / a stale command), not a programmer bug: it is skipped (the log still records it, so replay is
 * faithful) rather than throwing — one bad command must not abort the tick.
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
      // Drop a loose good pile, stacking onto an existing pile of the same good on the tile (capped at
      // MAX_GROUND_STACK) so repeated one-unit clicks pile up rather than littering entities. An `amount <= 0`
      // or a good absent from the catalog is bad input — an id-neutral skip (still logged for faithful replay).
      if (command.amount <= 0) return;
      if (!contentIndex(ctx.content).goods.has(command.good)) return;
      const pos = positionOfNode(command.x, command.y);
      dropOrStackGood(world, pos.x, pos.y, command.good, command.amount);
      return;
    }
    case 'demolish':
      // Validate the target kind at execution, not just liveness: in lockstep any peer can send any command
      // (and a queued command's target can change between issue and apply), so a demolish aimed at a
      // non-building entity — a settler, a resource node, a boat — must be a skip, never a destroy.
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
    case 'assignBuilder':
      assignBuilder(world, ctx, command);
      return;
    case 'setWorkFlag':
      setWorkFlag(world, ctx, command);
      return;
    case 'setGatherGood':
      setGatherGood(world, ctx, command);
      return;
    case 'setNeedsEnabled': {
      // Set the WorldRules singleton (created lazily on first use, mutated thereafter) — the toggle is
      // simulated state, so it hashes/replays like any component. Idempotent re-sends just overwrite.
      const rules = worldRulesEntity(world);
      if (rules === null) world.add(world.create(), WorldRules, { needsEnabled: command.enabled });
      else world.get(rules, WorldRules).needsEnabled = command.enabled;
      return;
    }
    case 'setFogMode': {
      // Set the FogRules singleton (the WorldRules pattern: created lazily, mutated thereafter) — the fog mode
      // is simulated state (combat gates on visibility), so it hashes/replays like any component. The
      // VisionSystem sees the new mode this tick (it runs after commandSystem) and rebuilds the masks
      // off-cadence. A mode outside the three FOG_MODE ids is skipped (still logged for faithful replay).
      if (!isFogMode(command.mode)) return;
      const fogRules = fogRulesEntity(world);
      if (fogRules === null) world.add(world.create(), FogRules, { mode: command.mode });
      else world.get(fogRules, FogRules).mode = command.mode;
      return;
    }
    case 'debugKill': {
      // Only a unit (a settler — animals are settlers too) is killable. Gate on Settler so a building that
      // carries a Health pool while under construction can't be drained-and-reaped here: that would destroy
      // the building through CleanupSystem, bypassing demolish's worker-unbind seam and emitting a settlerDied
      // cue for a non-settler. Then drain the pool to 0 and let CleanupSystem reap it next tick (the real
      // death path + event), rather than a silent destroy. A non-settler / already-reaped target is a no-op.
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
      // Set every good the building type declares a stock slot for to that slot's capacity (its "100%"). A
      // non-building target, one without a Stockpile, or an unknown type is a no-op.
      const building = world.tryGet(command.target, Building);
      if (building === undefined || !world.has(command.target, Stockpile)) return;
      const type = contentIndex(ctx.content).commandBuildings.get(building.buildingType);
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
