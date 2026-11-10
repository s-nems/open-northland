import type { MissionResultOp } from '../script.js';

/** The seat a result stands something on the map for or hands something to; null for every other
 *  result. */
export function receivingSeat(result: MissionResultOp): number | null {
  switch (result.opcode) {
    case 'SetHuman':
    case 'SetHumanX':
    case 'SetAnimal':
    case 'SetVehicle':
    case 'SetHouse':
    case 'ChangeHumanPlayerId':
    case 'ChangeHousesPlayerId':
    case 'ChangeVehiclesPlayerId':
      return result.player;
    case 'ChangePlayerPlayerId':
    case 'ChangePlayerIdInArea':
    case 'ChangeAnimalPlayerIdInArea':
      return result.otherPlayer;
    default:
      return null;
  }
}
