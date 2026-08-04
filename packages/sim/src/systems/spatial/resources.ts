import { Resource } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { createRegionIndex } from './region.js';

/**
 * The per-world resource spatial index over {@link Resource} nodes, plus the distinct-harvest-atomics
 * dormancy set, so a flag-bound gatherer's scan reads only the standing nodes near its flag.
 */
/** The distinct-harvest-atomics set, refcounted so a destroy drops an atomic only when its last node
 *  goes. */
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

/** The memoized ascending-id list of every `Resource` and `Position` entity, shared and frozen. */
export function canonicalResources(world: World): readonly Entity[] {
  return index.canonical(world);
}

/**
 * Every distinct `harvestAtomic` present on the standing resources, the dormancy probe for a
 * nearest-harvestable scan: a settler whose allowed atomics intersect none of these can match no
 * candidate. A drained node still contributes its atomic, so the gate only elides provably-null scans.
 */
export function resourceHarvestAtomics(world: World): ReadonlySet<number> {
  return index.extra(world).atomics;
}

/** Every resource whose anchor node lies within the box `reach` nodes around `(hx, hy)`, ascending-id. A
 *  candidate superset, so pass a `reach` covering the radius plus the largest work-cell offset. */
export function resourcesNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  return index.near(world, hx, hy, reach);
}

/** Every resource whose anchor node is exactly `(hx, hy)`. The index's live bucket, so copy it before
 *  destroying members. */
export function resourcesAtNode(world: World, hx: number, hy: number): readonly Entity[] {
  return index.atNode(world, hx, hy);
}

/** Whether any resource inside the same box passes `test`. Unordered and first-hit. */
export function anyResourceNear(
  world: World,
  hx: number,
  hy: number,
  reach: number,
  test: (e: Entity) => boolean,
): boolean {
  return index.someNear(world, hx, hy, reach, test);
}
