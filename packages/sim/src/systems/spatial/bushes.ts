import { BerryBush } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { createRegionIndex, NO_REGION_EXTRA } from './region.js';

/**
 * The per-world berry-bush spatial index, so the eat drive's per-settler forage scan is not a full-world
 * scan inside a per-entity loop. Bushes never move, and forage and regrow mutate in place through
 * `world.write`, which moves the value generation rather than the membership one this index keys on, so
 * the index updates only on create and destroy.
 */
const index = createRegionIndex(
  BerryBush,
  { verifier: 'bushRegionIndex', plural: 'bushes', component: 'BerryBush', singular: 'bush' },
  NO_REGION_EXTRA,
);

/** Every berry bush whose anchor node lies within the box `reach` nodes around `(hx, hy)`, ascending-id.
 *  A candidate superset, so pass a `reach` covering the forage radius plus the largest
 *  anchor-to-interaction-cell offset and keep the caller's own distance filter. */
export function bushesNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  return index.near(world, hx, hy, reach);
}
