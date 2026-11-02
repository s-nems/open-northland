import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { ownedBuildings, ownedSettlers } from './seat-roster.js';

/** The seat's buildings at home, ascending id: what the computer player runs its settlement by. */
export function homeBuildings(world: World, _ctx: SystemContext, seat: number): readonly Entity[] {
  return ownedBuildings(world, seat);
}

/** The seat's people at home, ascending id. */
export function homeSettlers(world: World, _ctx: SystemContext, seat: number): readonly Entity[] {
  return ownedSettlers(world, seat);
}

/** Every building of a seat, a colony's included: for a read of another seat or of all a seat holds. The
 *  computer player reaches for {@link homeBuildings} first; biome keeps the bare roster out of its folder. */
export const everyBuildingOf = ownedBuildings;

/** Every person of a seat, a colony's included ({@link everyBuildingOf}). */
export const everySettlerOf = ownedSettlers;
