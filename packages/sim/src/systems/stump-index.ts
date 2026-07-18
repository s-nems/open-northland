import { Stump } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { createRegionIndex, NO_REGION_EXTRA } from './region-index.js';

/**
 * The per-world STUMP spatial index — a {@link createRegionIndex} over {@link Stump} decor, the twin of
 * {@link import('./berry-index.js')}. A long game fells thousands of trees, each leaving a standing stump,
 * so the placement-time razing scan ({@link import('./economy/stumps.js').destroyStumpsInReserved}) reads
 * only the stumps in a new building's reserved zone instead of the whole map. Stumps are inert decor that
 * never move, so the index updates only on create (a tree falls) and destroy (razed, or reaped later).
 */
const index = createRegionIndex(
  Stump,
  { verifier: 'stumpRegionIndex', plural: 'stumps', component: 'Stump', singular: 'stump' },
  NO_REGION_EXTRA,
);

/** Every stump whose anchor node lies within the box `reach` nodes around `(hx, hy)`, ascending-id — the
 *  razing pass's candidate superset (pass `reach ≥` the building's reserved Chebyshev bound, so the caller's
 *  zone-membership filter picks exactly the stumps under the footprint). */
export function stumpsNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  return index.near(world, hx, hy, reach);
}
