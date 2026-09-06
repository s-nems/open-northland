import {
  addPaper,
  setDiplomacyStance,
  setFogMode,
  setMatchParticipants,
  setMissionsEnabled,
  setNeedsEnabled,
  setPlayerPlacementTribes,
  setProfessionProgression,
  setSignpostNavigation,
} from '../../components/index.js';
import { assertNever } from '../../core/brand.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { forceFinishConstruction } from '../economy/construction.js';
// Deliberately the module, not the orders barrel: the handler reaches into
// `ai-player/assistant-counters.js` for the published-counter map, and routing that through the
// barrel would widen its import graph.
import { setPlayerAi } from '../orders/ai.js';
import {
  assignBuilder,
  assignHouse,
  assignWorker,
  attackMoveUnit,
  attackUnit,
  cancelTraining,
  equipGood,
  exploreArea,
  makeChild,
  marry,
  moveUnit,
  orderNeed,
  orderOpenChest,
  placeSignpost,
  setAssistantCounter,
  setAssistantGrant,
  setCraftGoods,
  setDefenceMode,
  setGatherGood,
  setJob,
  setRegeneration,
  setStance,
  setWorkFlag,
  trainSoldier,
  unassignBuilder,
  unassignHouse,
  unassignWorker,
  unequipGood,
} from '../orders/index.js';
import { spawnAnimalHerd, spawnSettler } from '../spawn/index.js';
import { isAuthorized } from './authority.js';
import { debugFillStockpile, debugKill, debugSetNeeds } from './debug.js';
import { cancelUpgrade, placeBoat, placeBuilding, upgradeBuilding } from './placement.js';
import { demolish, demolishSignpost, dropGood, placeResource } from './world-edit.js';

/**
 * Apply the commands due this tick in the queue's order, then record each one for deterministic replay.
 * One the origin may not issue is recorded without being applied. Command variants own their payload
 * validation and treat stale ids as recoverable input, so one rejected order cannot abort the tick.
 */
export const commandSystem: System = (world, ctx) => {
  for (const queued of ctx.commands.drain(ctx.tick)) {
    if (isAuthorized(world, queued)) applyCommand(world, ctx, queued.command);
    ctx.commands.record(ctx.tick, queued);
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
    case 'attackMoveUnit':
      attackMoveUnit(world, ctx, command);
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
    case 'unassignWorker':
      unassignWorker(world, ctx, command);
      return;
    case 'assignBuilder':
      assignBuilder(world, ctx, command);
      return;
    case 'unassignBuilder':
      unassignBuilder(world, command);
      return;
    case 'trainSoldier':
      trainSoldier(world, ctx, command);
      return;
    case 'cancelTraining':
      cancelTraining(world, command);
      return;
    case 'orderNeed':
      orderNeed(world, command);
      return;
    case 'setRegeneration':
      setRegeneration(world, command);
      return;
    case 'exploreArea':
      exploreArea(world, ctx, command);
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
    case 'openChest':
      orderOpenChest(world, ctx, command);
      return;
    case 'grantPaper':
      addPaper(world, command.player, command.paper);
      return;
    case 'setSignpostNavigation':
      setSignpostNavigation(world, command.enabled);
      return;
    case 'setProfessionProgression':
      setProfessionProgression(world, command.enabled);
      return;
    case 'setCraftGoods':
      setCraftGoods(world, ctx, command);
      return;
    case 'setDefenceMode':
      setDefenceMode(world, ctx, command);
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
    case 'equipGood':
      equipGood(world, ctx, command);
      return;
    case 'unequipGood':
      unequipGood(world, ctx, command);
      return;
    case 'setAssistantGrant':
      setAssistantGrant(world, ctx, command);
      return;
    case 'setAssistantCounter':
      setAssistantCounter(world, ctx, command);
      return;
    case 'setPlayerPlacementTribes':
      setPlayerPlacementTribes(world, ctx.content, command.player, command.tribes);
      return;
    case 'setNeedsEnabled':
      setNeedsEnabled(world, command.enabled);
      return;
    case 'setMissionsEnabled':
      setMissionsEnabled(world, command.enabled);
      return;
    case 'setFogMode':
      setFogMode(world, command.mode);
      return;
    case 'setDiplomacy':
      setDiplomacyStance(world, command.from, command.to, command.state);
      return;
    case 'setMatchParticipants':
      setMatchParticipants(world, command.players);
      return;
    case 'setPlayerAi':
      setPlayerAi(world, command);
      return;
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
