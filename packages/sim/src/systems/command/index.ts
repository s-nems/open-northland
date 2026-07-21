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
  unassignHouse,
} from '../orders/index.js';
import { debugFillStockpile, debugKill, debugSetNeeds } from './debug.js';
import { cancelUpgrade, placeBoat, placeBuilding, upgradeBuilding } from './placement.js';
import { demolish, demolishSignpost, dropGood, placeResource } from './world-edit.js';

/**
 * Apply queued external commands in FIFO order, then record each one for deterministic replay. Command
 * variants own their validation and treat stale ids as recoverable input so one rejected order cannot abort
 * the tick.
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
      demolish(world, ctx, command);
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
    case 'unassignHouse':
      unassignHouse(world, ctx, command);
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
