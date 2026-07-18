import { BerryBush } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { createRegionIndex, NO_REGION_EXTRA } from './region-index.js';

/**
 * The per-world BERRY-BUSH spatial index — a {@link createRegionIndex} over {@link BerryBush} nodes, the
 * twin of {@link import('./resource-index.js')}. A decoded map spawns tens of thousands of bushes and the
 * eat drive's forage scan runs per hungry settler; the index keeps that from being a full-world scan
 * inside a per-entity loop. Bushes never move and forage/regrow mutate in place via `world.touch` (which
 * does not bump the store generation), so the index updates only on create/destroy.
 */
const index = createRegionIndex(
  BerryBush,
  { verifier: 'bushRegionIndex', plural: 'bushes', component: 'BerryBush', singular: 'bush' },
  NO_REGION_EXTRA,
);

/** Every berry bush whose anchor node lies within the box `reach` nodes around `(hx, hy)`, ascending-id —
 *  the forager's candidate superset (pass `reach ≥ forage radius + the max anchor→interaction-cell
 *  offset`, so the caller's unchanged cellDist filter + rank picks the same winner as a full scan). */
export function bushesNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  return index.near(world, hx, hy, reach);
}
