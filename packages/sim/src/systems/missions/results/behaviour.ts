import {
  MISSION_BEHAVIOUR,
  Person,
  setHouseBehaviour,
  setMissionBehaviour,
} from '../../../components/index.js';
import type { MissionPass } from '../pass.js';
import { missionHouses, missionHumans, ownedBy } from '../targets.js';

/** The shift-count mask a 32-bit word imposes: the original's shift reads the index's low five bits,
 *  so an out-of-range index wraps rather than clearing the word. */
const BIT_INDEX_MASK = 31;

/** Set or clear a mask on every human with the id. */
export function setHumansBehaviour(pass: MissionPass, id: number, mask: number, on: boolean): void {
  for (const e of missionHumans(pass.world, id)) setMissionBehaviour(pass.world, e, mask, on);
}

/** Set or clear a mask on every human the player owns right now. Humans it gains later do not inherit
 *  it: the original writes the mask through once and keeps no per-player copy. */
export function setPlayerBehaviour(pass: MissionPass, player: number, mask: number, on: boolean): void {
  const { world } = pass;
  for (const e of world.query(Person)) {
    if (ownedBy(world, e, player)) setMissionBehaviour(world, e, mask, on);
  }
}

/** The import marker, the one bit with a result of its own. */
export function setImportMarker(pass: MissionPass, id: number, on: boolean): void {
  setHumansBehaviour(pass, id, MISSION_BEHAVIOUR.IMPORTED, on);
}

/** Set or clear one bit on every house with the object id. This line names a bit index where the human
 *  ones name a mask. */
export function setHousesBehaviourBit(pass: MissionPass, id: number, index: number, on: boolean): void {
  const mask = 1 << (index & BIT_INDEX_MASK);
  for (const e of missionHouses(pass.world, id)) setHouseBehaviour(pass.world, e, mask, on);
}
