import { type BriefLivestockSpot, Livestock, Owner, Position } from '../../../../components/index.js';
import type { World } from '../../../../ecs/world.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';

/** Where every wild livestock animal stands at the scan, ascending entity id: the herds' start layout. */
export function scanLivestock(world: World, terrain: TerrainGraph): BriefLivestockSpot[] {
  const spots: BriefLivestockSpot[] = [];
  for (const e of world.canonicalQuery(Livestock, Position)) {
    if (world.has(e, Owner)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null || !terrain.inBounds(node.hx, node.hy)) continue;
    spots.push({ hx: node.hx, hy: node.hy });
  }
  return spots;
}
