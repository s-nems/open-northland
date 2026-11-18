import type { ContentSet } from '@open-northland/data';
import {
  type BriefAnimalSpot,
  type BriefPredatorSpot,
  Livestock,
  Owner,
  Position,
  Settler,
  StayPoint,
  YoungAnimal,
} from '../../../../components/index.js';
import type { World } from '../../../../ecs/world.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { isAggressiveAnimal } from '../../../readviews/index.js';

/** Where every wild livestock animal stands at the scan, ascending entity id: the herds' start layout. */
export function scanLivestock(world: World, terrain: TerrainGraph): BriefAnimalSpot[] {
  const spots: BriefAnimalSpot[] = [];
  for (const e of world.canonicalQuery(Livestock, Position)) {
    if (world.has(e, Owner)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null || !terrain.inBounds(node.hx, node.hy)) continue;
    spots.push({ hx: node.hx, hy: node.hy });
  }
  return spots;
}

/** Where every ownerless adult animal of an `aggressive` kind stands at the scan, ascending entity id: the
 *  packs' start layout. */
export function scanPredators(world: World, content: ContentSet, terrain: TerrainGraph): BriefPredatorSpot[] {
  const spots: BriefPredatorSpot[] = [];
  for (const e of world.canonicalQuery(StayPoint, Settler, Position)) {
    if (world.has(e, Owner) || world.has(e, YoungAnimal)) continue;
    if (!isAggressiveAnimal(content, world.get(e, Settler).tribe)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null || !terrain.inBounds(node.hx, node.hy)) continue;
    spots.push({
      hx: node.hx,
      hy: node.hy,
      component: terrain.componentOf(terrain.nodeAt(node.hx, node.hy)),
    });
  }
  return spots;
}
