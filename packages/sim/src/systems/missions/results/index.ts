import { type MissionPass, setMissionActive } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import {
  setHousesBehaviourBit,
  setHumansBehaviour,
  setImportMarker,
  setPlayerBehaviour,
} from './behaviour.js';
import { addGoodsToAnyStock, addGoodsToArea, addGoodsToHouses, removeGoodsFromArea } from './goods.js';
import { damageHousesInArea, healHumansInArea } from './health.js';
import { placeScriptedHouse, setScriptedHouseLevel } from './houses.js';
import { moveUnitsInArea, sendScriptedHumans, stopPlayerHumans, teleportScriptedHumans } from './movement.js';
import { stampHumansInRange, stampPlayerHumans } from './object-id.js';
import {
  handAnimalsToPlayer,
  handAreaToPlayer,
  handHousesToPlayer,
  handHumansToPlayer,
  handPlayerToPlayer,
} from './ownership.js';
import {
  removeHumansNearPoint,
  removeScriptedAnimals,
  removeScriptedHouses,
  removeScriptedHumans,
} from './remove.js';
import { spawnScriptedAnimal, spawnScriptedHumans } from './spawn.js';
import {
  declareScriptedVerdict,
  exploreScriptedArea,
  lockScriptedStance,
  setScriptedAiFlag,
  setScriptedStance,
} from './standing.js';
import { grantUnlock } from './tech.js';

/** Execute one result of mission `index`. An opcode with no executor is reported and does nothing;
 *  nothing here throws, because a corpus script must never halt a running world. */
export function executeResult(pass: MissionPass, index: number, result: MissionResultOp): void {
  switch (result.opcode) {
    case 'None':
      return;
    case 'ActivateMission':
      setMissionActive(pass, result.missionIndex, true);
      return;
    case 'DeactivateMission':
      setMissionActive(pass, result.missionIndex, false);
      return;
    case 'DisableAll':
      for (const record of pass.records) record.active = false;
      return;
    case 'SetVisible': {
      const target = pass.records[result.missionIndex];
      if (target !== undefined) target.visible = result.flag;
      return;
    }
    case 'Exit':
      pass.ctx.events.emit({ kind: 'missionExit', mission: index });
      return;
    case 'SetHuman':
      spawnScriptedHumans(pass, result, 1);
      return;
    case 'SetHumanX':
      spawnScriptedHumans(pass, result, result.amount);
      return;
    case 'SetAnimal':
      spawnScriptedAnimal(pass, result);
      return;
    case 'SetHouse':
      placeScriptedHouse(pass, index, result);
      return;
    case 'SetHouseExtensionLevel':
      setScriptedHouseLevel(pass, result.objectId, result.amount);
      return;
    case 'RemoveHumans':
      removeScriptedHumans(pass, result.humanId);
      return;
    case 'RemoveAnimals':
      removeScriptedAnimals(pass, result.objectId);
      return;
    case 'RemoveHouses':
      removeScriptedHouses(pass, result.objectId);
      return;
    case 'ChangeHumanPlayerId':
      handHumansToPlayer(pass, result.humanId, result.player);
      return;
    case 'ChangeHousesPlayerId':
      handHousesToPlayer(pass, result.objectId, result.player);
      return;
    case 'ChangePlayerPlayerId':
      handPlayerToPlayer(pass, result.player, result.otherPlayer);
      return;
    case 'ChangePlayerIdInArea':
      handAreaToPlayer(pass, result);
      return;
    case 'ChangeAnimalPlayerIdInArea':
      handAnimalsToPlayer(pass, result);
      return;
    case 'ChangeMissionIdOfPlayer':
      stampPlayerHumans(pass, result.player, result.humanId);
      return;
    case 'SendHuman':
      sendScriptedHumans(pass, result.humanId, result.point);
      return;
    case 'MoveHuman':
      teleportScriptedHumans(pass, result.humanId, result.point);
      return;
    case 'MoveUnitsInArea':
      moveUnitsInArea(pass, result);
      return;
    case 'StopHumanByPlayerId':
      stopPlayerHumans(pass, result.player);
      return;
    case 'RemoveHumansNearPos':
      removeHumansNearPoint(pass, result.point, result.range);
      return;
    case 'HealHumansInArea':
      healHumansInArea(pass, result.point, result.range);
      return;
    case 'RemoveHPsOfHousesInArea':
    case 'RemoveHPsOfHousesInAreaX':
      damageHousesInArea(pass, result);
      return;
    case 'SetHumanBehaviourFlag':
      setHumansBehaviour(pass, result.humanId, result.amount, result.flag);
      return;
    case 'SetPlayerBehaviourFlag':
      setPlayerBehaviour(pass, result.player, result.amount, result.flag);
      return;
    case 'SetImportHumanFlag':
      setImportMarker(pass, result.humanId, result.flag);
      return;
    case 'SetHouseBehaviourFlag':
      setHousesBehaviourBit(pass, result.objectId, result.index, result.flag);
      return;
    case 'ChangeMissionIdOfHumanInRange':
    case 'ChangeHumanObjectIdInArea':
      stampHumansInRange(pass, result.player, result.humanId, result.point, result.range);
      return;
    case 'AddGoodsToHouses':
      addGoodsToHouses(pass, result.objectId, result.good, result.amount);
      return;
    case 'AddGoodsToAnyStock':
      addGoodsToAnyStock(pass, result.player, result.good, result.amount);
      return;
    case 'AddGoodsToMapArea':
      addGoodsToArea(pass, index, result);
      return;
    case 'RemoveGoodsFromMapArea':
      removeGoodsFromArea(pass, index, result);
      return;
    case 'AllowJob':
    case 'EnableJob':
    case 'AllowHouse':
    case 'EnableHouse':
    case 'AllowGood':
    case 'EnableGood':
      grantUnlock(pass, result);
      return;
    case 'SetDiplomacy':
      setScriptedStance(pass, index, result);
      return;
    case 'SetDiplomacyNotChangeableFlag':
      lockScriptedStance(pass, index, result);
      return;
    case 'MissionWon':
    case 'MissionFailed':
      declareScriptedVerdict(pass, index, result);
      return;
    case 'ExploreArea':
      exploreScriptedArea(pass, index, result);
      return;
    case 'SetExternalFlag':
      setScriptedAiFlag(pass, index, result);
      return;
    default:
      pass.report(index, result.opcode);
  }
}
