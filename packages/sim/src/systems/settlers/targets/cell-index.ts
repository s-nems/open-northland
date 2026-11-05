import {
  Building,
  Owner,
  ownerOf,
  Palisade,
  Position,
  Stockpile,
  sameSideAs,
} from '../../../components/index.js';
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
import { CellGrid } from './cell-grid.js';
import { interactionCell } from './workplaces.js';

/**
 * Greatest Manhattan ring radius (half-cell nodes) the interaction-cell ring search sweeps tile by tile
 * before the block-level search takes the farther nodes. Performance bound only: both pick the same
 * winner. Approximation, not a decoded distance.
 */
const NEAREST_RING_MAX_RADIUS = 48;

/**
 * Bucket count at or below which `nearest` skips the ring sweep for the linear scan, which a confined
 * search that often misses finishes sooner. Performance knob with an identical winner. Approximation.
 */
export const RING_MIN_BUCKETS = 64;

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

const entityId = (e: Entity): number => e;

const NONE_PENDING: ReadonlySet<Entity> = new Set();

/** One candidate set's lists and grids: every candidate of an index, or one owner side's share. */
class CandidateSet {
  readonly doors = new CellGrid();
  readonly doorList: Entity[] = [];
  readonly looseList: Entity[] = [];
  /** Built by the first loose ring search, then kept current by the index's edits. */
  looseGrid: CellGrid | null = null;

  addDoor(e: Entity, x: number, y: number): void {
    insertSortedById(this.doorList, e, entityId);
    this.doors.add(e, x, y);
  }

  removeDoor(e: Entity, x: number, y: number): void {
    removeSortedById(this.doorList, e, entityId);
    this.doors.remove(e, x, y);
  }

  addLoose(e: Entity, x: number, y: number): void {
    insertSortedById(this.looseList, e, entityId);
    this.looseGrid?.add(e, x, y);
  }

  removeLoose(e: Entity, x: number, y: number): void {
    removeSortedById(this.looseList, e, entityId);
    this.looseGrid?.remove(e, x, y);
  }

  /** A member, or undefined for an empty set. */
  any(): Entity | undefined {
    return this.doorList[0] ?? this.looseList[0];
  }
}

/** Slots per candidate of an {@link InteractionCellIndex.filedOnSide} read: its entity, then its filed
 *  node's `x, y`. */
export const FILED_STRIDE = 3;
/** Candidates the {@link InteractionCellIndex.filedOnSide} scratch starts with room for. */
const INITIAL_FILED_CANDIDATES = 128;
/** The candidates a side read collects before it copies them out at their count. */
let filedScratch = new Int32Array(INITIAL_FILED_CANDIDATES * FILED_STRIDE);
let filedUsed = 0;

function collectFiled(e: Entity, x: number, y: number): void {
  if (filedUsed + FILED_STRIDE > filedScratch.length) {
    const grown = new Int32Array(filedScratch.length * 2);
    grown.set(filedScratch);
    filedScratch = grown;
  }
  filedScratch[filedUsed] = e;
  filedScratch[filedUsed + 1] = x;
  filedScratch[filedUsed + 2] = y;
  filedUsed += FILED_STRIDE;
}

/** The side key of an unowned candidate; a player's key is its slot. */
const NEUTRAL_SIDE = -1;

function sideKeyOf(world: World, e: Entity): number {
  return ownerOf(world, e) ?? NEUTRAL_SIDE;
}

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
 *
 * A side-filtered query searches only the sides its filter admits: the candidates split by owner on the
 * first such query and kept current from the Owner journals. Each side's winner merges by the same total
 * order, so skipping a rejected side's candidates wholesale cannot change the pick.
 */
export class InteractionCellIndex {
  private all: CandidateSet;
  /** {@link all} alone, the sets an unfiltered query searches, kept so a query allocates no list. */
  private allSets: readonly CandidateSet[];
  // Doors resolved once when indexed, so no scan re-derives a building's door per query.
  private readonly doorCell = new Map<Entity, NodeId>();
  /** Each loose candidate's own node, the key it is bucketed by. */
  private readonly looseNode = new Map<Entity, NodeId>();
  /** The candidates by owner side; null until the first side-filtered query. */
  private sides: Map<number, CandidateSet> | null = null;
  /** The side each candidate is filed under while {@link sides} is kept. */
  private readonly sideOf = new Map<Entity, number>();
  /** The Owner membership and value-write generations {@link sides} is current to. */
  private ownerMembership = 0;
  private ownerValues = 0;
  private readonly refileSide = (e: Entity): void => {
    const filed = this.sideOf.get(e);
    if (filed === undefined || filed === sideKeyOf(this.world, e)) return;
    this.dropFromSide(e, filed);
    this.fileInSide(e);
    this.revision++;
  };
  /** Moves on every edit of the candidates or their sides, so a memo over them knows when to re-read. */
  private revision = 0;
  /** {@link filedOnSide} per owner, with the revision it was read at. */
  private readonly sideFiled = new Map<number, { readonly revision: number; readonly filed: Int32Array }>();
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
    this.all = new CandidateSet();
    this.allSets = [this.all];
    for (const e of candidates) this.add(e);
  }

  /** Index positioned `e` by its door, or by its own node when its cell depends on the seeker. */
  add(e: Entity): void {
    this.revision++;
    const { world, terrain } = this;
    const cell = interactionCellOf(world, this.ctx, terrain, e);
    if (cell !== null) {
      this.doorCell.set(e, cell);
      this.all.addDoor(e, terrain.xOf(cell), terrain.yOf(cell));
    } else {
      const p = world.get(e, Position);
      const node = terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y));
      this.looseNode.set(e, node);
      this.all.addLoose(e, terrain.xOf(node), terrain.yOf(node));
    }
    if (this.sides !== null) this.fileInSide(e);
  }

  /** Drop `e` from the key {@link add} filed it under; a no-op for an entity not indexed. */
  remove(e: Entity): void {
    this.revision++;
    const side = this.sideOf.get(e);
    if (side !== undefined) this.dropFromSide(e, side);
    const { terrain } = this;
    const cell = this.doorCell.get(e);
    if (cell !== undefined) {
      this.doorCell.delete(e);
      this.all.removeDoor(e, terrain.xOf(cell), terrain.yOf(cell));
      return;
    }
    const node = this.looseNode.get(e);
    if (node === undefined) return;
    this.looseNode.delete(e);
    this.all.removeLoose(e, terrain.xOf(node), terrain.yOf(node));
  }

  /** Forget every candidate. */
  clear(): void {
    this.revision++;
    this.all = new CandidateSet();
    this.allSets = [this.all];
    this.doorCell.clear();
    this.looseNode.clear();
    this.sides = null;
    this.sideOf.clear();
  }

  /** Moves on every edit of the candidates or their sides: an equal value means the same candidates on the
   *  same nodes, for a memo over a read of this index. */
  get version(): number {
    return this.revision;
  }

  /** Hand `visit` every door candidate whose door lies in `box`, with that door's node, in no fixed order. */
  forEachDoorIn(box: NodeBox, visit: (e: Entity, x: number, y: number) => void): void {
    this.all.doors.forEachIn(box, visit);
  }

  /** Hand `visit` every loose candidate filed in `box` with its node, in no fixed order. */
  forEachLooseIn(box: NodeBox, visit: (e: Entity, x: number, y: number) => void): void {
    this.gridOfLoose(this.all).forEachIn(box, visit);
  }

  /** Whether the seeker-independent candidate filter admitted anything. */
  hasCandidates(): boolean {
    return this.all.any() !== undefined;
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
    for (const e of this.all.doorList) {
      const cell = this.doorCell.get(e);
      if (cell !== undefined && area(terrain.xOf(cell), terrain.yOf(cell)) && accept(e)) return true;
    }
    for (const e of this.all.looseList) {
      const node = this.looseNode.get(e);
      if (node !== undefined && area(terrain.xOf(node), terrain.yOf(node)) && accept(e)) return true;
    }
    return false;
  }

  /** The candidates on `owner`'s side ({@link sameSideAs}: its own and unowned ones), each as its entity
   *  and filed node in {@link FILED_STRIDE} slots, for a caller that tests many areas against them. Kept
   *  until the candidates or their sides change: the array is the memo itself, read it and never write it. */
  filedOnSide(owner: number): Int32Array {
    const sides = this.syncSides();
    const held = this.sideFiled.get(owner);
    if (held !== undefined && held.revision === this.revision) return held.filed;
    const onSide = sameSideAs(this.world, owner);
    const { terrain } = this;
    filedUsed = 0;
    const visit = (set: CandidateSet): void => {
      const { doorList, looseList } = set;
      for (let i = 0; i < doorList.length; i++) {
        const e = doorList[i] as Entity;
        const cell = this.doorCell.get(e);
        if (cell !== undefined) collectFiled(e, terrain.xOf(cell), terrain.yOf(cell));
      }
      for (let i = 0; i < looseList.length; i++) {
        const e = looseList[i] as Entity;
        const node = this.looseNode.get(e);
        if (node !== undefined) collectFiled(e, terrain.xOf(node), terrain.yOf(node));
      }
    };
    sides.forEach((set) => {
      const member = set.any();
      if (member !== undefined && onSide(member)) visit(set);
    });
    const filed = filedScratch.slice(0, filedUsed);
    this.sideFiled.set(owner, { revision: this.revision, filed });
    return filed;
  }

  /** A mismatch message per candidate `fresh` keys differently or this index files under a stale side, and
   *  per stale side read it would serve, for a cache verifier. `pending` candidates, ones the owner drops on
   *  its next update, are left out of the comparison. */
  divergence(fresh: InteractionCellIndex, pending: ReadonlySet<Entity> = NONE_PENDING): string[] {
    const out: string[] = [];
    const differs = (a: readonly Entity[], b: readonly Entity[]): boolean => {
      const kept = pending.size === 0 ? a : a.filter((e) => !pending.has(e));
      return kept.length !== b.length || kept.some((e, i) => e !== b[i]);
    };
    if (differs(this.all.doorList, fresh.all.doorList)) out.push('door candidates differ');
    if (differs(this.all.looseList, fresh.all.looseList)) out.push('loose candidates differ');
    for (const [e, cell] of fresh.doorCell) {
      if (this.doorCell.get(e) !== cell) out.push(`candidate ${e} is filed at a stale door`);
    }
    for (const [e, node] of fresh.looseNode) {
      if (this.looseNode.get(e) !== node) out.push(`candidate ${e} is filed at a stale node`);
    }
    if (this.sides !== null) {
      this.syncSides();
      for (const list of [this.all.doorList, this.all.looseList]) {
        for (const e of list) {
          if (pending.has(e)) continue;
          const side = this.sides.get(sideKeyOf(this.world, e));
          const listed = side !== undefined && (side.doorList.includes(e) || side.looseList.includes(e));
          if (!listed || this.sideOf.get(e) !== sideKeyOf(this.world, e)) {
            out.push(`candidate ${e} is filed under a stale side`);
          }
        }
      }
    }
    for (const [owner, held] of [...this.sideFiled]) {
      if (held.revision !== this.revision) continue;
      this.sideFiled.delete(owner);
      const reread = this.filedOnSide(owner);
      this.sideFiled.set(owner, held);
      const same = reread.length === held.filed.length && reread.every((v, i) => v === held.filed[i]);
      if (!same) out.push(`side read of owner ${owner} is stale`);
    }
    return out;
  }

  /**
   * The nearest candidate to `here` that `accept` qualifies, by the `(distance, cell-id, entity-id)` order,
   * or null when none does. `accept` must be side-effect-free: which candidates a search asks, and in
   * what order, depends on the index's layout, never the winner.
   */
  nearest<P>(
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    /** Rejects whole interaction cells and bounds the sweep: every gate-passing cell lies in `gate.bounds`. */
    gate?: SpatialGate,
    /** Rejects cells this seeker's own routes just failed on. `here` is exempt; never bounds the sweep. */
    avoid?: (cell: NodeId) => boolean,
    /** Rejects a candidate owned by another player. It must read nothing but the candidate's
     *  {@link Owner}, as {@link sameSideAs} does: a search asks it once per owner side. */
    onSide?: (e: Entity) => boolean,
    /** The ranking origin, a flag centre for a carrier working outward from its flag; `here` stays the
     *  route start the interaction cell, sealing and veto are judged from. */
    rank: NodeId = here,
  ): NearestByCell<P> | null {
    const sets = this.setsOn(onSide);
    // Typed by assertion: reassigned in the loop, so flow narrowing must not pin it to null.
    let door = null as NearestByCell<P> | null;
    for (const set of sets) {
      door = nearerOf(door, this.doorNearest(set, here, rank, accept, gate, avoid, door?.distance));
    }
    let best = door;
    for (const set of sets) {
      best = nearerOf(best, this.looseNearest(set, here, rank, accept, gate, avoid, best?.distance));
    }
    return best;
  }

  /** The {@link nearest} winner when every candidate it could pick is in `field`, ascending-id candidates
   *  of this index: one exact scan, for a caller that already narrowed the field to a few. */
  nearestAmong<P>(
    field: readonly Entity[],
    /** The leading entries of `field` that form it. */
    count: number,
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate?: SpatialGate,
    avoid?: (cell: NodeId) => boolean,
  ): NearestByCell<P> | null {
    return this.linearNearest(field, here, accept, gate, avoid, here, Number.POSITIVE_INFINITY, count);
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
    let best = null as NearestByCell<P> | null;
    for (const set of this.setsOn(onSide)) {
      best = nearerOf(best, this.doorNearest(set, here, here, accept, gate, avoid, best?.distance));
    }
    return best;
  }

  /** The {@link nearest} winner among the candidates without a door: the building-less ones. */
  nearestLoose<P>(
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate?: SpatialGate,
    avoid?: (cell: NodeId) => boolean,
    onSide?: (e: Entity) => boolean,
  ): NearestByCell<P> | null {
    // Typed by assertion: reassigned in the loop, so flow narrowing must not pin it to null.
    let best = null as NearestByCell<P> | null;
    for (const set of this.setsOn(onSide)) {
      best = nearerOf(best, this.looseNearest(set, here, here, accept, gate, avoid, best?.distance));
    }
    return best;
  }

  /** The candidate sets a query filtered by `onSide` searches: every candidate when it admits every side,
   *  else the sides it admits. */
  private setsOn(onSide: ((e: Entity) => boolean) | undefined): readonly CandidateSet[] {
    if (onSide === undefined) return this.allSets;
    const sides = this.syncSides();
    const admitted: CandidateSet[] = [];
    sides.forEach((set) => {
      const member = set.any();
      if (member !== undefined && onSide(member)) admitted.push(set);
    });
    return admitted.length === sides.size ? this.allSets : admitted;
  }

  /** {@link sides}, split on first use and caught up to the Owner writes since. */
  private syncSides(): Map<number, CandidateSet> {
    const { world } = this;
    const membership = world.componentGeneration(Owner);
    const values = world.componentValueGeneration(Owner);
    if (this.sides !== null && membership === this.ownerMembership && values === this.ownerValues) {
      return this.sides;
    }
    let sides = this.sides;
    const replayed =
      sides !== null &&
      world.replayMembershipSince(Owner, this.ownerMembership, this.refileSide) &&
      world.replayValueWritesSince(Owner, this.ownerValues, this.refileSide);
    if (sides === null || !replayed) {
      world.journalMembership(Owner);
      world.journalValueWrites(Owner);
      sides = new Map();
      this.sides = sides;
      this.revision++;
      this.sideOf.clear();
      for (const e of this.all.doorList) this.fileInSide(e);
      for (const e of this.all.looseList) this.fileInSide(e);
    }
    this.ownerMembership = membership;
    this.ownerValues = values;
    return sides;
  }

  /** File indexed `e` under its owner's side. */
  private fileInSide(e: Entity): void {
    const sides = this.sides;
    if (sides === null) return;
    const key = sideKeyOf(this.world, e);
    let set = sides.get(key);
    if (set === undefined) {
      set = new CandidateSet();
      sides.set(key, set);
    }
    this.sideOf.set(e, key);
    const { terrain } = this;
    const cell = this.doorCell.get(e);
    if (cell !== undefined) {
      set.addDoor(e, terrain.xOf(cell), terrain.yOf(cell));
      return;
    }
    const node = this.looseNode.get(e);
    if (node !== undefined) set.addLoose(e, terrain.xOf(node), terrain.yOf(node));
  }

  /** Drop `e` from side `key`, forgetting the side once empty. */
  private dropFromSide(e: Entity, key: number): void {
    this.sideOf.delete(e);
    const set = this.sides?.get(key);
    if (set === undefined) return;
    const { terrain } = this;
    const cell = this.doorCell.get(e);
    if (cell !== undefined) set.removeDoor(e, terrain.xOf(cell), terrain.yOf(cell));
    else {
      const node = this.looseNode.get(e);
      if (node !== undefined) set.removeLoose(e, terrain.xOf(node), terrain.yOf(node));
    }
    if (set.any() === undefined) this.sides?.delete(key);
  }

  /** The nearest door-bucketed candidate of `set` that could beat `bound`, a distance some other winner
   *  already holds, or null. */
  private doorNearest<P>(
    set: CandidateSet,
    here: NodeId,
    rank: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate: SpatialGate | undefined,
    avoid: ((cell: NodeId) => boolean) | undefined,
    bound = Number.POSITIVE_INFINITY,
  ): NearestByCell<P> | null {
    if (set.doors.size <= RING_MIN_BUCKETS) {
      return this.linearNearest(set.doorList, here, accept, gate, avoid, rank, bound);
    }
    const hx = this.terrain.xOf(rank);
    const hy = this.terrain.yOf(rank);
    let reach = set.doors.reach(hx, hy);
    if (gate !== undefined) reach = Math.min(reach, boundsReach(gate, hx, hy));
    const maxRadius = Math.min(NEAREST_RING_MAX_RADIUS, reach);
    const best = this.ringNearest(set.doors, here, rank, maxRadius, accept, gate, avoid, bound);
    // An exhaustive sweep proves a null; otherwise the ring cap stopped short and the blocks past it decide,
    // unless `bound` already beats every node past the cap.
    if (best !== null || reach <= NEAREST_RING_MAX_RADIUS || bound <= maxRadius) return best;
    let far: NearestByCell<P> | null = null;
    set.doors.farFirst(hx, hy, maxRadius, reach, 0, gate?.bounds, bound, (x, y, d, bucket) => {
      far = this.pickInRing(x, y, d, bucket, here, accept, gate, avoid, far);
      return Math.min(bound, far?.distance ?? bound);
    });
    return far;
  }

  /** The nearest door-bucketed candidate within Manhattan `maxRadius` of `rank`, or null, by the
   *  `(distance, cell-id, entity-id)` order. */
  private ringNearest<P>(
    doors: CellGrid,
    here: NodeId,
    rank: NodeId,
    maxRadius: number,
    accept: (e: Entity) => Qualified<P> | null,
    gate: SpatialGate | undefined,
    avoid: ((cell: NodeId) => boolean) | undefined,
    bound: number,
  ): NearestByCell<P> | null {
    let best: NearestByCell<P> | null = null;
    doors.nearestFirst(this.terrain.xOf(rank), this.terrain.yOf(rank), maxRadius, 0, (x, y, d, bucket) => {
      if (d <= bound) best = this.pickInRing(x, y, d, bucket, here, accept, gate, avoid, best);
      return Math.min(bound, best?.distance ?? bound);
    });
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
      const hit = accept(e);
      if (hit !== null) return { entity: e, cell, distance, payload: hit.payload };
    }
    return best;
  }

  /**
   * The nearest loose candidate that could beat `bound`, a distance some other winner already holds, or
   * null. A node `d` from `rank` holds candidates at least `d - slack` from it, so the sweep ends once
   * that exceeds the best exact distance; a cap short of that hands the farther nodes to the block search.
   */
  private looseNearest<P>(
    set: CandidateSet,
    here: NodeId,
    rank: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate: SpatialGate | undefined,
    avoid: ((cell: NodeId) => boolean) | undefined,
    bound = Number.POSITIVE_INFINITY,
  ): NearestByCell<P> | null {
    if (set.looseList.length <= RING_MIN_BUCKETS) {
      return this.linearNearest(set.looseList, here, accept, gate, avoid, rank, bound);
    }
    const { terrain, slack } = this;
    const grid = this.gridOfLoose(set);
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
        if (e !== undefined) best = this.weighLoose(e, here, rank, accept, gate, avoid, best);
      }
      return Math.min(bound, best?.distance ?? bound);
    });
    // Past the cap only nodes farther than `maxRadius` remain, and none can beat a bound short of it.
    if (reach <= NEAREST_RING_MAX_RADIUS || Math.min(bound, best?.distance ?? bound) + slack < maxRadius)
      return best;
    const box = gate?.bounds;
    grid.farFirst(
      hx,
      hy,
      maxRadius,
      reach,
      slack,
      box,
      Math.min(bound, best?.distance ?? bound),
      (x, y, _d, bucket) => {
        // No gate-passing cell lies within slack of a node off the gate's box.
        if (box === undefined || nearBox(box, x, y, slack)) {
          for (let j = 0; j < bucket.length; j++) {
            const e = bucket[j];
            if (e !== undefined) best = this.weighLoose(e, here, rank, accept, gate, avoid, best);
          }
        }
        return Math.min(bound, best?.distance ?? bound);
      },
    );
    return best;
  }

  private gridOfLoose(set: CandidateSet): CellGrid {
    if (set.looseGrid === null) {
      const { terrain } = this;
      const grid = new CellGrid();
      const list = set.looseList;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const node = e === undefined ? undefined : this.looseNode.get(e);
        if (e !== undefined && node !== undefined) grid.add(e, terrain.xOf(node), terrain.yOf(node));
      }
      set.looseGrid = grid;
    }
    return set.looseGrid;
  }

  /** `best`, or loose candidate `e` when it qualifies and precedes `best` in the total order. */
  private weighLoose<P>(
    e: Entity,
    here: NodeId,
    rank: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate: SpatialGate | undefined,
    avoid: ((cell: NodeId) => boolean) | undefined,
    best: NearestByCell<P> | null,
  ): NearestByCell<P> | null {
    if (best !== null && this.looseFloor(e, rank) > best.distance) return best;
    if (this.gatedOutLoose(gate, e)) return best;
    const hit = accept(e);
    if (hit === null) return best;
    const cell = interactionCell(this.world, this.ctx, this.terrain, e, here);
    const distance = manhattan(this.terrain, rank, cell);
    if (best !== null && !precedes(distance, cell, e, best)) return best;
    if (gate !== undefined && !gate.allowsNode(cell)) return best;
    if (vetoed(avoid, here, cell)) return best;
    if (this.pileCellSealed(e, here, cell)) return best;
    return { entity: e, cell, distance, payload: hit.payload };
  }

  /** The least distance from `rank` loose candidate `e`'s interaction cell can lie at: its own node's,
   *  less {@link slack}. */
  private looseFloor(e: Entity, rank: NodeId): number {
    const node = this.looseNode.get(e);
    return node === undefined ? 0 : manhattan(this.terrain, rank, node) - this.slack;
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

  /** The exact linear scan the rings accelerate, for a short list: {@link nearestByCell}'s loop and
   *  tie-break, resolving each candidate's cell in place, over the candidates that could beat `bound`.
   *  The filters are pure, so a candidate the best so far already beats skips them, the gate's cheap
   *  node test runs before `accept`, which may be a whole task check, and its costly cell test last. */
  private linearNearest<P>(
    list: readonly Entity[],
    here: NodeId,
    accept: (e: Entity) => Qualified<P> | null,
    gate: SpatialGate | undefined,
    avoid: ((cell: NodeId) => boolean) | undefined,
    rank: NodeId,
    bound: number,
    count = list.length,
  ): NearestByCell<P> | null {
    const { world, ctx, terrain } = this;
    let bestEntity: Entity | undefined;
    let bestHit: Qualified<P> | null = null;
    let bestNode: NodeId | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestCell = Number.POSITIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      const e = list[i];
      if (e === undefined) continue;
      const door = this.doorCell.get(e);
      let hit: Qualified<P> | null;
      let cell: NodeId;
      let distance: number;
      if (door !== undefined) {
        cell = door;
        distance = manhattan(terrain, rank, cell);
        if (distance > bound || !closer(distance, cell, bestDist, bestCell)) continue;
        hit = accept(e);
        if (hit === null) continue;
      } else {
        if (this.looseFloor(e, rank) > Math.min(bound, bestDist) || this.gatedOutLoose(gate, e)) continue;
        hit = accept(e);
        if (hit === null) continue;
        cell = interactionCell(world, ctx, terrain, e, here);
        distance = manhattan(terrain, rank, cell);
        if (distance > bound || !closer(distance, cell, bestDist, bestCell)) continue;
      }
      if (gate !== undefined && !gate.allowsNode(cell)) continue;
      if (vetoed(avoid, here, cell)) continue;
      if (door === undefined && this.pileCellSealed(e, here, cell)) continue;
      bestEntity = e;
      bestHit = hit;
      bestNode = cell;
      bestDist = distance;
      bestCell = cell;
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
export function nearBox(box: NodeBox, x: number, y: number, slack: number): boolean {
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
export function precedes<P>(distance: number, cell: NodeId, entity: Entity, best: NearestByCell<P>): boolean {
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
