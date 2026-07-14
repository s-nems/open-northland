import { Resource } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { createRegionIndex } from './region-index.js';

/**
 * The per-world RESOURCE spatial index — a {@link createRegionIndex} over {@link Resource} nodes, plus the
 * distinct-harvest-atomics dormancy set. It lets a flag-bound gatherer's `nearestHarvestableFor` scan read
 * only the standing nodes near its flag instead of every resource on a decoded map (~17k). See
 * {@link createRegionIndex} for the invalidation and superset guarantees.
 */
const index = createRegionIndex(
  Resource,
  { verifier: 'resourceRegionIndex', plural: 'resources', component: 'Resource', singular: 'resource' },
  (world, list): ReadonlySet<number> => {
    const atomics = new Set<number>();
    for (const e of list) atomics.add(world.get(e, Resource).harvestAtomic);
    return atomics;
  },
);

/** The memoized ascending-id list of every `Resource`+`Position` entity — what `collectTargets` used to
 *  rebuild (query + sort) every tick; with ~17k standing nodes that per-tick sort alone was a
 *  milliseconds-scale cost. Shared, read-only and FROZEN. */
export function canonicalResources(world: World): readonly Entity[] {
  return index.canonical(world);
}

/**
 * Every DISTINCT `harvestAtomic` present on the standing resources — the exact dormancy probe for a
 * nearest-harvestable scan: a settler whose allowed atomics intersect none of these can match no
 * candidate, so its whole scan is provably null and skipped in O(present atomics). A drained node
 * (`remaining <= 0`) still contributes its atomic — the gate only ever ELIDES provably-null scans.
 */
export function resourceHarvestAtomics(world: World): ReadonlySet<number> {
  return index.extra(world);
}

/** Every resource whose anchor node lies within the box `reach` nodes around `(hx, hy)`, ascending-id —
 *  the flag-bound gatherer's candidate superset (pass `reach ≥ radius + max work-cell offset`). */
export function resourcesNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  return index.near(world, hx, hy, reach);
}
