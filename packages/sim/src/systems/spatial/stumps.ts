import { Stump } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { createRegionIndex, NO_REGION_EXTRA } from './region.js';

/**
 * The per-world stump spatial index, so the placement-time razing scan reads only the stumps in a new
 * building's reserved zone instead of the whole map. Stumps are inert decor that never move, so the index
 * updates only on create and destroy.
 */
const index = createRegionIndex(
  Stump,
  { verifier: 'stumpRegionIndex', plural: 'stumps', component: 'Stump', singular: 'stump' },
  NO_REGION_EXTRA,
);

/** Every stump whose anchor node lies within the box `reach` nodes around `(hx, hy)`, ascending-id. A
 *  candidate superset, so pass a `reach` covering the building's reserved Chebyshev bound and keep the
 *  caller's own zone-membership filter. */
export function stumpsNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  return index.near(world, hx, hy, reach);
}
