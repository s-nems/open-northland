import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { raidOnTheSettlement, seatRaiders } from '../military/defence/index.js';

/**
 * Whether the seat is under attack: the defence's raid test ({@link raidOnTheSettlement}) finds an enemy
 * fighter inside some building's watch band, on ground its door reaches, with the alarm's stand-down margin
 * as hysteresis. One definition serves both, so the build order holds exactly while the seat has a raid
 * to go out at; a shooter hitting a building stands inside its band anyway.
 *
 * A parked band inside a band draws the sortie, so the hold ends when that fight does; a man the seat
 * cannot walk to never holds it. Cost: {@link seatRaiders} walks every person once per decision, the same
 * scan the military module makes, with no cache shared between the two.
 */
export function seatUnderAttack(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
): boolean {
  const raiders = seatRaiders(world, ctx, terrain, player);
  return raidOnTheSettlement(world, ctx, terrain, owned, raiders) !== null;
}
