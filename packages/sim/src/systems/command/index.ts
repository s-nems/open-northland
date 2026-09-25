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
import { setHouseholdGoodUse } from '../family/home-quality.js';
import { razePalisade } from '../lifecycle/cleanup.js';
import { payTribute } from '../missions/tributes.js';
// Deliberately the module, not the orders barrel: the handler reaches into
// `ai-player/assistant-counters.js` for the published-counter map, and routing that through the
// barrel would widen its import graph.
import { setPlayerAi } from '../orders/ai.js';
import { learn } from '../orders/education.js';
import {
  assignBuilder,
  assignHouse,
  assignHouseGroup,
  assignWorker,
  assignWorkerGroup,
  attackMoveUnit,
  attackUnit,
  cancelTraining,
  declareDiplomacy,
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
  setAssistantWeaponVeto,
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
import { convertPalisadeGate, placePalisade, setPalisadeGate } from '../palisades/index.js';
import { wakeIdle } from '../settlers/planner/idle-replan.js';
import { spawnAnimalHerd, spawnSettler } from '../spawn/index.js';
import { applyTradeCommand, registerTradeAgreement } from '../trade/index.js';
import {
  attachToVehicle,
  attackWithVehicle,
  boardVehicle,
  clearVehicleWantedOrder,
  createVehicle,
  detachBeforeOrder,
  detachFromVehicle,
  dockVehicle,
  driveCommandedVehicle,
  forcesDetach,
  isCommanderWalkOrder,
  leaveCarrier,
  loadIntoVehicle,
  moveVehicle,
  setVehicleStance,
  setVehicleWantedOrder,
  stopVehicle,
  unloadPeople,
} from '../vehicles/index.js';
import { authorizedCommand } from './authority.js';
import { debugFillStockpile, debugKill, debugSetNeeds } from './debug.js';
import { cancelUpgrade, placeBuilding, upgradeBuilding } from './placement.js';
import { demolish, demolishSignpost, dropGood, placeResource } from './world-edit.js';

/**
 * Apply the commands due this tick in the queue's order, then record each one for deterministic replay.
 * One the origin may not issue is recorded without being applied. Command variants own their payload
 * validation and treat stale ids as recoverable input, so one rejected order cannot abort the tick.
 */
export const commandSystem: System = (world, ctx) => {
  for (const queued of ctx.commands.drain(ctx.tick)) {
    const command = authorizedCommand(world, queued, ctx.terrain);
    if (command !== undefined) {
      applyCommand(world, ctx, command);
      wakeAddressed(world, command);
    }
    ctx.commands.record(ctx.tick, queued);
  }
};

/** An order acts on the tick it applies, so the settlers it names drop their idle wait. Every player order
 *  to a settler names it in `entity`, or its group in `members`; a debug edit waits like any change. */
function wakeAddressed(world: World, command: Command): void {
  if ('entity' in command) wakeIdle(world, command.entity);
  if ('members' in command) for (const member of command.members) wakeIdle(world, member.entity);
}

function applyCommand(world: World, ctx: SystemContext, command: Command): void {
  // A vehicle's commander hands a walk order to the vehicle. Any other settler crewing a vehicle is
  // taken off it before an order sends it elsewhere; one that may not leave (aboard a ship at sea)
  // keeps its seat and the order is dropped.
  if (isCommanderWalkOrder(command) && driveCommandedVehicle(world, ctx, command)) return;
  if (forcesDetach(command) && !detachBeforeOrder(world, ctx, command.entity)) return;
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
    case 'createVehicle':
      createVehicle(world, ctx, command);
      return;
    case 'placeResource':
      placeResource(world, ctx, command);
      return;
    case 'placePalisade':
      placePalisade(world, ctx, command);
      return;
    case 'convertPalisadeGate':
      convertPalisadeGate(world, ctx, command);
      return;
    case 'setPalisadeGate':
      setPalisadeGate(world, ctx, command);
      return;
    case 'demolishPalisade':
      razePalisade(world, ctx, command.palisade);
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
    case 'moveVehicle':
      moveVehicle(world, ctx, command);
      return;
    case 'dockVehicle':
      dockVehicle(world, ctx, command);
      return;
    case 'stopVehicle':
      stopVehicle(world, command);
      return;
    case 'attachToVehicle':
      attachToVehicle(world, ctx, command);
      return;
    case 'detachFromVehicle':
      detachFromVehicle(world, ctx, command);
      return;
    case 'boardVehicle':
      boardVehicle(world, ctx, command);
      return;
    case 'unloadPeople':
      unloadPeople(world, ctx, command);
      return;
    case 'setVehicleWanted':
      setVehicleWantedOrder(world, ctx, command);
      return;
    case 'clearVehicleWanted':
      clearVehicleWantedOrder(world, ctx, command);
      return;
    case 'loadIntoVehicle':
      loadIntoVehicle(world, ctx, command);
      return;
    case 'leaveCarrier':
      leaveCarrier(world, ctx, command);
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
    case 'setVehicleStance':
      setVehicleStance(world, command);
      return;
    case 'attackWithVehicle':
      attackWithVehicle(world, ctx, command);
      return;
    case 'assignWorker':
      assignWorker(world, ctx, command);
      return;
    case 'assignWorkerGroup':
      assignWorkerGroup(world, ctx, command);
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
    case 'learn':
      learn(world, ctx, command);
      return;
    case 'trainSoldier':
      trainSoldier(world, ctx, command);
      return;
    case 'cancelTraining':
      cancelTraining(world, command);
      return;
    case 'orderNeed':
      orderNeed(world, ctx, command);
      return;
    case 'setRegeneration':
      setRegeneration(world, ctx, command);
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
    case 'setHouseholdGoodUse':
      setHouseholdGoodUse(world, ctx, command);
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
    case 'assignHouseGroup':
      assignHouseGroup(world, ctx, command);
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
    case 'setAssistantWeaponVeto':
      setAssistantWeaponVeto(world, ctx, command);
      return;
    case 'setAssistantCounter':
      setAssistantCounter(world, ctx, command);
      return;
    case 'setPlayerPlacementTribes':
      setPlayerPlacementTribes(world, ctx.content, command.player, command.tribes);
      return;
    case 'payTribute':
      payTribute(world, ctx, command);
      return;
    case 'declareDiplomacy':
      declareDiplomacy(world, command);
      return;
    case 'attachTradeHouse':
    case 'detachTradeHouse':
    case 'setTradeImport':
    case 'clearTradeImports':
    case 'setTradeAgreement':
      applyTradeCommand(world, ctx, command);
      return;
    case 'addTradeAgreement':
      registerTradeAgreement(world, ctx, command);
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
    case 'setSharedVision':
      ctx.fog?.shareVision(command.players);
      return;
    case 'setDiplomacy':
      setDiplomacyStance(world, command.from, command.to, command.state);
      return;
    case 'setMatchParticipants':
      setMatchParticipants(world, command.players, command.victory);
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
