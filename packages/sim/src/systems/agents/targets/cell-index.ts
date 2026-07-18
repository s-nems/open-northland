import type { Entity, World } from '../../../ecs/world.js';
import type { SpatialGate } from '../../../nav/node-metric.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { interactionNode } from '../../footprint/index.js';
import { forEachRingOffset, manhattan } from '../../spatial.js';
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

/**
 * Bucket count at or below which `nearest` skips the ring sweep for the exact linear scan. A ring sweep
 * pays off only when buckets are dense enough that a hit ends it early; a MISS costs the full diamond —
 * O(maxRadius²) ≈ 4600 node probes — regardless of how few buckets exist, and a confined (gated) search
 * misses often (every sink out of the settler's area). With ≤ this many buckets the linear scan's
 * `accept` calls are provably cheaper than the empty sweep; the winner is identical (the ring is only an
 * accelerator over the linear reference). Performance knob, not behavior (named approximation).
 */
const RING_MIN_BUCKETS = 64;

/**
 * A candidate's interaction cell, the distance a scan measured to it, and the `payload` the scan's
 * qualification derived on the way (the good the winning pile stocks). Carrying it through means the caller
 * never re-derives what already qualified the winner — the two could silently disagree (a returned good the
 * accept never approved).
 */
export interface NearestByCell<P = null> {
  readonly entity: Entity;
  readonly cell: NodeId;
  readonly distance: number;
  readonly payload: P;
}

/**
 * A qualifying candidate, as an {@link InteractionCellIndex.nearest} `accept` reports it: the value the
 * qualification derived, carried through to the winner. Scans that derive nothing qualify with
 * `payload: null`. Wrapping the verdict (rather than returning a bare value) keeps the reject case the one
 * unambiguous `null` — a bare `false` would otherwise read as a qualified candidate.
 */
export interface Qualified<P> {
  readonly payload: P;
}

/** The {@link Qualified} verdict of a scan that derives nothing — "this candidate passes, with no value to
 *  carry". Shared, so a plain accept allocates nothing per candidate. */
export const QUALIFIES: Qualified<null> = { payload: null };

/** A {@link Qualified} wrapper for the "derive the good, or reject" accepts — `null` in stays a reject. */
export function qualifiedGood(goodType: number | null): Qualified<number> | null {
  return goodType === null ? null : { payload: goodType };
}

/** What a {@link nearestByCell} `resolve` returns for a qualifying candidate: the interaction cell to rank it
 *  by, plus whatever the qualification derived. */
export interface CellMatch<P> extends Qualified<P> {
  readonly cell: NodeId;
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
  private bucketCount = 0;
  // Seeker-independent interaction cells resolved once at construction, so the linear scans don't
  // re-derive a building's door footprint per candidate per query (only the dynamic tail stays per-query).
  private readonly staticCell = new Map<Entity, NodeId>();
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
      this.staticCell.set(e, cell);
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
      if (bucket === undefined) {
        column.set(y, { cell, entities: [e] });
        this.bucketCount++;
      } else bucket.entities.push(e); // candidates arrive ascending-id, so buckets stay ascending-id
    }
  }

  /**
   * The nearest candidate to `here` that `accept` qualifies, by the shared `(distance, cell-id, entity-id)`
   * order, or null when none does. `accept` returns a {@link Qualified} carrying whatever the qualification
   * derived — handed on as the winner's {@link NearestByCell.payload} so the caller never re-derives it —
   * or null to reject.
   *
   * Falls back to a full linear scan when no bucketed candidate lies within the ring bound (identical
   * result). `accept` must be side-effect-free — a ring miss re-runs it on the fallback scan, so it may be
   * evaluated more than once per candidate. `gate` (the settler's confinement, a {@link SpatialGate})
   * rejects whole interaction CELLS before any entity is consulted — a gated cell's bucket is skipped in
   * O(1), and the linear fallback applies the same gate, so both paths agree on the winner — and BOUNDS the
   * sweep: every gate-passing cell provably lies inside `gate.bounds`, so the ring sweep stops at the box's
   * reach, and a sweep that covered that whole reach PROVES no bucketed candidate passes, eliding the full
   * linear fallback.
   */
  nearest<P>(
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate?: SpatialGate,
  ): NearestByCell<P> | null {
    // A sparse index skips the ring for the exact linear reference scan ({@link RING_MIN_BUCKETS}):
    // a ring MISS costs the whole O(maxRadius²) diamond however few buckets exist, and confined
    // searches miss constantly.
    if (this.bucketCount <= RING_MIN_BUCKETS) return this.linearNearest(this.candidates, here, accept, gate);
    const ring = this.ringNearest(here, accept, gate);
    if (ring.best !== null) {
      return combine(ring.best, this.linearNearest(this.dynamic, here, accept, gate));
    }
    // An exhaustive sweep (the rings covered every bucket that could pass) proves the bucketed side empty
    // — only the seeker-dependent tail remains. Otherwise the ring cap stopped short: fall back to the
    // exact full linear scan (identical winner).
    if (ring.exhaustive) return this.linearNearest(this.dynamic, here, accept, gate);
    return this.linearNearest(this.candidates, here, accept, gate);
  }

  /** The nearest bucketed candidate within {@link NEAREST_RING_MAX_RADIUS}, or null. The first non-empty
   *  ring holds the minimum distance, so its `(cell-id, entity-id)` winner is the global bucketed winner.
   *  The ring stops at the farthest bucket's Manhattan reach — clamped further to `gate.bounds`'s reach
   *  when the search is confined — so a sparse/empty index or a small confined area rings no wider.
   *  `exhaustive` reports whether the sweep covered that whole reach (a null `best` is then a proof, not a
   *  cap). */
  private ringNearest<P>(
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate?: SpatialGate,
  ): { best: NearestByCell<P> | null; exhaustive: boolean } {
    if (this.maxX < this.minX) return { best: null, exhaustive: true }; // no bucketed candidates at all
    const { x: hx, y: hy } = this.terrain.coordsOf(here);
    let reach = Math.max(hx - this.minX, this.maxX - hx) + Math.max(hy - this.minY, this.maxY - hy);
    if (gate !== undefined) {
      const b = gate.bounds;
      const boundsReach = Math.max(hx - b.minX, b.maxX - hx) + Math.max(hy - b.minY, b.maxY - hy);
      reach = Math.min(reach, boundsReach);
    }
    const maxRadius = Math.min(NEAREST_RING_MAX_RADIUS, reach);
    const exhaustive = reach <= NEAREST_RING_MAX_RADIUS;
    for (let d = 0; d <= maxRadius; d++) {
      let best: NearestByCell<P> | null = null;
      forEachRingOffset(d, (dx, dy) => {
        best = this.pickInRing(hx + dx, hy + dy, d, accept, gate, best);
      });
      if (best !== null) return { best, exhaustive };
    }
    return { best: null, exhaustive };
  }

  /** Fold node `(x,y)`'s bucket into the running ring `best`. Distinct nodes carry distinct cell ids, so a
   *  lower cell wins outright; the entity-id tie-break only decides within one bucket, where the ascending
   *  order makes the first accepted entity the lowest id. */
  private pickInRing<P>(
    x: number,
    y: number,
    distance: number,
    accept: (e: Entity) => Qualified<P> | null,
    gate: SpatialGate | undefined,
    best: NearestByCell<P> | null,
  ): NearestByCell<P> | null {
    const bucket = this.byX.get(x)?.get(y);
    if (bucket === undefined) return best;
    if (best !== null && bucket.cell >= best.cell) return best; // can't beat a lower cell at the same distance
    if (gate !== undefined && !gate.allowsNode(bucket.cell)) return best; // the whole cell is out of bounds
    for (const e of bucket.entities) {
      const hit = accept(e);
      if (hit !== null) return { entity: e, cell: bucket.cell, distance, payload: hit.payload };
    }
    return best;
  }

  /** The `closer` winner over `list`, measuring each candidate's `interactionCell` from `here` — the exact
   *  linear scan the ring accelerates, used for the seeker-dependent tail and the out-of-range fallback.
   *  Shares the standalone {@link nearestByCell} loop (ranked from `here`), so the tie-break lives in one place. */
  private linearNearest<P>(
    list: readonly Entity[],
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate?: SpatialGate,
  ): NearestByCell<P> | null {
    return nearestByCell(this.terrain, list, here, (e) => {
      const hit = accept(e);
      if (hit === null) return null;
      const cell = this.staticCell.get(e) ?? interactionCell(this.world, this.ctx, this.terrain, e, here);
      return gate === undefined || gate.allowsNode(cell) ? { cell, payload: hit.payload } : null;
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
export function nearestByCell<P = null>(
  terrain: TerrainGraph,
  list: readonly Entity[],
  rank: NodeId,
  resolve: (entity: Entity) => CellMatch<P> | null,
): NearestByCell<P> | null {
  let best: NearestByCell<P> | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const entity of list) {
    const match = resolve(entity);
    if (match === null) continue;
    const { cell, payload } = match;
    const distance = manhattan(terrain, rank, cell);
    if (closer(distance, cell, bestDist, bestCell)) {
      best = { entity, cell, distance, payload };
      bestDist = distance;
      bestCell = cell;
    }
  }
  return best;
}

/** The lower of two winners by `(distance, cell-id, entity-id)` — the same total order the linear scans
 *  produce, so merging the bucketed and seeker-dependent winners can never pick a different candidate. */
function combine<P>(a: NearestByCell<P> | null, b: NearestByCell<P> | null): NearestByCell<P> | null {
  if (a === null) return b;
  if (b === null) return a;
  if (b.distance !== a.distance) return b.distance < a.distance ? b : a;
  if (b.cell !== a.cell) return b.cell < a.cell ? b : a;
  return b.entity < a.entity ? b : a;
}
