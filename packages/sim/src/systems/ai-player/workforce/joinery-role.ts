import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { withinNodeRadius } from '../../../nav/node-circle.js';
import type { SystemContext } from '../../context.js';
import { CATAPULT_JOINERY_REACH } from '../build-order/entries.js';
import { anchorsOfId } from '../build-order/placement.js';
import { anchorNodeOf } from '../node-geometry.js';
import { enemyOverSea } from '../sea-route.js';
import { ownedBuildings } from '../seat-roster.js';

/** What a top-tier joinery's crew builds. */
export type JoineryRole = 'catapult' | 'ship';

/**
 * One decision's reader of each top-tier joinery's role, read off where it stands so no state is kept: a
 * joinery within {@link CATAPULT_JOINERY_REACH} of one of the seat's barracks builds catapults, any other
 * builds ships while the nearest enemy lies over the sea ({@link enemyOverSea}), and catapults otherwise.
 * The barracks and the sea answer are looked up once, on the first joinery asked about.
 */
export function joineryRoles(
  world: World,
  ctx: SystemContext,
  player: number,
): (joinery: Entity) => JoineryRole {
  let barracks: readonly HalfCellNode[] | undefined;
  let overSea: boolean | undefined;
  return (joinery) => {
    barracks ??= anchorsOfId(
      world,
      contentIndex(ctx.content),
      ownedBuildings(world, player),
      CATAPULT_JOINERY_REACH.building,
    ).flatMap((e) => anchorNodeOf(world, e) ?? []);
    const at = anchorNodeOf(world, joinery);
    const byBarracks =
      at !== null &&
      barracks.some((b) => withinNodeRadius(b.hx, b.hy, at.hx, at.hy, CATAPULT_JOINERY_REACH.radius));
    if (byBarracks) return 'catapult';
    overSea ??= enemyOverSea(world, ctx, player);
    return overSea ? 'ship' : 'catapult';
  };
}
