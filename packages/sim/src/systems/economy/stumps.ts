import { Building, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { reservedZoneOf } from '../footprint/geometry.js';
import { entityNode } from '../spatial.js';
import { stumpsNearNode } from '../stump-index.js';

// Felled-tree stumps — the inert `ls_trees_dead` decor a chopped tree leaves behind (see the {@link
// import('../../components/economy/resources.js').Stump} component). This is the stump twin of
// destroyBerryBushesInReserved: a placed building clears the landscape decoration it lands on.

/**
 * Clear every felled-tree {@link import('../../components/economy/resources.js').Stump} standing inside
 * `building`'s reserved build-exclusion zone — called at placement so a new building razes the stumps it
 * lands on (source basis: observed original behavior — a placed building clears the landscape decoration in
 * its reserved footprint, the same {@link reservedZoneOf} extent that keeps other construction clear). Stumps
 * are inert non-blocking decor, so unlike a resource node one can sit under a building; without this a felled
 * tree's debris would be drawn straight through the walls (the reported oddity).
 *
 * Unlike {@link import('./berries.js').destroyBerryBushesInReserved}, no razed event is emitted: a stump is a
 * live snapshot-drawn entity (never a `?map=` static-decor quad), so its `world.destroy` drops it from the
 * snapshot and the render sprite pool reaps its quad on the next frame (`reconcileSprites`).
 *
 * Golden-rule-6 bounded: the scan reads only the stumps within the zone's Chebyshev reach ({@link
 * stumpsNearNode}, the region index) and keeps those whose node lies in the zone, never every stump on the
 * map. Collect-then-destroy — `world.destroy` mutates the store `stumpsNearNode` derives from — and the order
 * is irrelevant (every matched stump is removed). A mapless sim (no terrain) or a footprint-less type clears
 * nothing.
 */
export function destroyStumpsInReserved(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no stumps to place under a building
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return;
  const anchor = nodeOfPosition(p.x, p.y);
  const rz = reservedZoneOf(ctx.content, terrain, b.buildingType, anchor.hx, anchor.hy);
  if (rz === undefined) return;
  const doomed = stumpsNearNode(world, anchor.hx, anchor.hy, rz.reach).filter((e) =>
    rz.zone.has(entityNode(world, terrain, e)),
  );
  for (const e of doomed) world.destroy(e);
}
