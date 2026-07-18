import type { BuildingType, ContentSet, GoodType } from '@open-northland/data';
import { Building, Owner, ownerOf, Position, Resource, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { HEADQUARTERS_BUILDING_ID } from '../readviews/index.js';
import { canonicalResources } from '../resource-index.js';
import { canonicalById } from '../spatial.js';

// Shared per-seat lookups the strategic modules recompute each decision (once per
// AI_DECISION_INTERVAL_TICKS per seat, so plain canonical scans stay within the RTS budget).

// The HQ content id lives with the building read views (a building content fact); re-exported here so
// the AI barrel's consumers keep their import site. A seat with no built, owned headquarters gets no
// strategic decisions (user rule: no HQ → the AI stays off).
export { HEADQUARTERS_BUILDING_ID };

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

/** The standing not-yet-empty resource of `goodType` nearest to `from` (Manhattan node distance,
 *  ties to the lower entity id), or null when the map holds none. A full canonical-resources scan —
 *  run only inside a strategic decision, never per tick. */
export function nearestLiveResource(world: World, goodType: number, from: HalfCellNode): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const e of canonicalResources(world)) {
    const r = world.get(e, Resource);
    if (r.goodType !== goodType || r.remaining <= 0) continue;
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
