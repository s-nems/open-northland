import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import {
  type EnemyFire,
  enemyFire,
  enemyPosts,
  raidOnTheSettlement,
  seatRaiders,
} from '../military/defence/index.js';

/** What the enemy's fighters mean for the seat's building this decision. */
export interface Siege {
  /**
   * Whether the seat is under attack: the defence's raid test ({@link raidOnTheSettlement}) finds an enemy
   * fighter inside some building's watch band, on ground its door reaches, with the alarm's stand-down
   * margin as hysteresis. One definition serves both, so the build order holds exactly while the seat has
   * a raid to go out at. A parked band inside a band draws the sortie, so the hold ends when that fight
   * does; a man the seat cannot walk to never holds it.
   */
  readonly attacked: boolean;
  /** Whether a site on a node would rise inside an enemy fighter's reach, a tower garrison's included:
   *  the garrison never raids, but it shoots down whatever is raised under its post. */
  readonly underFire: EnemyFire;
}

/** Cost: one walk over every person ({@link seatRaiders}, the scan the military module makes too, with no
 *  cache shared between the two) and one over the garrison markers. */
export function seatSiege(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
): Siege {
  const raiders = seatRaiders(world, ctx, terrain, player);
  return {
    attacked: raidOnTheSettlement(world, ctx, terrain, owned, raiders) !== null,
    underFire: enemyFire([...raiders, ...enemyPosts(world, ctx, terrain, player)]),
  };
}
