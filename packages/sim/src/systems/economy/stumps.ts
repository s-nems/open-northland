import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { stumpsNearNode } from '../stump-index.js';
import { decorInReservedZone } from './reserved-decor.js';

// Felled-tree stumps — the inert `ls_trees_dead` decor a chopped tree leaves behind (see the {@link
// import('../../components/economy/resources.js').Stump} component). This is the stump twin of
// destroyBerryBushesInReserved: a placed building clears the landscape decoration it lands on.

/**
 * Clear every felled-tree {@link import('../../components/economy/resources.js').Stump} standing inside
 * `building`'s reserved build-exclusion zone — called at placement so a new building razes the stumps it lands
 * on. Stumps are inert non-blocking decor, so unlike a resource node one can sit under a building; without
 * this a felled tree's debris would be drawn straight through the walls (the reported oddity). Source basis:
 * consistent with the observed berry-razing rule (a placed building clears the landscape decoration in its
 * reserved footprint), extended to stumps by analogy — both are `LogicBuildBlockArea`-zone decoration.
 *
 * Unlike {@link import('./berries.js').destroyBerryBushesInReserved}, no razed event is emitted: a stump is a
 * live snapshot-drawn entity (never a `?map=` static-decor quad), so its `world.destroy` drops it from the
 * snapshot and the render sprite pool reaps its quad on the next frame (`reconcileSprites`). Candidate
 * resolution is the zone-bounded {@link decorInReservedZone}.
 */
export function destroyStumpsInReserved(world: World, ctx: SystemContext, building: Entity): void {
  for (const e of decorInReservedZone(world, ctx, building, stumpsNearNode)) world.destroy(e);
}
