import type { Entity, World } from '../../../ecs/world.js';
import type { SpatialGate } from '../../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { interactionNode } from '../../footprint/index.js';
import { closer, forEachRingOffset, manhattan } from '../../spatial/nodes.js';
import { interactionCell } from './workplaces.js';

/**
 * Greatest Manhattan ring radius (half-cell nodes) the interaction-cell ring search expands to before
 * falling back to a full linear scan. Performance bound only: the fallback picks the same winner.
 * Approximation, not a decoded distance.
 */
const NEAREST_RING_MAX_RADIUS = 48;

/**
 * Bucket count at or below which `nearest` skips the ring sweep for the linear scan: a ring miss costs
 * the whole O(maxRadius²) diamond however few buckets exist, and a confined search misses often.
 * Performance knob with an identical winner. Approximation.
 */
const RING_MIN_BUCKETS = 64;

/** A scan winner, carrying whatever its `accept` derived on the way so the caller never re-derives it. */
export interface NearestByCell<P = null> {
  readonly entity: Entity;
  readonly cell: NodeId;
  readonly distance: number;
  readonly payload: P;
}

/** An accept verdict carrying the value the qualification derived. A `null` in place of it is the only
 *  reject, so a derived falsy value can never read as a rejection. */
export interface Qualified<P> {
  readonly payload: P;
}

/** The verdict of a scan that derives nothing. Shared, so a plain accept allocates nothing per candidate. */
export const QUALIFIES: Qualified<null> = { payload: null };

export function qualifiedGood(goodType: number | null): Qualified<number> | null {
  return goodType === null ? null : { payload: goodType };
}

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
 * passing `accept`" by the `(distance, cell-id, entity-id)` order as a bounded node-ring search.
 *
 * Only a seeker-independent interaction cell (a building door) can be bucketed; a seeker-dependent one
 * (a boat hull, a loose ground pile, a resource work cell) stays in a linearly scanned `dynamic` tail,
 * and `nearest` merges both winners, so the result matches a full linear scan for any candidate mix.
 * `NodeBuckets` cannot serve here: it ranks off a candidate's own tile and tie-breaks by entity id.
 */
export class InteractionCellIndex {
  private readonly byX = new Map<number, Map<number, CellBucket>>();
  private readonly dynamic: Entity[] = [];
  private bucketCount = 0;
  // Interaction cells resolved once at construction, so no scan re-derives a building's door per query.
  private readonly staticCell = new Map<Entity, NodeId>();
  // Bounding box of the bucketed cells (empty ⟹ minX > maxX), so a ring search never expands past the
  // farthest bucket.
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
        this.dynamic.push(e); // seeker-dependent cell - resolve it per query, not once here
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
   * The nearest candidate to `here` that `accept` qualifies, by the `(distance, cell-id, entity-id)` order,
   * or null when none does. `accept` must be side-effect-free: a ring miss re-runs it on the linear
   * fallback, which picks the identical winner.
   */
  nearest<P>(
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    /** Rejects whole interaction cells and bounds the sweep: every gate-passing cell lies in `gate.bounds`. */
    gate?: SpatialGate,
    /** Rejects cells this seeker's own routes just failed on. `here` is exempt; never bounds the sweep. */
    avoid?: (cell: NodeId) => boolean,
    /** Rejects a candidate owned by another player, per entity rather than per cell. */
    onSide?: (e: Entity) => boolean,
  ): NearestByCell<P> | null {
    const veto = avoid === undefined ? undefined : (cell: NodeId): boolean => cell !== here && avoid(cell);
    if (this.bucketCount <= RING_MIN_BUCKETS) {
      return this.linearNearest(this.candidates, here, accept, gate, veto, onSide);
    }
    const ring = this.ringNearest(here, accept, gate, veto, onSide);
    if (ring.best !== null) {
      return combine(ring.best, this.linearNearest(this.dynamic, here, accept, gate, veto, onSide));
    }
    // An exhaustive sweep proves the bucketed side empty, so only the seeker-dependent tail remains;
    // otherwise the ring cap stopped short and the full linear scan decides.
    if (ring.exhaustive) return this.linearNearest(this.dynamic, here, accept, gate, veto, onSide);
    return this.linearNearest(this.candidates, here, accept, gate, veto, onSide);
  }

  /** The nearest bucketed candidate within {@link NEAREST_RING_MAX_RADIUS}, or null. The first non-empty
   *  ring holds the minimum distance, so its winner is the global bucketed winner. `exhaustive` reports
   *  whether the sweep covered the whole reach, making a null `best` a proof rather than a cap. */
  private ringNearest<P>(
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate?: SpatialGate,
    veto?: (cell: NodeId) => boolean,
    onSide?: (e: Entity) => boolean,
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
    let best: NearestByCell<P> | null = null;
    let ringDist = 0;
    const visit = (dx: number, dy: number): void => {
      best = this.pickInRing(hx + dx, hy + dy, ringDist, accept, gate, veto, onSide, best);
    };
    for (let d = 0; d <= maxRadius; d++) {
      best = null;
      ringDist = d;
      forEachRingOffset(d, visit);
      if (best !== null) return { best, exhaustive };
    }
    return { best: null, exhaustive };
  }

  /** Fold node `(x,y)`'s bucket into the running ring `best`. Distinct nodes carry distinct cell ids, so a
   *  lower cell wins outright and the entity-id tie-break only decides within one ascending-id bucket. */
  private pickInRing<P>(
    x: number,
    y: number,
    distance: number,
    accept: (e: Entity) => Qualified<P> | null,
    gate: SpatialGate | undefined,
    veto: ((cell: NodeId) => boolean) | undefined,
    onSide: ((e: Entity) => boolean) | undefined,
    best: NearestByCell<P> | null,
  ): NearestByCell<P> | null {
    const bucket = this.byX.get(x)?.get(y);
    if (bucket === undefined) return best;
    if (best !== null && bucket.cell >= best.cell) return best; // can't beat a lower cell at the same distance
    if (gate !== undefined && !gate.allowsNode(bucket.cell)) return best; // the whole cell is out of bounds
    if (veto?.(bucket.cell) === true) return best; // a goal this seeker cannot reach
    for (const e of bucket.entities) {
      if (onSide !== undefined && !onSide(e)) continue; // another player's candidate
      const hit = accept(e);
      if (hit !== null) return { entity: e, cell: bucket.cell, distance, payload: hit.payload };
    }
    return best;
  }

  /** The exact linear scan the ring accelerates, used for the seeker-dependent tail and the out-of-range
   *  fallback. Shares the standalone {@link nearestByCell} loop, so the tie-break lives in one place. */
  private linearNearest<P>(
    list: readonly Entity[],
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate?: SpatialGate,
    veto?: (cell: NodeId) => boolean,
    onSide?: (e: Entity) => boolean,
  ): NearestByCell<P> | null {
    return nearestByCell(
      this.terrain,
      list,
      here,
      (e) => {
        const hit = accept(e);
        if (hit === null) return null;
        const cell = this.staticCell.get(e) ?? interactionCell(this.world, this.ctx, this.terrain, e, here);
        if (gate !== undefined && !gate.allowsNode(cell)) return null;
        if (veto?.(cell) === true) return null;
        return { cell, payload: hit.payload };
      },
      onSide,
    );
  }
}

/**
 * The `(distance, cell-id, entity-id)` winner over `list`, where `resolve` maps a candidate to its
 * interaction cell or to null to skip it. `rank` is the ranking origin, usually the seeker but a flag
 * centre when a bound gatherer works outward from its flag, so a candidate may be ranked from a
 * different node than the one its interaction cell resolves against.
 */
export function nearestByCell<P = null>(
  terrain: TerrainGraph,
  list: readonly Entity[],
  rank: NodeId,
  resolve: (entity: Entity) => CellMatch<P> | null,
  /** Rejects a candidate owned by another player before `resolve` runs. Scans over unowned map features
   *  (standing resources, ground heaps) omit it. */
  onSide?: (e: Entity) => boolean,
): NearestByCell<P> | null {
  let best: NearestByCell<P> | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const entity of list) {
    if (onSide !== undefined && !onSide(entity)) continue; // another player's candidate
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

/** The lower of two winners by `(distance, cell-id, entity-id)`, the same total order the linear scans
 *  produce, so merging the bucketed and seeker-dependent winners cannot pick a different candidate. */
function combine<P>(a: NearestByCell<P> | null, b: NearestByCell<P> | null): NearestByCell<P> | null {
  if (a === null) return b;
  if (b === null) return a;
  if (b.distance !== a.distance) return b.distance < a.distance ? b : a;
  if (b.cell !== a.cell) return b.cell < a.cell ? b : a;
  return b.entity < a.entity ? b : a;
}
