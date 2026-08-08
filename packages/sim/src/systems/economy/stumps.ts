import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { stumpsNearNode } from '../spatial/stumps.js';
import { decorInReservedZone } from './reserved-decor.js';

/**
 * Clear every felled-tree stump standing inside `building`'s reserved build-exclusion zone, since a
 * non-blocking stump is no placement obstacle and would otherwise be drawn straight through the walls.
 * Source basis: the observed berry-razing rule extended to stumps by analogy, both being
 * `LogicBuildBlockArea`-zone decoration.
 *
 * No razed event is emitted, unlike the bush pass: a stump is a live snapshot-drawn entity, so its destroy
 * drops it from the snapshot and the sprite pool reaps its quad.
 */
export function destroyStumpsInReserved(world: World, ctx: SystemContext, building: Entity): void {
  for (const e of decorInReservedZone(world, ctx, building, stumpsNearNode)) world.destroy(e);
}
