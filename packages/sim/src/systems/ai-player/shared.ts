import type { BuildingType, ContentSet, GoodType } from '@open-northland/data';
import { Building, Owner, ownerOf, Position, Resource, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { HEADQUARTERS_BUILDING_ID } from '../readviews/index.js';
import { anyResourceNear, canonicalResources, resourcesNearNode } from '../resource-index.js';
import { canonicalById } from '../spatial.js';

// Shared per-seat lookups the strategic modules recompute each decision (once per
// AI_DECISION_INTERVAL_TICKS per seat, so plain canonical scans stay within the RTS budget).

// The HQ content id lives with the building read views (a building content fact); re-exported here so
// the AI barrel's consumers keep their import site. A seat with no built, owned headquarters gets no
// strategic decisions (user rule: no HQ → the AI stays off).
export { HEADQUARTERS_BUILDING_ID };

/**
 * Ticks between one seat's decision passes — 2 s at the 12 ticks/s base clock. A genre-convention
 * approximation (Widelands/KaM/Petra re-evaluate strategy on seconds-scale timers, not per tick);
 * per-tick cost scales with decisions, not ticks.
 */
export const AI_DECISION_INTERVAL_TICKS = 24;

/** The building definition carrying the stable content id, or undefined when this content set lacks
 *  it — a module skips such an entry instead of failing, so partial content stays safe. */
export function buildingTypeByContentId(content: ContentSet, id: string): BuildingType | undefined {
  return content.buildings.find((b) => b.id === id);
}

/** The good definition carrying the stable content id, or undefined (same skip contract as
 *  {@link buildingTypeByContentId}). */
export function goodTypeByContentId(content: ContentSet, id: string): GoodType | undefined {
  return content.goods.find((g) => g.id === id);
}

/** The first expanding-box reach of the live-resource searches below (Chebyshev half-cell nodes). */
const RESOURCE_BOX_REACH_START = 16;
/**
 * The largest box walked before the live-resource searches fall back to the whole-map reference
 * scan. The cap only bounds the cost of a hopeless neighbourhood — the fallback reproduces the
 * exact linear winner past it — so it is a pure performance knob, not a decoded distance (named
 * approximation; the `RING_MAX_RADIUS` convention).
 */
const RESOURCE_BOX_REACH_MAX = 512;

/** The best `(Manhattan distance, entity id)` live `goodType` resource inside the Chebyshev `reach`
 *  box around `from`, or null. Candidates arrive ascending-id, so the strict `<` keeps the lowest
 *  id among the minimum distance — the same winner the reference scan picks. */
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
 * region index, so a decision near a stocked neighbourhood never walks the whole canonical list;
 * the whole-map reference scan past the cap keeps the winner byte-identical on a sparse map.
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
  // Nothing within the cap — the reference scan finds the same winner the uncapped search would.
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
 * Whether any not-yet-empty resource of `goodType` stands on the map — existence only, so the first
 * box holding a live node answers without ranking it. `near` seeds the expanding-box search (the
 * seat's HQ — collector goods are gathered around it); a null seed or a within-cap miss falls back
 * to the early-exit canonical scan, which alone decides a truly dry map.
 */
export function anyLiveResource(world: World, goodType: number, near: HalfCellNode | null): boolean {
  if (near !== null) {
    // The existence-only index path: no collection, no sort, first hit returns — a map holding none of
    // the good (the gated iron entry on an iron-less map) pays box probes, not repeated full sorts.
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

/** The seat's buildings (any construction state) in canonical ascending-id order. */
export function ownedBuildings(world: World, player: number): Entity[] {
  return canonicalById(world.query(Building, Owner)).filter((e) => ownerOf(world, e) === player);
}

/** The seat's living settlers in canonical ascending-id order. */
export function ownedSettlers(world: World, player: number): Entity[] {
  return canonicalById(world.query(Settler, Owner)).filter((e) => ownerOf(world, e) === player);
}

/** Whether the building's construction (or its latest upgrade) is complete. */
export function isBuilt(world: World, e: Entity): boolean {
  return world.get(e, Building).built >= ONE;
}

/**
 * The seat's canonical headquarters — the lowest-id owned BUILT {@link HEADQUARTERS_BUILDING_ID}
 * building — or null, in which case every strategic module idles for the seat.
 */
export function headquartersOf(world: World, ctx: SystemContext, player: number): Entity | null {
  const buildings = contentIndex(ctx.content).buildings;
  for (const e of ownedBuildings(world, player)) {
    const b = world.get(e, Building);
    if (b.built < ONE) continue;
    if (buildings.get(b.buildingType)?.id === HEADQUARTERS_BUILDING_ID) return e;
  }
  return null;
}

/** The half-cell node under an entity's Position, or null for an unpositioned entity. */
export function anchorNodeOf(world: World, e: Entity): HalfCellNode | null {
  const pos = world.tryGet(e, Position);
  return pos === undefined ? null : nodeOfPosition(pos.x, pos.y);
}

/**
 * The first node accepted while walking expanding Manhattan rings around `(cx, cy)` — the modules'
 * "closest legal spot" pick. Deterministic: ascending radius, then ascending dx, north (y−) before
 * south (y+), so the winner never depends on iteration state. `accept` must reject out-of-bounds
 * nodes itself. Cost is O(maxRadius²) accepts at worst — bounded, never a whole-map scan.
 */
export function firstRingNode(
  cx: number,
  cy: number,
  maxRadius: number,
  accept: (x: number, y: number) => boolean,
): HalfCellNode | null {
  for (let r = 0; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const dy = r - Math.abs(dx);
      if (accept(cx + dx, cy - dy)) return { hx: cx + dx, hy: cy - dy };
      if (dy !== 0 && accept(cx + dx, cy + dy)) return { hx: cx + dx, hy: cy + dy };
    }
  }
  return null;
}
