import { Crop } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { createRegionIndex, NO_REGION_EXTRA } from './region.js';

/**
 * The per-world index of fields, so a growth run reads only the fields in its map section, never the
 * forest around them. A field stands in place from sowing to reaping.
 */
const index = createRegionIndex(
  Crop,
  { verifier: 'cropRegionIndex', plural: 'fields', component: 'Crop', singular: 'field' },
  NO_REGION_EXTRA,
);

/** Every field whose anchor node lies within the box `reach` nodes around `(hx, hy)`, ascending-id. */
export function cropsNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  return index.near(world, hx, hy, reach);
}
