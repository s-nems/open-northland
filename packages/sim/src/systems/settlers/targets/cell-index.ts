import { Building, Palisade, Position, Stockpile } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { NodeBox, SpatialGate } from '../../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { MapContext } from '../../context.js';
import { routeRegions } from '../../footprint/index.js';
import { interactionCellOf } from '../../footprint/interaction.js';
import { closer, manhattan } from '../../spatial/metric.js';
import { NodeBuckets } from '../../spatial/nodes.js';
import { interactionCell } from './workplaces.js';

/**
 * Greatest Manhattan ring radius (half-cell nodes) the interaction-cell ring search expands to before
 * falling back to a full linear scan. Performance bound only: the fallback picks the same winner.
 * Approximation, not a decoded distance.
 */
const NEAREST_RING_MAX_RADIUS = 48;

/**
 * Bucket count at or below which `nearest` skips the ring sweep for the linear scan, which a confined
 * search that often misses finishes sooner. Performance knob with an identical winner. Approximation.
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

/** An accept that qualifies every candidate, for a scan whose candidate list is already the answer set. */
export const ACCEPT_ALL: (e: Entity) => Qualified<null> = () => QUALIFIES;

export function qualifiedGood(goodType: number | null): Qualified<number> | null {
  return goodType === null ? null : { payload: goodType };
}

export interface CellMatch<P> extends Qualified<P> {
  readonly cell: NodeId;
}

/** Candidate counts per coordinate along one axis, so the span tightens once an edge coordinate empties. */
class AxisSpan {
  private readonly counts = new Map<number, number>();
  min = Number.POSITIVE_INFINITY;
  max = Number.NEGATIVE_INFINITY;

  add(v: number): void {
    this.counts.set(v, (this.counts.get(v) ?? 0) + 1);
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
  }

  remove(v: number): void {
    const left = (this.counts.get(v) ?? 1) - 1;
    if (left > 0) {
      this.counts.set(v, left);
      return;
    }
    this.counts.delete(v);
    if (v !== this.min && v !== this.max) return;
    this.min = Number.POSITIVE_INFINITY;
    this.max = Number.NEGATIVE_INFINITY;
    for (const held of this.counts.keys()) {
      if (held < this.min) this.min = held;
      if (held > this.max) this.max = held;
    }
  }
}

/** Nodes per side of a {@link CellGrid} tile, a power of two. */
const TILE_SHIFT = 3;
const TILE_SIZE = 1 << TILE_SHIFT;
/** Packs a node or a tile into one key; coordinates stay below it on every map. */
const GRID_KEY_STRIDE = 1 << 16;

/** Candidates bucketed by node coordinates, with the span of the occupied nodes so a search never
 *  expands past the farthest bucket, and the occupied nodes of each square tile so a search reads only
 *  occupied nodes, nearest tiles first. */
class CellGrid {
  private readonly buckets: NodeBuckets;
  private readonly xs = new AxisSpan();
  private readonly ys = new AxisSpan();
  /** Each tile's occupied nodes as packed keys, ascending. */
  private readonly tiles = new Map<number, number[]>();
  /** Occupied nodes. */
  size = 0;

  constructor(world: World) {
    this.buckets = new NodeBuckets(world, []);
  }

  add(e: Entity, x: number, y: number): void {
    if (this.buckets.at(x, y).length === 0) {
      this.size++;
      const tile = (x >> TILE_SHIFT) * GRID_KEY_STRIDE + (y >> TILE_SHIFT);
      let nodes = this.tiles.get(tile);
      if (nodes === undefined) {
        nodes = [];
        this.tiles.set(tile, nodes);
      }
      insertSortedById(nodes, x * GRID_KEY_STRIDE + y, nodeKey);
    }
    this.buckets.insert(e, x, y);
    this.xs.add(x);
    this.ys.add(y);
  }

  /** Drop `e`, which {@link add} placed at `(x,y)`. */
  remove(e: Entity, x: number, y: number): void {
    this.buckets.remove(e, x, y);
    if (this.buckets.at(x, y).length === 0) {
      this.size--;
      const tile = (x >> TILE_SHIFT) * GRID_KEY_STRIDE + (y >> TILE_SHIFT);
      const nodes = this.tiles.get(tile);
      if (nodes !== undefined) {
        removeSortedById(nodes, x * GRID_KEY_STRIDE + y, nodeKey);
        if (nodes.length === 0) this.tiles.delete(tile);
      }
    }
    this.xs.remove(x);
    this.ys.remove(y);
  }

  /**
   * Hand `visit` every occupied node within Manhattan `maxRadius` of `(x,y)` with its distance and bucket,
   * tile by tile in order of each tile's least distance. `visit` returns the distance past which no node
   * can still win; the search stops once every node left lies more than `slack` past it.
   */
  nearestFirst(
    x: number,
    y: number,
    maxRadius: number,
    slack: number,
    visit: (nx: number, ny: number, distance: number, bucket: readonly Entity[]) => number,
  ): void {
    // Call-local, since a visit may search this grid again.
    const tileNodes: (readonly number[])[] = [];
    const tileDistances: number[] = [];
    const tileOrder: number[] = [];
    const minTx = Math.max(0, x - maxRadius) >> TILE_SHIFT;
    const maxTx = (x + maxRadius) >> TILE_SHIFT;
    const minTy = Math.max(0, y - maxRadius) >> TILE_SHIFT;
    const maxTy = (y + maxRadius) >> TILE_SHIFT;
    for (let tx = minTx; tx <= maxTx; tx++) {
      const dx = Math.max(0, tx * TILE_SIZE - x, x - (tx * TILE_SIZE + TILE_SIZE - 1));
      for (let ty = minTy; ty <= maxTy; ty++) {
        const nodes = this.tiles.get(tx * GRID_KEY_STRIDE + ty);
        if (nodes === undefined) continue;
        const least = dx + Math.max(0, ty * TILE_SIZE - y, y - (ty * TILE_SIZE + TILE_SIZE - 1));
        if (least > maxRadius) continue;
        tileOrder.push(tileNodes.length);
        tileNodes.push(nodes);
        tileDistances.push(least);
      }
    }
    tileOrder.sort((a, b) => (tileDistances[a] as number) - (tileDistances[b] as number));
    let bound = Number.POSITIVE_INFINITY;
    for (const i of tileOrder) {
      if ((tileDistances[i] as number) - slack > bound) return;
      for (const key of tileNodes[i] as readonly number[]) {
        const nx = Math.floor(key / GRID_KEY_STRIDE);
        const ny = key - nx * GRID_KEY_STRIDE;
        const distance = Math.abs(nx - x) + Math.abs(ny - y);
        if (distance > maxRadius || distance - slack > bound) continue;
        bound = visit(nx, ny, distance, this.buckets.at(nx, ny));
      }
    }
  }

  /** Node `(x,y)`'s candidates, ascending-id. */
  at(x: number, y: number): readonly Entity[] {
    return this.buckets.at(x, y);
  }

  /** The ring radius from `(x,y)` covering every bucket, or -1 when there is none. */
  reach(x: number, y: number): number {
    if (this.size === 0) return -1;
    const { xs, ys } = this;
    return Math.max(x - xs.min, xs.max - x) + Math.max(y - ys.min, ys.max - y);
  }
}

const entityId = (e: Entity): number => e;
const nodeKey = (key: number): number => key;

/**
 * A spatial index over an economy candidate list, answering "nearest candidate to `here` passing
 * `accept`" by the `(distance, cell-id, entity-id)` order as a bounded node-ring search. Built per tick
 * over a band, or kept across ticks through {@link add} and {@link remove}.
 *
 * A seeker-independent interaction cell (a building door) is bucketed by that cell. A seeker-dependent
 * one (a loose ground pile) is bucketed by the candidate's own node and resolved per query: its cell lies
 * within the content's largest work-cell offset of that node, so the loose ring runs that slack past the
 * best exact distance. `nearest` merges both winners, so the result matches a full linear scan for any
 * candidate mix.
 */
export class InteractionCellIndex {
  private doors: CellGrid;
  private readonly doorList: Entity[] = [];
  // Doors resolved once when indexed, so no scan re-derives a building's door per query.
  private readonly doorCell = new Map<Entity, NodeId>();
  private readonly looseList: Entity[] = [];
  /** Each loose candidate's own node, the key it is bucketed by. */
  private readonly looseNode = new Map<Entity, NodeId>();
  /** Built by the first loose ring search, then kept current by {@link add} and {@link remove}. */
  private looseGrid: CellGrid | null = null;
  /** Greatest Manhattan offset (half-cell nodes) of a loose candidate's interaction cell from its own
   *  node: a free neighbour, or the work cell of a resource standing on the same node. */
  private readonly slack: number;

  constructor(
    private readonly world: World,
    private readonly ctx: MapContext,
    private readonly terrain: TerrainGraph,
    candidates: readonly Entity[] = [],
  ) {
    this.slack = contentIndex(ctx.content).maxResourceWorkOffset;
    this.doors = new CellGrid(world);
    for (const e of candidates) this.add(e);
  }

  /** Index positioned `e` by its door, or by its own node when its cell depends on the seeker. */
  add(e: Entity): void {
    const { world, terrain } = this;
    const cell = interactionCellOf(world, this.ctx, terrain, e);
    if (cell !== null) {
      this.doorCell.set(e, cell);
      insertSortedById(this.doorList, e, entityId);
      this.doors.add(e, terrain.xOf(cell), terrain.yOf(cell));
      return;
    }
    const p = world.get(e, Position);
    const node = terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
    this.looseNode.set(e, node);
    insertSortedById(this.looseList, e, entityId);
    this.looseGrid?.add(e, terrain.xOf(node), terrain.yOf(node));
  }

  /** Drop `e` from the key {@link add} filed it under; a no-op for an entity not indexed. */
  remove(e: Entity): void {
    const { terrain } = this;
    const cell = this.doorCell.get(e);
    if (cell !== undefined) {
      this.doorCell.delete(e);
      removeSortedById(this.doorList, e, entityId);
      this.doors.remove(e, terrain.xOf(cell), terrain.yOf(cell));
      return;
    }
    const node = this.looseNode.get(e);
    if (node === undefined) return;
    this.looseNode.delete(e);
    removeSortedById(this.looseList, e, entityId);
    this.looseGrid?.remove(e, terrain.xOf(node), terrain.yOf(node));
  }

  /** Forget every candidate. */
  clear(): void {
    this.doors = new CellGrid(this.world);
    this.doorList.length = 0;
    this.doorCell.clear();
    this.looseList.length = 0;
    this.looseNode.clear();
    this.looseGrid = null;
  }

  /** Whether the seeker-independent candidate filter admitted anything. */
  hasCandidates(): boolean {
    return this.doorList.length > 0 || this.looseList.length > 0;
  }

  /** How far, in Manhattan half-cell nodes, a candidate's interaction cell may lie from the node
   *  {@link anyFiledIn} tests it at. */
  get filedSlack(): number {
    return this.slack;
  }

  /** Whether a candidate filed at a node `area` admits passes `accept`, unranked: for a caller that would
   *  otherwise sweep every ring to learn there is none. A door candidate is filed at its door, a loose one
   *  at its own node, up to {@link filedSlack} from its interaction cell. */
  anyFiledIn(area: (x: number, y: number) => boolean, accept: (e: Entity) => boolean): boolean {
    const { terrain } = this;
    for (const e of this.doorList) {
      const cell = this.doorCell.get(e);
      if (cell !== undefined && area(terrain.xOf(cell), terrain.yOf(cell)) && accept(e)) return true;
    }
    for (const e of this.looseList) {
      const node = this.looseNode.get(e);
      if (node !== undefined && area(terrain.xOf(node), terrain.yOf(node)) && accept(e)) return true;
    }
    return false;
  }

  /** A mismatch message per candidate `fresh` keys differently, for a cache verifier. */
  divergence(fresh: InteractionCellIndex): string[] {
    const out: string[] = [];
    const differs = (a: readonly Entity[], b: readonly Entity[]): boolean =>
      a.length !== b.length || a.some((e, i) => e !== b[i]);
    if (differs(this.doorList, fresh.doorList)) out.push('door candidates differ');
    if (differs(this.looseList, fresh.looseList)) out.push('loose candidates differ');
    for (const [e, cell] of fresh.doorCell) {
      if (this.doorCell.get(e) !== cell) out.push(`candidate ${e} is filed at a stale door`);
    }
    for (const [e, node] of fresh.looseNode) {
      if (this.looseNode.get(e) !== node) out.push(`candidate ${e} is filed at a stale node`);
    }
    return out;
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
    /** The ranking origin, a flag centre for a carrier working outward from its flag; `here` stays the
     *  route start the interaction cell, sealing and veto are judged from. */
    rank: NodeId = here,
  ): NearestByCell<P> | null {
    const door = this.doorNearest(here, rank, accept, gate, avoid, onSide);
    return nearerOf(door, this.looseNearest(here, rank, accept, gate, avoid, onSide, door?.distance));
  }

  /** The {@link nearest} winner among the door-bucketed candidates, for an `accept` that only a building
   *  can pass. */
  nearestDoor<P>(
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate?: SpatialGate,
    avoid?: (cell: NodeId) => boolean,
    onSide?: (e: Entity) => boolean,
  ): NearestByCell<P> | null {
    return this.doorNearest(here, here, accept, gate, avoid, onSide);
  }

  /** The {@link nearest} winner among the candidates without a door: the building-less ones. */
  nearestLoose<P>(
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate?: SpatialGate,
    avoid?: (cell: NodeId) => boolean,
    onSide?: (e: Entity) => boolean,
  ): NearestByCell<P> | null {
    return this.looseNearest(here, here, accept, gate, avoid, onSide);
  }

  private doorNearest<P>(
    here: NodeId,
    rank: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate: SpatialGate | undefined,
    avoid: ((cell: NodeId) => boolean) | undefined,
    onSide: ((e: Entity) => boolean) | undefined,
  ): NearestByCell<P> | null {
    if (this.doors.size <= RING_MIN_BUCKETS) {
      return this.linearNearest(this.doorList, here, accept, gate, avoid, onSide, rank);
    }
    const hx = this.terrain.xOf(rank);
    const hy = this.terrain.yOf(rank);
    let reach = this.doors.reach(hx, hy);
    if (gate !== undefined) reach = Math.min(reach, boundsReach(gate, hx, hy));
    const maxRadius = Math.min(NEAREST_RING_MAX_RADIUS, reach);
    const best = this.ringNearest(here, rank, maxRadius, accept, gate, avoid, onSide);
    // An exhaustive sweep proves a null; otherwise the ring cap stopped short and the full scan decides.
    if (best !== null || reach <= NEAREST_RING_MAX_RADIUS) return best;
    return this.linearNearest(this.doorList, here, accept, gate, avoid, onSide, rank);
  }

  /** The nearest door-bucketed candidate within Manhattan `maxRadius` of `rank`, or null, by the
   *  `(distance, cell-id, entity-id)` order. */
  private ringNearest<P>(
    here: NodeId,
    rank: NodeId,
    maxRadius: number,
    accept: (e: Entity) => Qualified<P> | null,
    gate: SpatialGate | undefined,
    avoid: ((cell: NodeId) => boolean) | undefined,
    onSide: ((e: Entity) => boolean) | undefined,
  ): NearestByCell<P> | null {
    let best: NearestByCell<P> | null = null;
    this.doors.nearestFirst(
      this.terrain.xOf(rank),
      this.terrain.yOf(rank),
      maxRadius,
      0,
      (x, y, d, bucket) => {
        best = this.pickInRing(x, y, d, bucket, here, accept, gate, avoid, onSide, best);
        return best?.distance ?? Number.POSITIVE_INFINITY;
      },
    );
    return best;
  }

  /** Fold node `(x,y)`'s door `bucket` at `distance` into the running `best`. Distinct nodes carry distinct
   *  cell ids, so a nearer or lower cell wins outright and the entity-id tie-break only decides within one
   *  ascending-id bucket. */
  private pickInRing<P>(
    x: number,
    y: number,
    distance: number,
    bucket: readonly Entity[],
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate: SpatialGate | undefined,
    avoid: ((cell: NodeId) => boolean) | undefined,
    onSide: ((e: Entity) => boolean) | undefined,
    best: NearestByCell<P> | null,
  ): NearestByCell<P> | null {
    if (bucket.length === 0) return best;
    const cell = this.terrain.nodeAt(x, y); // an occupied bucket sits on the map
    // Can't beat a nearer winner, or a lower cell at the same distance.
    if (best !== null && (distance > best.distance || (distance === best.distance && cell >= best.cell)))
      return best;
    if (gate !== undefined && !gate.allowsNode(cell)) return best; // the whole cell is out of bounds
    if (vetoed(avoid, here, cell)) return best; // a goal this seeker cannot reach
    for (let i = 0; i < bucket.length; i++) {
      const e = bucket[i];
      if (e === undefined) continue; // i < length, so only for the type
      if (onSide !== undefined && !onSide(e)) continue; // another player's candidate
      const hit = accept(e);
      if (hit !== null) return { entity: e, cell, distance, payload: hit.payload };
    }
    return best;
  }

  /**
   * The nearest loose candidate that could beat `bound`, a distance some other winner already holds, or
   * null. A node `d` from `rank` holds candidates at least `d - slack` from it, so the sweep ends once
   * that exceeds the best exact distance; a cap short of that falls back to the candidates beyond it.
   */
  private looseNearest<P>(
    here: NodeId,
    rank: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate: SpatialGate | undefined,
    avoid: ((cell: NodeId) => boolean) | undefined,
    onSide: ((e: Entity) => boolean) | undefined,
    bound = Number.POSITIVE_INFINITY,
  ): NearestByCell<P> | null {
    if (this.looseList.length <= RING_MIN_BUCKETS) {
      return this.linearNearest(this.looseList, here, accept, gate, avoid, onSide, rank);
    }
    const { terrain, slack } = this;
    const grid = this.gridOfLoose();
    const hx = terrain.xOf(rank);
    const hy = terrain.yOf(rank);
    let reach = grid.reach(hx, hy);
    if (gate !== undefined) reach = Math.min(reach, boundsReach(gate, hx, hy) + slack);
    const maxRadius = Math.min(NEAREST_RING_MAX_RADIUS, reach);
    // Typed by assertion: assigned in the visit, so flow narrowing must not pin it to null.
    let best = null as NearestByCell<P> | null;
    // A candidate's cell lies within `slack` of its node, so nothing past the best distance plus that slack
    // can come nearer.
    grid.nearestFirst(hx, hy, maxRadius, slack, (_x, _y, _d, bucket) => {
      for (let j = 0; j < bucket.length; j++) {
        const e = bucket[j];
        if (e !== undefined) best = this.weighLoose(e, here, rank, accept, gate, avoid, onSide, best);
      }
      return Math.min(bound, best?.distance ?? bound);
    });
    // Past the cap only nodes farther than `maxRadius` remain, and none can beat a bound short of it.
    if (reach <= NEAREST_RING_MAX_RADIUS || Math.min(bound, best?.distance ?? bound) + slack < maxRadius)
      return best;
    for (let i = 0; i < this.looseList.length; i++) {
      const e = this.looseList[i];
      const node = e === undefined ? undefined : this.looseNode.get(e);
      if (e === undefined || node === undefined) continue; // every listed candidate has a node
      const x = terrain.xOf(node);
      const y = terrain.yOf(node);
      const d = Math.abs(x - hx) + Math.abs(y - hy);
      if (d <= maxRadius) continue; // the rings weighed it already
      if (d - slack > Math.min(bound, best?.distance ?? bound)) continue; // cannot come nearer
      if (gate !== undefined && !nearBox(gate.bounds, x, y, slack)) continue; // no gate-passing cell in slack
      best = this.weighLoose(e, here, rank, accept, gate, avoid, onSide, best);
    }
    return best;
  }

  private gridOfLoose(): CellGrid {
    if (this.looseGrid === null) {
      const { terrain } = this;
      const grid = new CellGrid(this.world);
      const list = this.looseList;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const node = e === undefined ? undefined : this.looseNode.get(e);
        if (e !== undefined && node !== undefined) grid.add(e, terrain.xOf(node), terrain.yOf(node));
      }
      this.looseGrid = grid;
    }
    return this.looseGrid;
  }

  /** `best`, or loose candidate `e` when it qualifies and precedes `best` in the total order. */
  private weighLoose<P>(
    e: Entity,
    here: NodeId,
    rank: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate: SpatialGate | undefined,
    avoid: ((cell: NodeId) => boolean) | undefined,
    onSide: ((e: Entity) => boolean) | undefined,
    best: NearestByCell<P> | null,
  ): NearestByCell<P> | null {
    if (onSide !== undefined && !onSide(e)) return best; // another player's candidate
    const hit = accept(e);
    if (hit === null) return best;
    if (this.gatedOutLoose(gate, e)) return best;
    const cell = interactionCell(this.world, this.ctx, this.terrain, e, here);
    if (gate !== undefined && !gate.allowsNode(cell)) return best;
    if (vetoed(avoid, here, cell)) return best;
    const distance = manhattan(this.terrain, rank, cell);
    if (best !== null && !precedes(distance, cell, e, best)) return best;
    if (this.pileCellSealed(e, here, cell)) return best;
    return { entity: e, cell, distance, payload: hit.payload };
  }

  /** Whether `gate` rules loose candidate `e` out from its own node alone, sparing the per-seeker cell
   *  resolution: the cell lies within {@link slack} of that node. */
  private gatedOutLoose(gate: SpatialGate | undefined, e: Entity): boolean {
    if (gate?.mayAllowNear === undefined) return false;
    const node = this.looseNode.get(e);
    if (node === undefined) return false;
    return !gate.mayAllowNear(this.terrain.xOf(node), this.terrain.yOf(node), this.slack);
  }

  /**
   * Whether loose pile `e` resolved to a `cell` no walk from `here` enters: a structure covers it, or it
   * lies across a sealed pocket wall. A pile whose every stance is walled off resolves to its own anchor,
   * and a fetcher sent there path-fails on every re-pick. A palisade or a door-less building is worked
   * from cells its own drive picks, so only a structure-less stockpile is judged. Checked after the cheap
   * gates.
   */
  private pileCellSealed(e: Entity, here: NodeId, cell: NodeId): boolean {
    const { world } = this;
    if (cell === here || !world.has(e, Stockpile) || world.has(e, Building) || world.has(e, Palisade)) {
      return false;
    }
    const regions = routeRegions(this.world, this.ctx, this.terrain);
    return !regions.standable(cell) || regions.unroutable(here, cell);
  }

  /** The exact linear scan the rings accelerate, for a short list or a door ring's out-of-range
   *  fallback: {@link nearestByCell}'s loop and tie-break, resolving each candidate's cell in place. */
  private linearNearest<P>(
    list: readonly Entity[],
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate: SpatialGate | undefined,
    avoid: ((cell: NodeId) => boolean) | undefined,
    onSide: ((e: Entity) => boolean) | undefined,
    rank: NodeId = here,
  ): NearestByCell<P> | null {
    const { world, ctx, terrain } = this;
    let bestEntity: Entity | undefined;
    let bestHit: Qualified<P> | null = null;
    let bestNode: NodeId | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestCell = Number.POSITIVE_INFINITY;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === undefined) continue;
      if (onSide !== undefined && !onSide(e)) continue; // another player's candidate
      const hit = accept(e);
      if (hit === null) continue;
      const door = this.doorCell.get(e);
      if (door === undefined && this.gatedOutLoose(gate, e)) continue;
      const cell = door ?? interactionCell(world, ctx, terrain, e, here);
      if (gate !== undefined && !gate.allowsNode(cell)) continue;
      if (vetoed(avoid, here, cell)) continue;
      if (door === undefined && this.pileCellSealed(e, here, cell)) continue;
      const distance = manhattan(terrain, rank, cell);
      if (closer(distance, cell, bestDist, bestCell)) {
        bestEntity = e;
        bestHit = hit;
        bestNode = cell;
        bestDist = distance;
        bestCell = cell;
      }
    }
    return bestEntity === undefined || bestHit === null || bestNode === undefined
      ? null
      : { entity: bestEntity, cell: bestNode, distance: bestDist, payload: bestHit.payload };
  }
}

/** Whether `avoid` rejects `cell`, a goal this seeker's routes just failed on; its own cell `here` is
 *  exempt. */
function vetoed(avoid: ((cell: NodeId) => boolean) | undefined, here: NodeId, cell: NodeId): boolean {
  return avoid !== undefined && cell !== here && avoid(cell);
}

/** Whether `(x, y)` lies within `slack` of `box` on both axes, as a node within Manhattan `slack` of a
 *  node of the box does. */
function nearBox(box: NodeBox, x: number, y: number, slack: number): boolean {
  return x >= box.minX - slack && x <= box.maxX + slack && y >= box.minY - slack && y <= box.maxY + slack;
}

/** The ring radius from `(x,y)` covering every node of `gate.bounds`. */
function boundsReach(gate: SpatialGate, x: number, y: number): number {
  const b = gate.bounds;
  return Math.max(x - b.minX, b.maxX - x) + Math.max(y - b.minY, b.maxY - y);
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
  let bestEntity: Entity | undefined;
  let bestMatch: CellMatch<P> | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (let i = 0; i < list.length; i++) {
    const entity = list[i];
    if (entity === undefined) continue;
    if (onSide !== undefined && !onSide(entity)) continue; // another player's candidate
    const match = resolve(entity);
    if (match === null) continue;
    const { cell } = match;
    const distance = manhattan(terrain, rank, cell);
    if (closer(distance, cell, bestDist, bestCell)) {
      bestEntity = entity;
      bestMatch = match;
      bestDist = distance;
      bestCell = cell;
    }
  }
  return bestEntity === undefined || bestMatch === null
    ? null
    : { entity: bestEntity, cell: bestMatch.cell, distance: bestDist, payload: bestMatch.payload };
}

/** Whether `(distance, cell, entity)` precedes `best` in the total order every scan here shares. */
function precedes<P>(distance: number, cell: NodeId, entity: Entity, best: NearestByCell<P>): boolean {
  if (distance !== best.distance) return distance < best.distance;
  if (cell !== best.cell) return cell < best.cell;
  return entity < best.entity;
}

/** The lower of two winners by `(distance, cell-id, entity-id)`, the same total order the linear scans
 *  produce, so merging winners of disjoint or overlapping lists cannot pick a different candidate. */
export function nearerOf<P>(a: NearestByCell<P> | null, b: NearestByCell<P> | null): NearestByCell<P> | null {
  if (a === null) return b;
  if (b === null) return a;
  return precedes(b.distance, b.cell, b.entity, a) ? b : a;
}
