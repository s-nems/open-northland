import {
  AiPlayer,
  aiModuleEnables,
  aiPlayerEntity,
  isValidPlayer,
  setFogMode,
  setNeedsEnabled,
  setSignpostNavigation,
} from '../../components/index.js';
import { assertNever } from '../../core/brand.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import { spawnAnimalHerd, spawnSettler } from '../conflict/spawn/index.js';
import type { System, SystemContext } from '../context.js';
import { forceFinishConstruction } from '../economy/construction.js';
import {
  assignBuilder,
  assignHouse,
  assignWorker,
  attackUnit,
  makeChild,
  marry,
  moveUnit,
  placeSignpost,
  setCraftGoods,
  setGatherGood,
  setJob,
  setStance,
  setWorkFlag,
} from '../orders/index.js';
import { buildingEnabled, tribeShipsUnlocked } from '../progression/index.js';
import { debugFillStockpile, debugKill, debugSetNeeds } from './debug.js';
import { cancelUpgrade, placeBoat, placeBuilding, upgradeBuilding } from './placement.js';
import { demolish, demolishSignpost, dropGood, placeResource } from './world-edit.js';

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
 *  - `upgradeBuilding` — re-open a built building as a construction site rising into its type's
 *    `upgradeTarget` level (see {@link upgradeBuilding}): inventory stashed, separate build hold, occupants
 *    walk out with bindings kept. Skipped for a target that is not a built, chained, tech-unlocked building.
 *  - `cancelUpgrade` — abort an in-flight upgrade (see {@link cancelUpgrade}): the stash returns, the
 *    building stands again at its previous level, delivered site materials are lost. Skipped for a
 *    target that is not upgrading.
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
      placeResource(world, ctx, command);
      return;
    case 'dropGood':
      dropGood(world, ctx, command);
      return;
    case 'upgradeBuilding':
      upgradeBuilding(world, ctx, command);
      return;
    case 'cancelUpgrade':
      cancelUpgrade(world, command);
      return;
    case 'demolish':
      demolish(world, command);
      return;
    case 'demolishSignpost':
      demolishSignpost(world, command);
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
    case 'placeSignpost':
      placeSignpost(world, ctx, command);
      return;
    case 'setSignpostNavigation':
      setSignpostNavigation(world, command.enabled);
      return;
    case 'setCraftGoods':
      setCraftGoods(world, ctx, command);
      return;
    case 'marry':
      marry(world, ctx, command);
      return;
    case 'assignHouse':
      assignHouse(world, ctx, command);
      return;
    case 'makeChild':
      makeChild(world, ctx, command);
      return;
    case 'setNeedsEnabled':
      setNeedsEnabled(world, command.enabled);
      return;
    case 'setFogMode':
      setFogMode(world, command.mode);
      return;
    case 'setPlayerAi': {
      // Attach/detach the strategic AI on a seat (the per-player AiPlayer carrier — the rules-singleton
      // pattern, keyed by player): created on first enable, updated in place thereafter, destroyed on
      // disable. The flag drives the AiPlayerSystem, so it hashes/replays like any component. An
      // out-of-range player is skipped (still logged for faithful replay).
      if (!isValidPlayer(command.player)) return;
      const carrier = aiPlayerEntity(world, command.player);
      if (!command.enabled) {
        if (carrier !== null) world.destroy(carrier);
        return;
      }
      const modules = aiModuleEnables(command.modules);
      if (carrier === null) world.add(world.create(), AiPlayer, { player: command.player, modules });
      else world.get(carrier, AiPlayer).modules = modules;
      return;
    }
    case 'debugKill':
      debugKill(world, command);
      return;
    case 'debugSetNeeds':
      debugSetNeeds(world, command);
      return;
    case 'debugFillStockpile':
      debugFillStockpile(world, ctx, command);
      return;
    case 'debugCompleteConstruction':
      forceFinishConstruction(world, ctx, command.target);
      return;
    default:
      assertNever(command);
  }
}
