import { footprintCellDx } from '@open-northland/data';
import type { World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { buildingTypeByContentId } from '../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../context.js';
import { buildingFootprintOf } from '../../footprint/geometry.js';
import { placementProbe } from '../../footprint/placement/building.js';

/** The home chain's base tier. Its reserved zone already spans the top tier's body, so a colony's room is
 *  counted in these whatever tier it raises. */
const COLONY_HOME_ID = 'home_level_00';

/**
 * How many homes fit side by side within `radius` Manhattan nodes of `at` on `land` as the map stands now,
 * placed greedily nearest first with their reserved zones kept apart, at most `cap`: the free room a
 * colony founded there has for homes, workshops and towers alike. Costs a placement probe per node of the
 * diamond until `cap` is reached.
 */
export function homesFitNear(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  tribe: number,
  land: number,
  at: HalfCellNode,
  radius: number,
  cap: number,
): number {
  const home = buildingTypeByContentId(ctx.content, COLONY_HOME_ID);
  const footprint = home === undefined ? undefined : buildingFootprintOf(ctx.content, home.typeId, tribe);
  if (home === undefined || footprint === undefined) return 0;
  const probe = placementProbe(world, ctx.content, terrain, home.typeId, tribe);
  const taken = new Set<number>();
  let homes = 0;
  const tryAt = (x: number, y: number): void => {
    if (!terrain.inBounds(x, y) || terrain.componentOf(terrain.nodeAt(x, y)) !== land) return;
    if (!probe.canPlace(x, y)) return;
    const slots = footprint.reserved.map((c) => (y + c.dy) * terrain.width + x + footprintCellDx(y, c));
    if (slots.some((slot) => taken.has(slot))) return;
    for (const slot of slots) taken.add(slot);
    homes++;
  };
  for (let r = 0; r <= radius && homes < cap; r++) {
    for (let dy = -r; dy <= r && homes < cap; dy++) {
      const span = r - Math.abs(dy);
      tryAt(at.hx - span, at.hy + dy);
      if (span > 0) tryAt(at.hx + span, at.hy + dy);
    }
  }
  return homes;
}
