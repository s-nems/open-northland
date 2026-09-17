import { Person, Position } from '../../../components/index.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { removeBuildingSilently } from '../../lifecycle/cleanup.js';
import { removeSettlerSilently } from '../../lifecycle/death.js';
import type { MissionPass } from '../pass.js';
import { missionAnimals, missionHouses, missionHumans, withinRange } from '../targets.js';

/** Take every entity stamped with the line's object id off the board, without killing it - see
 *  `PlayerTally` for what a script removal deliberately does not count. */
export function removeScriptedHumans(pass: MissionPass, id: number): void {
  for (const e of missionHumans(pass.world, id)) removeSettlerSilently(pass.world, e);
}

export function removeScriptedAnimals(pass: MissionPass, id: number): void {
  for (const e of missionAnimals(pass.world, id)) removeSettlerSilently(pass.world, e);
}

/** Take every human within `range` of the point off the board, whoever owns it. */
export function removeHumansNearPoint(pass: MissionPass, point: HalfCellNode, range: number): void {
  const { world } = pass;
  // Snapshot, not a sorted list: every match goes, so no order can pick a winner - but the loop
  // destroys what it is walking.
  for (const e of [...world.query(Person, Position)]) {
    if (withinRange(world, e, point, range)) removeSettlerSilently(world, e);
  }
}

export function removeScriptedHouses(pass: MissionPass, id: number): void {
  for (const e of missionHouses(pass.world, id)) removeBuildingSilently(pass.world, pass.ctx, e);
}
