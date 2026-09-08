import { type MissionPass, setMissionActive } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import { placeScriptedHouse, setScriptedHouseLevel } from './houses.js';
import { stampHumansInRange, stampPlayerHumans } from './object-id.js';
import {
  handAnimalsToPlayer,
  handAreaToPlayer,
  handHousesToPlayer,
  handHumansToPlayer,
  handPlayerToPlayer,
} from './ownership.js';
import { removeScriptedAnimals, removeScriptedHouses, removeScriptedHumans } from './remove.js';
import { spawnScriptedAnimal, spawnScriptedHumans } from './spawn.js';

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
    case 'ChangeMissionIdOfHumanInRange':
    case 'ChangeHumanObjectIdInArea':
      stampHumansInRange(pass, result.player, result.humanId, result.point, result.range);
      return;
    default:
      pass.report(index, result.opcode);
  }
}
