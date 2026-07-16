import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { interactionNode } from '../../footprint/index.js';
import { manhattan } from '../../spatial.js';
import { closer } from './nearest.js';
import { interactionCell } from './workplaces.js';

/**
 * The greatest Manhattan ring radius (in half-cell NODES) the interaction-cell ring search expands to
 * before falling back to a full linear scan. The bound only stops a settler far from every building
 * from walking the whole map in empty rings; it never changes WHICH target wins (the fallback
 * reproduces the exact linear winner), so it is a pure performance knob, not a decoded distance
 * (named approximation).
 */
const NEAREST_RING_MAX_RADIUS = 48;

/** A candidate's interaction cell plus the distance a scan measured to it. */
export interface NearestByCell {
  readonly entity: Entity;
  readonly cell: NodeId;
  readonly distance: number;
}

/** Every candidate sharing one seeker-independent interaction cell, in ascending entity-id order. */
interface CellBucket {
  readonly cell: NodeId;
  readonly entities: Entity[];
}

/**
 * A per-tick spatial index over an economy candidate list, answering "nearest candidate to `here`
 * passing `accept`" with the {@link closer} `(distance, cell-id, entity-id)` winner the linear scans
 * pick — but as an expanding node-ring search instead of an O(candidates) walk per seeker.
 *
 * A candidate is bucketed by its interaction cell only when that cell is SEEKER-INDEPENDENT — a
 * {@link interactionNode building door / anchor} node, which does not depend on where the seeker
 * stands. Candidates whose cell IS seeker-dependent (a boat hull, a loose ground pile, a resource
 * work cell — resolved through `from` by {@link interactionCell}) cannot be pre-bucketed, so they stay
 * in a small `dynamic` tail scanned linearly. `nearest` combines the ring winner with the tail winner,
 * so the result is byte-identical to a full linear scan for any candidate mix (the boat-store and
 * flag-pile cases included), while the common building-dominated scan pays a bounded ring, not a walk.
 *
 * This is the economy counterpart of {@link import('../../spatial.js').NodeBuckets NodeBuckets}, which
 * cannot serve here: it tie-breaks by `(distance, entity-id)` off a candidate's own tile, whereas these
 * scans measure to the interaction cell and tie-break by `cell-id` first.
 */
export class InteractionCellIndex {
  private readonly byX = new Map<number, Map<number, CellBucket>>();
  private readonly dynamic: Entity[] = [];
  // Bounding box of the bucketed cells (empty ⟹ minX > maxX), so a ring search never expands past the
  // farthest bucket — an index with no buckets (a store-less / site-less tick) costs no ring probes.
  private minX = Number.POSITIVE_INFINITY;
  private maxX = Number.NEGATIVE_INFINITY;
  private minY = Number.POSITIVE_INFINITY;
  private maxY = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
    private readonly candidates: readonly Entity[],
  ) {
    for (const e of candidates) {
      const inode = interactionNode(world, ctx, e);
      if (inode === null) {
        this.dynamic.push(e); // seeker-dependent cell — resolve it per query, not once here
        continue;
      }
      const cell = terrain.nodeAtClamped(inode.x, inode.y);
      const { x, y } = terrain.coordsOf(cell);
      if (x < this.minX) this.minX = x;
      if (x > this.maxX) this.maxX = x;
      if (y < this.minY) this.minY = y;
      if (y > this.maxY) this.maxY = y;
      let column = this.byX.get(x);
      if (column === undefined) {
        column = new Map();
        this.byX.set(x, column);
      }
      const bucket = column.get(y);
      if (bucket === undefined) column.set(y, { cell, entities: [e] });
      else bucket.entities.push(e); // candidates arrive ascending-id, so buckets stay ascending-id
    }
  }

  /**
   * The nearest candidate to `here` that passes `accept`, by the shared `(distance, cell-id, entity-id)`
   * order, or null when none passes. Falls back to a full linear scan when no bucketed candidate lies
   * within the ring bound (identical result). `accept` must be side-effect-free — a ring miss re-runs it
   * on the fallback scan, so it may be evaluated more than once per candidate. `cellGate` (optional)
   * rejects whole interaction CELLS before any entity is consulted — the signpost-confinement seam: a
   * gated cell's bucket is skipped in O(1), and the linear fallback applies the same gate, so both paths
   * agree on the winner.
   */
  nearest(
    here: NodeId,
    accept: (e: Entity) => boolean,
    cellGate?: (cell: NodeId) => boolean,
  ): NearestByCell | null {
    const ring = this.ringNearest(here, accept, cellGate);
    if (ring !== null) return combine(ring, this.linearNearest(this.dynamic, here, accept, cellGate));
    return this.linearNearest(this.candidates, here, accept, cellGate);
  }

  /** The nearest bucketed candidate within {@link NEAREST_RING_MAX_RADIUS}, or null. The first non-empty
   *  ring holds the minimum distance, so its `(cell-id, entity-id)` winner is the global bucketed winner.
   *  The ring stops at the farthest bucket's Manhattan reach, so a sparse or empty index rings no wider. */
  private ringNearest(
    here: NodeId,
    accept: (e: Entity) => boolean,
    cellGate?: (cell: NodeId) => boolean,
  ): NearestByCell | null {
    if (this.maxX < this.minX) return null; // no bucketed candidates — the linear fallback handles the tail
    const { x: hx, y: hy } = this.terrain.coordsOf(here);
    const reach = Math.max(hx - this.minX, this.maxX - hx) + Math.max(hy - this.minY, this.maxY - hy);
    const maxRadius = Math.min(NEAREST_RING_MAX_RADIUS, reach);
    for (let d = 0; d <= maxRadius; d++) {
      let best: NearestByCell | null = null;
      // Ring d = every node at Manhattan distance exactly d; the two rows dy = ±(d - |dx|) trace the diamond.
      for (let dx = -d; dx <= d; dx++) {
        const rem = d - Math.abs(dx);
        best = this.pickInRing(hx + dx, hy + rem, d, accept, cellGate, best);
        if (rem !== 0) best = this.pickInRing(hx + dx, hy - rem, d, accept, cellGate, best);
      }
      if (best !== null) return best;
    }
    return null;
  }

  /** Fold node `(x,y)`'s bucket into the running ring `best`. Distinct nodes carry distinct cell ids, so a
   *  lower cell wins outright; the entity-id tie-break only decides within one bucket, where the ascending
   *  order makes the first accepted entity the lowest id. */
  private pickInRing(
    x: number,
    y: number,
    distance: number,
    accept: (e: Entity) => boolean,
    cellGate: ((cell: NodeId) => boolean) | undefined,
    best: NearestByCell | null,
  ): NearestByCell | null {
    const bucket = this.byX.get(x)?.get(y);
    if (bucket === undefined) return best;
    if (best !== null && bucket.cell >= best.cell) return best; // can't beat a lower cell at the same distance
    if (cellGate !== undefined && !cellGate(bucket.cell)) return best; // the whole cell is out of bounds
    for (const e of bucket.entities) {
      if (accept(e)) return { entity: e, cell: bucket.cell, distance };
    }
    return best;
  }

  /** The `closer` winner over `list`, measuring each candidate's `interactionCell` from `here` — the exact
   *  linear scan the ring accelerates, used for the seeker-dependent tail and the out-of-range fallback.
   *  Shares the standalone {@link nearestByCell} loop (ranked from `here`), so the tie-break lives in one place. */
  private linearNearest(
    list: readonly Entity[],
    here: NodeId,
    accept: (e: Entity) => boolean,
    cellGate?: (cell: NodeId) => boolean,
  ): NearestByCell | null {
    return nearestByCell(this.terrain, list, here, (e) => {
      if (!accept(e)) return null;
      const cell = interactionCell(this.world, this.ctx, this.terrain, e, here);
      return cellGate === undefined || cellGate(cell) ? cell : null;
    });
  }
}

/**
 * The `closer` `(distance, cell-id, entity-id)` winner over `list`, where `resolve` maps a candidate to its
 * interaction cell — or null to skip it (a failed gate) — and distance is Manhattan from `rank`. The
 * seeker-dependent linear scans (ground piles, resource work cells, farm sheaves) share this one loop so
 * none re-open the `best / bestDist / bestCell` skeleton {@link InteractionCellIndex} already owns. `rank` is
 * the ranking origin: usually the seeker, but a flag centre when a bound gatherer works outward from its flag
 * (so the interaction cell may resolve from a different node than the one it is ranked by).
 */
export function nearestByCell(
  terrain: TerrainGraph,
  list: readonly Entity[],
  rank: NodeId,
  resolve: (entity: Entity) => NodeId | null,
): NearestByCell | null {
  let best: NearestByCell | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const entity of list) {
    const cell = resolve(entity);
    if (cell === null) continue;
    const distance = manhattan(terrain, rank, cell);
    if (closer(distance, cell, bestDist, bestCell)) {
      best = { entity, cell, distance };
      bestDist = distance;
      bestCell = cell;
    }
  }
  return best;
}

/** The lower of two winners by `(distance, cell-id, entity-id)` — the same total order the linear scans
 *  produce, so merging the bucketed and seeker-dependent winners can never pick a different candidate. */
function combine(a: NearestByCell | null, b: NearestByCell | null): NearestByCell | null {
  if (a === null) return b;
  if (b === null) return a;
  if (b.distance !== a.distance) return b.distance < a.distance ? b : a;
  if (b.cell !== a.cell) return b.cell < a.cell ? b : a;
  return b.entity < a.entity ? b : a;
}
