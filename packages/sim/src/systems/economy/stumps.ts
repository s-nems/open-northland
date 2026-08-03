import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { stumpsNearNode } from '../spatial/stumps.js';
import { decorInReservedZone } from './reserved-decor.js';

// Felled-tree stumps: the inert `ls_trees_dead` decor a chopped tree leaves behind.

/**
 * Clear every felled-tree stump standing inside `building`'s reserved build-exclusion zone, so a new
 * building razes the stumps it lands on. Stumps are inert non-blocking decor and no placement obstacle, so
 * one would otherwise be drawn straight through the walls. Source basis: the observed berry-razing rule
 * extended to stumps by analogy, both being `LogicBuildBlockArea`-zone decoration.
 *
 * No razed event is emitted, unlike the bush pass: a stump is a live snapshot-drawn entity rather than a
 * static-decor quad, so its destroy drops it from the snapshot and the sprite pool reaps its quad.
 */
export function destroyStumpsInReserved(world: World, ctx: SystemContext, building: Entity): void {
  for (const e of decorInReservedZone(world, ctx, building, stumpsNearNode)) world.destroy(e);
}
