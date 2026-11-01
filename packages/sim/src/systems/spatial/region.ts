import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import { createSpatialMemo } from './memo.js';

/**
 * The per-world region spatial index behind the standing-entity indexes, so a radius-bounded scan reads
 * only the entities near a point. Maintained incrementally against the indexed component's store
 * generation, which holds because a standing entity never moves or loses its Position without dying.
 * `near` answers are provable supersets that the caller's own canonical filter and rank loop re-checks,
 * so no winner can differ from a full scan.
 */

/** Region edge in half-cell nodes. Approximation: sized so a flag or forage radius touches a handful of
 *  regions while region lists stay long enough for the merge cost to vanish. Only query cost depends on
 *  it, never a winner. */
const REGION_NODES = 32;
/** Region key packing (`rx * STRIDE + ry`): up to 65k regions per axis with a plain-number key. */
const REGION_KEY_STRIDE = 1 << 16;
/** Node key packing (`hx * STRIDE + hy`). It is also each member's ledger record, a small integer, so the
 *  ledger holds no object per member. */
const NODE_KEY_STRIDE = 1 << 16;

/** Field offsets of one member in a bucket's interleaved Int32 records. */
const ID = 0;
const HX = 1;
const HY = 2;
const CAPTURE = 3;
const PART = 4;
/** A region bucket holds every field; a partition bucket only what the nearest fold reads. */
const REGION_FIELDS = 5;
const PARTITION_FIELDS = 3;
/** Members a new bucket has room for; it doubles when full and halves when a quarter full. */
const INITIAL_BUCKET_MEMBERS = 4;
/** A bucket shrinks once it fills no more than this share of its capacity. */
const SHRINK_DIVISOR = 4;

/** One bucket's members as interleaved Int32 records, ascending id. */
class MemberBucket {
  records: Int32Array;
  size = 0;

  constructor(readonly fields: number) {
    this.records = new Int32Array(INITIAL_BUCKET_MEMBERS * fields);
  }

  /** The first slot whose id is at least `e`. */
  slotOf(e: number): number {
    const { records, fields } = this;
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((records[mid * fields] ?? 0) < e) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** The slot holding `e`, or -1. */
  find(e: number): number {
    const slot = this.slotOf(e);
    return slot < this.size && this.records[slot * this.fields] === e ? slot : -1;
  }

  insert(e: number, hx: number, hy: number, capture: number, part: number): void {
    const { fields, size } = this;
    if ((size + 1) * fields > this.records.length) this.resize(this.records.length * 2);
    const records = this.records;
    // Ids are monotonic, so an insert is usually an append.
    const slot = size === 0 || (records[(size - 1) * fields] ?? 0) < e ? size : this.slotOf(e);
    const at = slot * fields;
    if (slot < size) records.copyWithin(at + fields, at, size * fields);
    records[at + ID] = e;
    records[at + HX] = hx;
    records[at + HY] = hy;
    if (fields > CAPTURE) {
      records[at + CAPTURE] = capture;
      records[at + PART] = part;
    }
    this.size = size + 1;
  }

  removeAt(slot: number): void {
    const { fields } = this;
    const size = this.size - 1;
    this.records.copyWithin(slot * fields, (slot + 1) * fields, (size + 1) * fields);
    this.size = size;
    const capacity = this.records.length / fields;
    if (capacity > INITIAL_BUCKET_MEMBERS && size * SHRINK_DIVISOR <= capacity) {
      this.resize(this.records.length / 2);
    }
  }

  private resize(length: number): void {
    const grown = new Int32Array(length);
    grown.set(this.records.subarray(0, this.size * this.fields));
    this.records = grown;
  }
}

/** An unoccupied node's answer, shared since every caller only reads it. */
const NO_ENTITIES: readonly Entity[] = [];

/** Buckets by region key. */
type RegionBuckets = Map<number, MemberBucket>;

/** Node key to the members anchored there: a lone member as its id, so the common single occupant costs
 *  no array; two or more as an ascending-id array. */
type NodeLayer = Map<number, Entity | Entity[]>;

interface RegionState<Extra> {
  byRegion: RegionBuckets;
  /** The same members split by their partition key, for a partitioned index; null otherwise. */
  byPart: Map<number, RegionBuckets> | null;
  /** The same members by node, minted by the first {@link RegionIndex.atNode} caller and maintained from
   *  then on. */
  byNode: NodeLayer | null;
  /** The one-element answer {@link RegionIndex.atNode} reuses for a lone occupant, so the common node read
   *  allocates nothing. */
  lone: Entity[];
  /** Ascending-id canonical membership, the mutable master copy behind {@link RegionIndex.canonical}. */
  list: Entity[];
  /** The shared copy handed to consumers, dropped on every change, so a consumer holding one keeps a
   *  snapshot. */
  shared: readonly Entity[] | null;
  extra: Extra;
}

/** Diagnostic labels for the cache verifier and its divergence messages. `verifier` must be the unique
 *  {@link World.registerCacheVerifier} id. */
export interface RegionIndexLabels {
  readonly verifier: string;
  readonly plural: string;
  readonly component: string;
  readonly singular: string;
}

/**
 * The per-index derived extra, maintained incrementally beside the membership. `capture` runs at insert
 * and must record everything `remove` needs, because the entity may be destroyed by the time its removal
 * replays. It must return an int32, stored beside the member.
 */
export interface RegionExtraOps<Extra> {
  empty(): Extra;
  capture(world: World, e: Entity): number;
  insert(extra: Extra, c: number): void;
  remove(extra: Extra, c: number): void;
  diverges(held: Extra, fresh: Extra): boolean;
}

/** The no-derived-extra ops for indexes that only need membership. */
export const NO_REGION_EXTRA: RegionExtraOps<undefined> = {
  empty: () => undefined,
  capture: () => 0,
  insert: () => {},
  remove: () => {},
  diverges: () => false,
};

/** The best member of a {@link PartitionedRegionIndex.nearestOf} fold and its Manhattan node distance. */
export interface RegionNearest {
  readonly entity: Entity;
  readonly distance: number;
}

/** A memoized region index over `(component, Position)` entities. */
export interface RegionIndex<Extra> {
  /** The memoized ascending-id list of every indexed entity, shared. */
  canonical(world: World): readonly Entity[];
  /** Every indexed entity whose anchor node lies within the axis-aligned box `reach` nodes around
   *  `(hx, hy)`, ascending-id. A candidate superset, valid only when `reach` covers the caller's radius
   *  plus the largest anchor-to-interaction-cell offset. `keep` drops a member by its capture before the
   *  sort, so it must reject only members the caller's own filter would reject too. `skipReach` leaves
   *  out the inner box a caller already searched, so an expanding search reads each member once. */
  near(
    world: World,
    hx: number,
    hy: number,
    reach: number,
    keep?: (capture: number) => boolean,
    skipReach?: number,
  ): Entity[];
  /** The members {@link near} lists, handed to `visit` with their anchor node in no particular order,
   *  for a caller that ranks them itself. */
  visitNear(
    world: World,
    hx: number,
    hy: number,
    reach: number,
    visit: (e: Entity, hx: number, hy: number) => void,
    keep?: (capture: number) => boolean,
    skipReach?: number,
  ): void;
  /** Whether any indexed entity inside the same box passes `test`. Unordered and first-hit, which a pure
   *  existence question does not need. `keep` skips a member by its capture before `test` reads it. */
  someNear(
    world: World,
    hx: number,
    hy: number,
    reach: number,
    test: (e: Entity) => boolean,
    keep?: (capture: number) => boolean,
  ): boolean;
  /** Whether the box `reach` nodes around `(hx, hy)` holds every indexed entity, so a miss inside it is
   *  a miss everywhere. Judged by whole regions, so a false answer proves nothing. */
  boxHoldsAll(world: World, hx: number, hy: number, reach: number): boolean;
  /** Every indexed entity whose anchor node is exactly `(hx, hy)`, ascending-id. Not a copy: two or more
   *  are the index's live bucket and a lone one is a scratch array the next call overwrites, so a caller
   *  that destroys members or holds the answer across another call must copy it first. */
  atNode(world: World, hx: number, hy: number): readonly Entity[];
  /** The per-index derived extra, maintained incrementally beside the membership. */
  extra(world: World): Extra;
}

/** A region index whose members also sit in per-key buckets, so a search for one key reads only its own
 *  members. The key is read at insert, so a change to it must re-add the component. */
export interface PartitionedRegionIndex<Extra> extends RegionIndex<Extra> {
  /** The `accept`ed member of partition `part` with the least `(Manhattan node distance, entity id)`
   *  inside the box `reach` nodes around `(hx, hy)` and past the inner box `skipReach`, or null. An
   *  unbounded `reach` folds the whole partition. `accept` runs only on a member that would win, so it
   *  must be a pure filter. */
  nearestOf(
    world: World,
    part: number,
    hx: number,
    hy: number,
    reach: number | undefined,
    skipReach: number | undefined,
    accept: (e: Entity) => boolean,
  ): RegionNearest | null;
  /** {@link RegionIndex.boxHoldsAll} for the members of partition `part` alone. */
  partitionBoxHoldsAll(world: World, part: number, hx: number, hy: number, reach: number): boolean;
  /** Whether any member of partition `part` passes `test`. Unordered and first-hit. */
  somePartition(world: World, part: number, test: (e: Entity) => boolean): boolean;
  /** The lowest-id member of partition `part` anchored exactly on `(hx, hy)`, or null. */
  firstOfPartitionAt(world: World, part: number, hx: number, hy: number): Entity | null;
}

/** Pack a region coordinate pair into a map key. Both axes are non-negative because an anchor is an
 *  in-bounds node, which keeps the packing collision-free and lets a box scan clamp its min bounds to 0. */
function regionKey(rx: number, ry: number): number {
  return rx * REGION_KEY_STRIDE + ry;
}

function regionKeyOf(hx: number, hy: number): number {
  return regionKey(Math.floor(hx / REGION_NODES), Math.floor(hy / REGION_NODES));
}

/** An in-bounds anchor as one key, decoded by {@link nodeHxOf} and {@link nodeHyOf}. */
function nodeKeyOf(hx: number, hy: number): number {
  return hx * NODE_KEY_STRIDE + hy;
}

function nodeHxOf(key: number): number {
  return Math.floor(key / NODE_KEY_STRIDE);
}

function nodeHyOf(key: number): number {
  return key % NODE_KEY_STRIDE;
}

/** The inclusive region range covering the box `reach` nodes around `(hx, hy)`. */
function boxRegionRange(
  hx: number,
  hy: number,
  reach: number,
): { readonly minRx: number; readonly maxRx: number; readonly minRy: number; readonly maxRy: number } {
  return {
    minRx: Math.floor(Math.max(0, hx - reach) / REGION_NODES),
    maxRx: Math.floor((hx + reach) / REGION_NODES),
    minRy: Math.floor(Math.max(0, hy - reach) / REGION_NODES),
    maxRy: Math.floor((hy + reach) / REGION_NODES),
  };
}

/** Whether every node of region `(rx, ry)` lies inside the box `reach` nodes around `(hx, hy)`. */
function regionInBox(rx: number, ry: number, hx: number, hy: number, reach: number): boolean {
  const minHx = rx * REGION_NODES;
  const minHy = ry * REGION_NODES;
  return (
    minHx >= hx - reach &&
    minHx + REGION_NODES - 1 <= hx + reach &&
    minHy >= hy - reach &&
    minHy + REGION_NODES - 1 <= hy + reach
  );
}

function inBox(mx: number, my: number, hx: number, hy: number, reach: number): boolean {
  return Math.abs(mx - hx) <= reach && Math.abs(my - hy) <= reach;
}

function nodeLayerInsert(layer: NodeLayer, e: Entity, key: number): void {
  const held = layer.get(key);
  if (held === undefined) layer.set(key, e);
  else if (typeof held === 'number') layer.set(key, held < e ? [held, e] : [e, held]);
  else insertSortedById(held, e, (id) => id);
}

function nodeLayerRemove(layer: NodeLayer, e: Entity, key: number): void {
  const held = layer.get(key);
  if (held === undefined) return;
  if (typeof held === 'number') {
    if (held === e) layer.delete(key);
    return;
  }
  removeSortedById(held, e, (id) => id);
  const lone = held[0];
  if (held.length === 1 && lone !== undefined) layer.set(key, lone);
}

/** The node layer's held-versus-fresh verifier leg. The layer rides its own insert and remove calls
 *  beside `byRegion`, so a missed one is invisible to the region walk and would surface only as a wrong
 *  occupancy answer. Compared element-wise, so it still holds once an `atNode` caller picks a winner. */
function nodeLayerDivergence(verifier: string, held: NodeLayer, fresh: RegionBuckets): string[] {
  const expected = new Map<number, Entity[]>();
  // A node belongs to exactly one region and every region bucket is ascending-id, so appending here
  // reproduces the ascending order the layer keeps.
  for (const bucket of fresh.values()) {
    const { records, fields } = bucket;
    for (let at = 0; at < bucket.size * fields; at += fields) {
      const key = nodeKeyOf(records[at + HX] ?? 0, records[at + HY] ?? 0);
      const e = (records[at + ID] ?? 0) as Entity;
      const list = expected.get(key);
      if (list === undefined) expected.set(key, [e]);
      else list.push(e);
    }
  }
  for (const [key, entry] of held) {
    const entities = typeof entry === 'number' ? [entry] : entry;
    const want = expected.get(key);
    const where = `(${nodeHxOf(key)},${nodeHyOf(key)})`;
    if (want === undefined || want.length !== entities.length) {
      return [`${verifier} node layer diverges at ${where} - a removal missed`];
    }
    if (want.some((e, i) => entities[i] !== e)) return [`${verifier} node layer is out of order at ${where}`];
    expected.delete(key);
  }
  if (expected.size > 0) {
    return [`${verifier} node layer is missing ${expected.size} node(s) - an insert missed`];
  }
  return [];
}

/** Whether two bucket maps hold the same keys and the same records, element-wise. */
function bucketsDiverge(held: RegionBuckets, fresh: RegionBuckets): number | null {
  if (held.size !== fresh.size) return -1;
  for (const [key, bucket] of fresh) {
    const heldBucket = held.get(key);
    if (heldBucket === undefined || heldBucket.size !== bucket.size) return key;
    const length = bucket.size * bucket.fields;
    for (let i = 0; i < length; i++) if (heldBucket.records[i] !== bucket.records[i]) return key;
  }
  return null;
}

/** Whether a partition's held buckets match a fresh rebuild's, region for region and element-wise. */
function partitionsDiverge(
  held: ReadonlyMap<number, RegionBuckets>,
  fresh: ReadonlyMap<number, RegionBuckets>,
): boolean {
  if (held.size !== fresh.size) return true;
  for (const [part, freshRegions] of fresh) {
    const heldRegions = held.get(part);
    if (heldRegions === undefined || bucketsDiverge(heldRegions, freshRegions) !== null) return true;
  }
  return false;
}

function insertIntoBuckets(
  buckets: RegionBuckets,
  fields: number,
  e: Entity,
  hx: number,
  hy: number,
  capture: number,
  part: number,
): void {
  const key = regionKeyOf(hx, hy);
  let bucket = buckets.get(key);
  if (bucket === undefined) {
    bucket = new MemberBucket(fields);
    buckets.set(key, bucket);
  }
  bucket.insert(e, hx, hy, capture, part);
}

function removeFromBuckets(buckets: RegionBuckets, e: Entity, hx: number, hy: number): void {
  const key = regionKeyOf(hx, hy);
  const bucket = buckets.get(key);
  if (bucket === undefined) return;
  const slot = bucket.find(e);
  if (slot === -1) return;
  bucket.removeAt(slot);
  if (bucket.size === 0) buckets.delete(key);
}

/** Whether every region holding a member of `buckets` lies inside the box `reach` nodes around `(hx, hy)`. */
function bucketsInBox(buckets: RegionBuckets, hx: number, hy: number, reach: number): boolean {
  for (const key of buckets.keys()) {
    if (!regionInBox(Math.floor(key / REGION_KEY_STRIDE), key % REGION_KEY_STRIDE, hx, hy, reach)) {
      return false;
    }
  }
  return true;
}

/** Hand `visit` every member of region `buckets` whose anchor lies in the box `reach` nodes around
 *  `(hx, hy)` and past the inner box `skipReach`, and whose capture `keep` admits. A box wider than the
 *  occupied regions walks those regions instead of probing every region it spans. */
function visitBox(
  buckets: RegionBuckets,
  hx: number,
  hy: number,
  reach: number,
  visit: (e: Entity, hx: number, hy: number) => void,
  keep: ((capture: number) => boolean) | undefined,
  skipReach: number | undefined,
): void {
  const { minRx, maxRx, minRy, maxRy } = boxRegionRange(hx, hy, reach);
  const visitBucket = (bucket: MemberBucket): void => {
    const { records, fields } = bucket;
    const end = bucket.size * fields;
    for (let at = 0; at < end; at += fields) {
      const mx = records[at + HX] ?? 0;
      const my = records[at + HY] ?? 0;
      if (!inBox(mx, my, hx, hy, reach)) continue;
      if (keep !== undefined && !keep(records[at + CAPTURE] ?? 0)) continue;
      if (skipReach === undefined || !inBox(mx, my, hx, hy, skipReach)) {
        visit((records[at + ID] ?? 0) as Entity, mx, my);
      }
    }
  };
  if ((maxRx - minRx + 1) * (maxRy - minRy + 1) > buckets.size) {
    buckets.forEach((bucket, key) => {
      const rx = Math.floor(key / REGION_KEY_STRIDE);
      const ry = key % REGION_KEY_STRIDE;
      if (rx < minRx || rx > maxRx || ry < minRy || ry > maxRy) return;
      if (skipReach !== undefined && regionInBox(rx, ry, hx, hy, skipReach)) return;
      visitBucket(bucket);
    });
    return;
  }
  for (let rx = minRx; rx <= maxRx; rx++) {
    for (let ry = minRy; ry <= maxRy; ry++) {
      if (skipReach !== undefined && regionInBox(rx, ry, hx, hy, skipReach)) continue;
      const bucket = buckets.get(regionKey(rx, ry));
      if (bucket !== undefined) visitBucket(bucket);
    }
  }
}

interface NearestFold {
  best: Entity | null;
  distance: number;
}

/** Fold `bucket` into `acc` by `(Manhattan distance, id)`, testing `accept` only on a member that wins. */
function foldNearest(
  bucket: MemberBucket,
  hx: number,
  hy: number,
  reach: number | undefined,
  skipReach: number | undefined,
  accept: (e: Entity) => boolean,
  acc: NearestFold,
): void {
  const { records, fields } = bucket;
  const end = bucket.size * fields;
  for (let at = 0; at < end; at += fields) {
    const mx = records[at + HX] ?? 0;
    const my = records[at + HY] ?? 0;
    if (reach !== undefined && !inBox(mx, my, hx, hy, reach)) continue;
    if (skipReach !== undefined && inBox(mx, my, hx, hy, skipReach)) continue;
    const distance = Math.abs(mx - hx) + Math.abs(my - hy);
    if (distance > acc.distance) continue;
    const e = (records[at + ID] ?? 0) as Entity;
    if (distance === acc.distance && acc.best !== null && e > acc.best) continue;
    if (!accept(e)) continue;
    acc.best = e;
    acc.distance = distance;
  }
}

/**
 * Build a memoized region index over the entities carrying `component` and a Position, maintained
 * incrementally against that component's store generation.
 */
export function createRegionIndex<Extra>(
  component: Component<unknown>,
  labels: RegionIndexLabels,
  extraOps: RegionExtraOps<Extra>,
): RegionIndex<Extra> {
  return buildRegionIndex(component, labels, extraOps, null);
}

/** {@link createRegionIndex} with members also bucketed by `partitionOf`, read at insert. */
export function createPartitionedRegionIndex<Extra>(
  component: Component<unknown>,
  labels: RegionIndexLabels,
  extraOps: RegionExtraOps<Extra>,
  partitionOf: (world: World, e: Entity) => number,
): PartitionedRegionIndex<Extra> {
  return buildRegionIndex(component, labels, extraOps, partitionOf);
}

function buildRegionIndex<Extra>(
  component: Component<unknown>,
  labels: RegionIndexLabels,
  extraOps: RegionExtraOps<Extra>,
  partitionOf: ((world: World, e: Entity) => number) | null,
): PartitionedRegionIndex<Extra> {
  // The ledger record is the anchor's node key; the capture and partition live in the region bucket.
  const memo = createSpatialMemo<RegionState<Extra>, number>(component, labels, {
    empty: () => ({
      byRegion: new Map(),
      byPart: partitionOf === null ? null : new Map(),
      byNode: null,
      lone: [],
      list: [],
      shared: null,
      extra: extraOps.empty(),
    }),
    member: (_world, _e, hx, hy) => nodeKeyOf(hx, hy),
    insert: (state, e, key, world) => {
      const hx = nodeHxOf(key);
      const hy = nodeHyOf(key);
      const capture = extraOps.capture(world, e);
      const part = partitionOf === null ? 0 : partitionOf(world, e);
      state.shared = null;
      insertSortedById(state.list, e, (id) => id);
      insertIntoBuckets(state.byRegion, REGION_FIELDS, e, hx, hy, capture, part);
      if (state.byPart !== null) {
        let regions = state.byPart.get(part);
        if (regions === undefined) {
          regions = new Map();
          state.byPart.set(part, regions);
        }
        insertIntoBuckets(regions, PARTITION_FIELDS, e, hx, hy, capture, part);
      }
      if (state.byNode !== null) nodeLayerInsert(state.byNode, e, key);
      extraOps.insert(state.extra, capture);
    },
    remove: (state, e, key) => {
      const hx = nodeHxOf(key);
      const hy = nodeHyOf(key);
      const regionKeyOfMember = regionKeyOf(hx, hy);
      const bucket = state.byRegion.get(regionKeyOfMember);
      const slot = bucket === undefined ? -1 : bucket.find(e);
      if (bucket === undefined || slot === -1) return;
      const at = slot * REGION_FIELDS;
      const capture = bucket.records[at + CAPTURE] ?? 0;
      const part = bucket.records[at + PART] ?? 0;
      bucket.removeAt(slot);
      if (bucket.size === 0) state.byRegion.delete(regionKeyOfMember);
      state.shared = null;
      removeSortedById(state.list, e, (id) => id);
      const regions = state.byPart?.get(part);
      if (regions !== undefined) {
        removeFromBuckets(regions, e, hx, hy);
        if (regions.size === 0) state.byPart?.delete(part);
      }
      if (state.byNode !== null) nodeLayerRemove(state.byNode, e, key);
      extraOps.remove(state.extra, capture);
    },
    diverges: (held, fresh) => {
      if (held.list.length !== fresh.list.length || fresh.list.some((e, i) => held.list[i] !== e)) {
        return [
          `${labels.verifier} canonical list diverges from a fresh rebuild - an incremental splice missed`,
        ];
      }
      if (
        held.shared !== null &&
        (held.shared.length !== held.list.length || held.shared.some((e, i) => held.list[i] !== e))
      ) {
        return [`${labels.verifier} shared canonical list was edited by a reader`];
      }
      const region = bucketsDiverge(held.byRegion, fresh.byRegion);
      if (region !== null) {
        return [
          `${labels.verifier} region ${region} diverges from a fresh rebuild - a ${labels.singular} moved or changed in place`,
        ];
      }
      if (held.byPart !== null && fresh.byPart !== null && partitionsDiverge(held.byPart, fresh.byPart)) {
        return [
          `${labels.verifier} partition buckets diverge from a fresh rebuild - a ${labels.singular}'s partition key changed in place`,
        ];
      }
      if (held.byNode !== null) {
        const missed = nodeLayerDivergence(labels.verifier, held.byNode, fresh.byRegion);
        if (missed.length > 0) return missed;
      }
      if (extraOps.diverges(held.extra, fresh.extra)) {
        return [
          `${labels.verifier} derived extra diverges from a fresh rebuild - an incremental extra update missed`,
        ];
      }
      return [];
    },
  });

  const nodeLayer = (state: RegionState<Extra>): NodeLayer => {
    if (state.byNode === null) {
      const layer: NodeLayer = new Map();
      for (const bucket of state.byRegion.values()) {
        const { records, fields } = bucket;
        for (let at = 0; at < bucket.size * fields; at += fields) {
          const key = nodeKeyOf(records[at + HX] ?? 0, records[at + HY] ?? 0);
          nodeLayerInsert(layer, (records[at + ID] ?? 0) as Entity, key);
        }
      }
      state.byNode = layer;
    }
    return state.byNode;
  };

  return {
    canonical: (world) => {
      const state = memo.read(world);
      state.shared ??= state.list.slice();
      return state.shared;
    },
    extra: (world) => memo.read(world).extra,
    near: (world, hx, hy, reach, keep, skipReach) => {
      const out: Entity[] = [];
      visitBox(memo.read(world).byRegion, hx, hy, reach, (e) => out.push(e), keep, skipReach);
      // Each region list is ascending, but concatenating across regions is not, and a nearest-scan's
      // first-wins tie-break depends on the canonical ascending-id order.
      out.sort((a, b) => a - b);
      return out;
    },
    visitNear: (world, hx, hy, reach, visit, keep, skipReach) =>
      visitBox(memo.read(world).byRegion, hx, hy, reach, visit, keep, skipReach),
    boxHoldsAll: (world, hx, hy, reach) => bucketsInBox(memo.read(world).byRegion, hx, hy, reach),
    atNode: (world, hx, hy) => {
      const state = memo.read(world);
      const held = nodeLayer(state).get(nodeKeyOf(hx, hy));
      if (held === undefined) return NO_ENTITIES;
      if (typeof held !== 'number') return held;
      state.lone[0] = held;
      return state.lone;
    },
    someNear: (world, hx, hy, reach, test, keep) => {
      const index = memo.read(world);
      const { minRx, maxRx, minRy, maxRy } = boxRegionRange(hx, hy, reach);
      for (let rx = minRx; rx <= maxRx; rx++) {
        for (let ry = minRy; ry <= maxRy; ry++) {
          const bucket = index.byRegion.get(regionKey(rx, ry));
          if (bucket === undefined) continue;
          const { records, fields } = bucket;
          const end = bucket.size * fields;
          for (let at = 0; at < end; at += fields) {
            if (!inBox(records[at + HX] ?? 0, records[at + HY] ?? 0, hx, hy, reach)) continue;
            if (keep !== undefined && !keep(records[at + CAPTURE] ?? 0)) continue;
            if (test((records[at + ID] ?? 0) as Entity)) return true;
          }
        }
      }
      return false;
    },
    nearestOf: (world, part, hx, hy, reach, skipReach, accept) => {
      const regions = memo.read(world).byPart?.get(part);
      if (regions === undefined) return null;
      const acc: NearestFold = { best: null, distance: Number.POSITIVE_INFINITY };
      if (reach === undefined) {
        for (const bucket of regions.values()) foldNearest(bucket, hx, hy, undefined, undefined, accept, acc);
      } else {
        const { minRx, maxRx, minRy, maxRy } = boxRegionRange(hx, hy, reach);
        const skipped = (rx: number, ry: number): boolean =>
          skipReach !== undefined && regionInBox(rx, ry, hx, hy, skipReach);
        // A sparse partition walks its own few regions rather than probing every region of a wide box.
        if ((maxRx - minRx + 1) * (maxRy - minRy + 1) > regions.size) {
          for (const [key, bucket] of regions) {
            const rx = Math.floor(key / REGION_KEY_STRIDE);
            const ry = key % REGION_KEY_STRIDE;
            if (rx < minRx || rx > maxRx || ry < minRy || ry > maxRy || skipped(rx, ry)) continue;
            foldNearest(bucket, hx, hy, reach, skipReach, accept, acc);
          }
        } else {
          for (let rx = minRx; rx <= maxRx; rx++) {
            for (let ry = minRy; ry <= maxRy; ry++) {
              if (skipped(rx, ry)) continue;
              const bucket = regions.get(regionKey(rx, ry));
              if (bucket !== undefined) foldNearest(bucket, hx, hy, reach, skipReach, accept, acc);
            }
          }
        }
      }
      return acc.best === null ? null : { entity: acc.best, distance: acc.distance };
    },
    partitionBoxHoldsAll: (world, part, hx, hy, reach) => {
      const regions = memo.read(world).byPart?.get(part);
      return regions === undefined || bucketsInBox(regions, hx, hy, reach);
    },
    somePartition: (world, part, test) => {
      const regions = memo.read(world).byPart?.get(part);
      if (regions === undefined) return false;
      for (const bucket of regions.values()) {
        const { records, fields } = bucket;
        const end = bucket.size * fields;
        for (let at = 0; at < end; at += fields) if (test((records[at + ID] ?? 0) as Entity)) return true;
      }
      return false;
    },
    firstOfPartitionAt: (world, part, hx, hy) => {
      const state = memo.read(world);
      const held = nodeLayer(state).get(nodeKeyOf(hx, hy));
      if (held === undefined) return null;
      const bucket = state.byRegion.get(regionKeyOf(hx, hy));
      if (bucket === undefined) return null;
      const inPart = (e: Entity): boolean => {
        const slot = bucket.find(e);
        return slot >= 0 && bucket.records[slot * REGION_FIELDS + PART] === part;
      };
      if (typeof held === 'number') return inPart(held) ? held : null;
      for (const e of held) if (inPart(e)) return e;
      return null;
    },
  };
}
