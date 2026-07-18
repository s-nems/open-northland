import { Resource } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { createRegionIndex } from './region-index.js';

/**
 * The per-world RESOURCE spatial index — a {@link createRegionIndex} over {@link Resource} nodes, plus the
 * distinct-harvest-atomics dormancy set. It lets a flag-bound gatherer's `nearestHarvestableFor` scan read
 * only the standing nodes near its flag instead of every resource on a decoded map (~17k). See
 * {@link createRegionIndex} for the invalidation and superset guarantees.
 */
/** The distinct-harvest-atomics set, refcounted so a destroy drops an atomic only when its LAST node
 *  goes — the incremental form of the old fold over the canonical list. */
interface HarvestAtomics {
  readonly counts: Map<number, number>;
  readonly atomics: Set<number>;
}

const index = createRegionIndex<HarvestAtomics, number>(
  Resource,
  { verifier: 'resourceRegionIndex', plural: 'resources', component: 'Resource', singular: 'resource' },
  {
    empty: () => ({ counts: new Map(), atomics: new Set() }),
    capture: (world, e) => world.get(e, Resource).harvestAtomic,
    insert: (extra, atomic) => {
      extra.counts.set(atomic, (extra.counts.get(atomic) ?? 0) + 1);
      extra.atomics.add(atomic);
    },
    remove: (extra, atomic) => {
      const left = (extra.counts.get(atomic) ?? 0) - 1;
      if (left <= 0) {
        extra.counts.delete(atomic);
        extra.atomics.delete(atomic);
      } else {
        extra.counts.set(atomic, left);
      }
    },
    diverges: (held, fresh) =>
      held.atomics.size !== fresh.atomics.size ||
      [...fresh.atomics].some((atomic) => !held.atomics.has(atomic)),
  },
);

/** The memoized ascending-id list of every `Resource`+`Position` entity — what `collectTargets` used to
 *  rebuild (query + sort) every tick; with ~17k standing nodes that per-tick sort alone was a
 *  milliseconds-scale cost. Shared, read-only and frozen. */
export function canonicalResources(world: World): readonly Entity[] {
  return index.canonical(world);
}

/**
 * Every distinct `harvestAtomic` present on the standing resources — the exact dormancy probe for a
 * nearest-harvestable scan: a settler whose allowed atomics intersect none of these can match no
 * candidate, so its whole scan is provably null and skipped in O(present atomics). A drained node
 * (`remaining <= 0`) still contributes its atomic — the gate only ever elides provably-null scans.
 */
export function resourceHarvestAtomics(world: World): ReadonlySet<number> {
  return index.extra(world).atomics;
}

/** Every resource whose anchor node lies within the box `reach` nodes around `(hx, hy)`, ascending-id —
 *  the flag-bound gatherer's candidate superset (pass `reach ≥ radius + max work-cell offset`). */
export function resourcesNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  return index.near(world, hx, hy, reach);
}
