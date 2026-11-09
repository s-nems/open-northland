import { TreeGrowth } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { createRegionIndex, NO_REGION_EXTRA } from './region.js';

/**
 * The per-world index of growing trees, so a growth run reads only the trees in its map section. A tree
 * grows in place, so the index updates only when growth starts or ends.
 */
const index = createRegionIndex(
  TreeGrowth,
  {
    verifier: 'growingTreeRegionIndex',
    plural: 'growing trees',
    component: 'TreeGrowth',
    singular: 'growing tree',
  },
  NO_REGION_EXTRA,
);

/** Every growing tree whose anchor node lies within the box `reach` nodes around `(hx, hy)`, ascending-id. */
export function growingTreesNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  return index.near(world, hx, hy, reach);
}
