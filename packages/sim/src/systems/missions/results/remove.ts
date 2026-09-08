import type { Entity, World } from '../../../ecs/world.js';
import { unbindWorkersOf } from '../../command/placement.js';
import type { SystemContext } from '../../context.js';
import { removeSettlerSilently } from '../../lifecycle/cleanup.js';
import type { MissionPass } from '../pass.js';
import { missionAnimals, missionHouses, missionHumans } from '../targets.js';

/** Take every entity stamped with the line's object id off the board, without killing it - see
 *  `PlayerTally` for what a script removal deliberately does not count. */
export function removeScriptedHumans(pass: MissionPass, id: number): void {
  for (const e of missionHumans(pass.world, id)) removeSettlerSilently(pass.world, e);
}

export function removeScriptedAnimals(pass: MissionPass, id: number): void {
  for (const e of missionAnimals(pass.world, id)) removeSettlerSilently(pass.world, e);
}

export function removeScriptedHouses(pass: MissionPass, id: number): void {
  for (const e of missionHouses(pass.world, id)) removeHouse(pass.world, pass.ctx, e);
}

/** The building's occupants keep no binding to a house that is gone. */
function removeHouse(world: World, ctx: SystemContext, e: Entity): void {
  unbindWorkersOf(world, ctx, e);
  world.destroy(e);
}
