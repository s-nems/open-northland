import {
  addPaper,
  setAlliedVision,
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
import { type Command, MAX_UNIT_MEMBER_ACTIONS, MAX_UNIT_ORDER_MEMBERS } from '../../core/commands/index.js';
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
  clearHaulFlag,
  declareDiplomacy,
  equipGood,
  exploreArea,
  makeChild,
  marry,
  moveUnit,
  orderClaimAnimal,
  orderNeed,
  orderOpenChest,
  placeSignpost,
  renameSettler,
  setAssistantCounter,
  setAssistantGrant,
  setAssistantMoveFlags,
  setAssistantPostGraduates,
  setAssistantWeaponVeto,
  setDefenceMode,
  setGatherGood,
  setJob,
  setProductionCount,
  setProductionGoods,
  setRegeneration,
  setStance,
  setWorkFlag,
  trainSoldier,
  unassignBuilder,
  unassignHouse,
  unassignWorker,
  unequipGood,
} from '../orders/index.js';
import { obeyDespiteHunger } from '../orders/meal-break.js';
import { isQueuedOrder, queueBehindCurrentOrder } from '../orders/queue.js';
import { setPalisadeGateMode } from '../palisades/gate-control.js';
import { convertPalisadeGate, placePalisade, setPalisadeGate } from '../palisades/index.js';
import { cancelRoadSite, placeRoadSite } from '../roads/sites.js';
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
import { VehicleOrderRoutes } from '../vehicles/order-routes.js';
import { authorizedCommand } from './authority.js';
import { debugFillStockpile, debugKill, debugSetHealth, debugSetNeeds, debugTeleport } from './debug.js';
import { cancelUpgrade, placeBuilding, upgradeBuilding } from './placement.js';
import { demolish, demolishSignpost, dropGood, placeResource } from './world-edit.js';

/**
 * Apply the commands due this tick in the queue's order, then record each one for deterministic replay.
 * One the origin may not issue is recorded without being applied. Command variants own their payload
 * validation and treat stale ids as recoverable input, so one rejected order cannot abort the tick.
 */
export const commandSystem: System = (world, ctx) => {
  // The pass's vehicle gotos share their long routes, so a group order costs about one search.
  const orders = new VehicleOrderRoutes();
  for (const queued of ctx.commands.drain(ctx.tick)) {
    const command = authorizedCommand(world, queued, ctx.terrain);
    if (command !== undefined) {
      applyCommand(world, ctx, command, orders);
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

function applyCommand(world: World, ctx: SystemContext, command: Command, orders: VehicleOrderRoutes): void {
  // A Shift-clicked order waits behind the current one; an order that takes the settler at once drops
  // every order still waiting in its handler.
  if (isQueuedOrder(command) && queueBehindCurrentOrder(world, command)) return;
  // A vehicle's commander hands a walk order to the vehicle. Any other settler crewing a vehicle is
  // taken off it before an order sends it elsewhere; one that may not leave (aboard a ship at sea)
  // keeps its seat and the order is dropped.
  if (isCommanderWalkOrder(command) && driveCommandedVehicle(world, ctx, command, orders)) return;
  if (forcesDetach(command) && !detachBeforeOrder(world, ctx, command.entity)) return;
  switch (command.kind) {
    case 'setVehicleStanceGroup':
      if (command.members.length > MAX_UNIT_ORDER_MEMBERS) return;
      for (const { entity: vehicle } of command.members)
        setVehicleStance(world, { kind: 'setVehicleStance', vehicle, stance: command.stance });
      return;
    case 'moveVehicleGroup':
      if (command.members.length > MAX_UNIT_ORDER_MEMBERS) return;
      for (const { entity: vehicle, x, y } of command.members) {
        applyCommand(
          world,
          ctx,
          { kind: 'moveVehicle', vehicle, x, y, ...(command.attackMove ? { attackMove: true } : {}) },
          orders,
        );
      }
      return;
    case 'attackWithVehicleGroup':
      if (command.members.length > MAX_UNIT_ORDER_MEMBERS) return;
      for (const { entity: vehicle } of command.members)
        applyCommand(world, ctx, { kind: 'attackWithVehicle', vehicle, target: command.target }, orders);
      return;
    case 'unitOrdersGroup':
      if (
        command.members.length > MAX_UNIT_ORDER_MEMBERS ||
        command.members.some((member) => member.actions.length > MAX_UNIT_MEMBER_ACTIONS)
      )
        return;
      for (const { entity, actions } of command.members) {
        for (const action of actions) applyCommand(world, ctx, { ...action, entity }, orders);
      }
      return;
    case 'unitActionGroup':
      if (command.members.length > MAX_UNIT_ORDER_MEMBERS) return;
      for (const { entity } of command.members) {
        applyCommand(world, ctx, { ...command.action, entity }, orders);
      }
      return;
    case 'moveUnitGroup':
    case 'attackMoveUnitGroup': {
      if (command.members.length > MAX_UNIT_ORDER_MEMBERS) return;
      const kind = command.kind === 'moveUnitGroup' ? 'moveUnit' : 'attackMoveUnit';
      for (const member of command.members) {
        applyCommand(world, ctx, { kind, ...member, ...(command.queued ? { queued: true } : {}) }, orders);
      }
      return;
    }
    case 'attackUnitGroup':
    case 'setStanceGroup':
    case 'setRegenerationGroup':
      if (command.members.length > MAX_UNIT_ORDER_MEMBERS) return;
      for (const { entity } of command.members) {
        const single: Command =
          command.kind === 'attackUnitGroup'
            ? { kind: 'attackUnit', entity, target: command.target }
            : command.kind === 'setStanceGroup'
              ? { kind: 'setStance', entity, mode: command.mode }
              : { kind: 'setRegeneration', entity, enabled: command.enabled };
        applyCommand(world, ctx, single, orders);
      }
      return;
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
    case 'setPalisadeGateMode':
      setPalisadeGateMode(world, command);
      return;
    case 'setPalisadeGate':
      setPalisadeGate(world, ctx, command);
      return;
    case 'demolishPalisade':
      razePalisade(world, ctx, command.palisade);
      return;
    case 'placeRoadSite':
      placeRoadSite(world, ctx, command);
      return;
    case 'cancelRoadSite':
      cancelRoadSite(world, ctx, command.roadSite);
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
      obeyDespiteHunger(world, ctx, command.entity, () => moveUnit(world, ctx, command));
      return;
    case 'moveVehicle':
      moveVehicle(world, ctx, command, orders);
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
      obeyDespiteHunger(world, ctx, command.entity, () => attackMoveUnit(world, ctx, command));
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
      obeyDespiteHunger(world, ctx, command.entity, () => exploreArea(world, ctx, command));
      return;
    case 'setWorkFlag':
      setWorkFlag(world, ctx, command);
      return;
    case 'clearHaulFlag':
      clearHaulFlag(world, command);
      return;
    case 'setGatherGood':
      setGatherGood(world, ctx, command);
      return;
    case 'setHouseholdGoodUse':
      setHouseholdGoodUse(world, ctx, command);
      return;
    case 'placeSignpost':
      obeyDespiteHunger(world, ctx, command.entity, () => placeSignpost(world, ctx, command));
      return;
    case 'openChest':
      obeyDespiteHunger(world, ctx, command.entity, () => orderOpenChest(world, ctx, command));
      return;
    case 'claimAnimal':
      obeyDespiteHunger(world, ctx, command.entity, () => orderClaimAnimal(world, ctx, command));
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
    case 'setProductionGoods':
      setProductionGoods(world, ctx, command);
      return;
    case 'setProductionCount':
      setProductionCount(world, ctx, command);
      return;
    case 'setDefenceMode':
      setDefenceMode(world, ctx, command);
      return;
    case 'marry':
      marry(world, ctx, command);
      return;
    case 'renameSettler':
      renameSettler(world, ctx, command);
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
    case 'setAssistantPostGraduates':
      setAssistantPostGraduates(world, command);
      return;
    case 'setAssistantMoveFlags':
      setAssistantMoveFlags(world, command);
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
    case 'setTradeImportLimits':
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
    case 'setAlliedVision':
      setAlliedVision(world, command.enabled);
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
    case 'debugSetHealth':
      debugSetHealth(world, command);
      return;
    case 'debugSetNeeds':
      // Commands apply before the tick's needs pass.
      debugSetNeeds(world, ctx.tick - 1, command);
      return;
    case 'debugFillStockpile':
      debugFillStockpile(world, ctx, command);
      return;
    case 'debugCompleteConstruction':
      forceFinishConstruction(world, ctx, command.target);
      return;
    case 'debugTeleport':
      debugTeleport(world, ctx, command);
      return;
    default:
      assertNever(command);
  }
}
