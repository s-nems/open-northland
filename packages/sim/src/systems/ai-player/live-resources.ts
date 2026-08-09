import { Resource } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import { anyResourceNear, canonicalResources, resourcesNearNode } from '../spatial/resources.js';
import { anchorNodeOf } from './node-geometry.js';

/** The first expanding-box reach of the live-resource searches below (Chebyshev half-cell nodes). */
const RESOURCE_BOX_REACH_START = 16;
/**
 * The largest box walked before the live-resource searches fall back to the whole-map reference
 * scan. The cap only bounds the cost of a hopeless neighbourhood - the fallback reproduces the
 * exact linear winner past it (authored; the `RING_MAX_RADIUS` convention).
 */
const RESOURCE_BOX_REACH_MAX = 512;

/** The best `(Manhattan distance, entity id)` live `goodType` resource inside the Chebyshev `reach`
 *  box around `from`, or null. Candidates arrive ascending-id, so the strict `<` keeps the lowest
 *  id among the minimum distance - the same winner the reference scan picks. */
function bestLiveResourceInBox(
  world: World,
  goodType: number,
  from: HalfCellNode,
  reach: number,
): { entity: Entity; distance: number } | null {
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of resourcesNearNode(world, from.hx, from.hy, reach)) {
    if (!isLiveResource(world, e, goodType)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const distance = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
    if (distance < bestDistance) {
      best = e;
      bestDistance = distance;
    }
  }
  return best === null ? null : { entity: best, distance: bestDistance };
}

/** Whether `e` is a standing not-yet-empty resource of `goodType`. */
function isLiveResource(world: World, e: Entity, goodType: number): boolean {
  const r = world.get(e, Resource);
  return r.goodType === goodType && r.remaining > 0;
}

/**
 * The standing not-yet-empty resource of `goodType` nearest to `from` (Manhattan node distance,
 * ties to the lower entity id), or null when the map holds none. Expanding boxes over the resource
 * region index, so a decision near a stocked neighbourhood never walks the whole canonical list.
 */
export function nearestLiveResource(world: World, goodType: number, from: HalfCellNode): Entity | null {
  for (let reach = RESOURCE_BOX_REACH_START; reach <= RESOURCE_BOX_REACH_MAX; reach *= 2) {
    const hit = bestLiveResourceInBox(world, goodType, from, reach);
    if (hit === null) continue;
    // A winner at Manhattan ≤ reach is global: every node outside the Chebyshev `reach` box lies at
    // Manhattan ≥ reach+1, so nothing outside can beat or tie it.
    if (hit.distance <= reach) return hit.entity;
    // Only a box-corner hit (Manhattan up to 2·reach): every node at Manhattan ≤ hit.distance lies
    // inside the Chebyshev `hit.distance` box, so one exact re-query settles the winner.
    const exact = bestLiveResourceInBox(world, goodType, from, hit.distance);
    return (exact ?? hit).entity;
  }
  // Nothing within the cap - the reference scan finds the same winner the uncapped search would.
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const e of canonicalResources(world)) {
    if (!isLiveResource(world, e, goodType)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const dist = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
    if (dist < bestDist) {
      best = e;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Whether any not-yet-empty resource of `goodType` stands on the map - existence only, so the first
 * box holding a live node answers without ranking it. `near` seeds the expanding-box search (the
 * seat's base - collector goods are gathered around it); a null seed or a within-cap miss falls back
 * to the early-exit canonical scan, which alone decides a truly dry map.
 */
export function anyLiveResource(world: World, goodType: number, near: HalfCellNode | null): boolean {
  if (near !== null) {
    for (let reach = RESOURCE_BOX_REACH_START; reach <= RESOURCE_BOX_REACH_MAX; reach *= 2) {
      if (anyResourceNear(world, near.hx, near.hy, reach, (e) => isLiveResource(world, e, goodType))) {
        return true;
      }
    }
  }
  for (const e of canonicalResources(world)) {
    if (isLiveResource(world, e, goodType)) return true;
  }
  return false;
}
