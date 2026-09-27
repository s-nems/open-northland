import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import { createSpatialMemo } from './memo.js';
import { nodeKey } from './metric.js';
import { NodeBuckets } from './nodes.js';

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

interface RegionMember<Capture> {
  readonly e: Entity;
  /** The member's anchor node, kept beside the id so the box filter needs no store read per query. */
  readonly hx: number;
  readonly hy: number;
  /** The extra's capture, kept beside the id so a {@link RegionIndex.near} filter needs no store read. */
  readonly capture: Capture;
}

/** Region buckets by region key, each ascending-id. */
type RegionBuckets<Capture> = Map<number, RegionMember<Capture>[]>;

interface RegionState<Extra, Capture> {
  byRegion: RegionBuckets<Capture>;
  /** The same members split by their partition key, for a partitioned index; null otherwise. */
  byPart: Map<number, RegionBuckets<Capture>> | null;
  /** The same members re-bucketed at node granularity, minted by the first {@link RegionIndex.atNode}
   *  caller and maintained from then on. */
  byNode: NodeBuckets | null;
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
 * replays. It must return a primitive: the verifier compares held and fresh captures with `!==`.
 */
export interface RegionExtraOps<Extra, Capture> {
  empty(): Extra;
  capture(world: World, e: Entity): Capture;
  insert(extra: Extra, c: Capture): void;
  remove(extra: Extra, c: Capture): void;
  diverges(held: Extra, fresh: Extra): boolean;
}

/** The no-derived-extra ops for indexes that only need membership. */
export const NO_REGION_EXTRA: RegionExtraOps<undefined, undefined> = {
  empty: () => undefined,
  capture: () => undefined,
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
export interface RegionIndex<Extra, Capture> {
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
    keep?: (capture: Capture) => boolean,
    skipReach?: number,
  ): Entity[];
  /** Whether any indexed entity inside the same box passes `test`. Unordered and first-hit, which a pure
   *  existence question does not need. `keep` skips a member by its capture before `test` reads it. */
  someNear(
    world: World,
    hx: number,
    hy: number,
    reach: number,
    test: (e: Entity) => boolean,
    keep?: (capture: Capture) => boolean,
  ): boolean;
  /** Whether the box `reach` nodes around `(hx, hy)` holds every indexed entity, so a miss inside it is
   *  a miss everywhere. Judged by whole regions, so a false answer proves nothing. */
  boxHoldsAll(world: World, hx: number, hy: number, reach: number): boolean;
  /** Every indexed entity whose anchor node is exactly `(hx, hy)`, ascending-id. This is the index's live
   *  bucket, not a copy, so a caller that destroys members must copy it first. */
  atNode(world: World, hx: number, hy: number): readonly Entity[];
  /** The per-index derived extra, maintained incrementally beside the membership. */
  extra(world: World): Extra;
}

/** A region index whose members also sit in per-key buckets, so a search for one key reads only its own
 *  members. The key is read at insert, so a change to it must re-add the component. */
export interface PartitionedRegionIndex<Extra, Capture> extends RegionIndex<Extra, Capture> {
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
}

/** Pack a region coordinate pair into a map key. Both axes are non-negative because an anchor is an
 *  in-bounds node, which keeps the packing collision-free and lets a box scan clamp its min bounds to 0. */
function regionKey(rx: number, ry: number): number {
  return rx * REGION_KEY_STRIDE + ry;
}

function regionKeyOf(hx: number, hy: number): number {
  return regionKey(Math.floor(hx / REGION_NODES), Math.floor(hy / REGION_NODES));
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

function inBox(m: RegionMember<unknown>, hx: number, hy: number, reach: number): boolean {
  return Math.abs(m.hx - hx) <= reach && Math.abs(m.hy - hy) <= reach;
}

/** The node layer's held-versus-fresh verifier leg. The layer rides its own insert and remove calls
 *  beside `byRegion`, so a missed one is invisible to the region walk and would surface only as a wrong
 *  occupancy answer. Compared element-wise, so it still holds once an `atNode` caller picks a winner. */
function nodeLayerDivergence(
  verifier: string,
  held: NodeBuckets,
  fresh: Map<number, RegionMember<unknown>[]>,
): string[] {
  const expected = new Map<string, Entity[]>();
  // A node belongs to exactly one region and every region bucket is ascending-id, so appending here
  // reproduces the ascending order both `atNode` paths build.
  for (const bucket of fresh.values()) {
    for (const m of bucket) {
      const at = expected.get(nodeKey(m.hx, m.hy));
      if (at === undefined) expected.set(nodeKey(m.hx, m.hy), [m.e]);
      else at.push(m.e);
    }
  }
  for (const bucket of held.buckets()) {
    const key = nodeKey(bucket.x, bucket.y);
    const want = expected.get(key);
    if (want === undefined || want.length !== bucket.entities.length) {
      return [`${verifier} node layer diverges at (${bucket.x},${bucket.y}) - a removal missed`];
    }
    if (want.some((e, i) => bucket.entities[i] !== e)) {
      return [`${verifier} node layer is out of order at (${bucket.x},${bucket.y})`];
    }
    expected.delete(key);
  }
  if (expected.size > 0) {
    return [`${verifier} node layer is missing ${expected.size} node(s) - an insert missed`];
  }
  return [];
}

/** Whether a partition's held buckets match a fresh rebuild's, region for region and element-wise. */
function partitionsDiverge(
  held: ReadonlyMap<number, RegionBuckets<unknown>>,
  fresh: ReadonlyMap<number, RegionBuckets<unknown>>,
): boolean {
  if (held.size !== fresh.size) return true;
  for (const [part, freshRegions] of fresh) {
    const heldRegions = held.get(part);
    if (heldRegions === undefined || heldRegions.size !== freshRegions.size) return true;
    for (const [key, bucket] of freshRegions) {
      const heldBucket = heldRegions.get(key);
      if (heldBucket === undefined || heldBucket.length !== bucket.length) return true;
      if (bucket.some((m, i) => heldBucket[i]?.e !== m.e)) return true;
    }
  }
  return false;
}

function insertIntoBuckets<Capture>(buckets: RegionBuckets<Capture>, m: RegionMember<Capture>): void {
  const key = regionKeyOf(m.hx, m.hy);
  let bucket = buckets.get(key);
  if (bucket === undefined) {
    bucket = [];
    buckets.set(key, bucket);
  }
  insertSortedById(bucket, m, (member) => member.e);
}

function removeFromBuckets<Capture>(
  buckets: RegionBuckets<Capture>,
  e: Entity,
  hx: number,
  hy: number,
): void {
  const key = regionKeyOf(hx, hy);
  const bucket = buckets.get(key);
  if (bucket === undefined) return;
  removeSortedById(bucket, e, (member) => member.e);
  if (bucket.length === 0) buckets.delete(key);
}

/** Whether every region holding a member of `buckets` lies inside the box `reach` nodes around `(hx, hy)`. */
function bucketsInBox(buckets: RegionBuckets<unknown>, hx: number, hy: number, reach: number): boolean {
  for (const key of buckets.keys()) {
    if (!regionInBox(Math.floor(key / REGION_KEY_STRIDE), key % REGION_KEY_STRIDE, hx, hy, reach)) {
      return false;
    }
  }
  return true;
}

interface NearestFold {
  best: Entity | null;
  distance: number;
}

/** Fold `bucket` into `acc` by `(Manhattan distance, id)`, testing `accept` only on a member that wins. */
function foldNearest(
  bucket: readonly RegionMember<unknown>[],
  hx: number,
  hy: number,
  reach: number | undefined,
  skipReach: number | undefined,
  accept: (e: Entity) => boolean,
  acc: NearestFold,
): void {
  for (const m of bucket) {
    if (reach !== undefined && !inBox(m, hx, hy, reach)) continue;
    if (skipReach !== undefined && inBox(m, hx, hy, skipReach)) continue;
    const distance = Math.abs(m.hx - hx) + Math.abs(m.hy - hy);
    if (distance > acc.distance) continue;
    if (distance === acc.distance && acc.best !== null && m.e > acc.best) continue;
    if (!accept(m.e)) continue;
    acc.best = m.e;
    acc.distance = distance;
  }
}

/**
 * Build a memoized region index over the entities carrying `component` and a Position, maintained
 * incrementally against that component's store generation.
 */
export function createRegionIndex<Extra, Capture>(
  component: Component<unknown>,
  labels: RegionIndexLabels,
  extraOps: RegionExtraOps<Extra, Capture>,
): RegionIndex<Extra, Capture> {
  return buildRegionIndex(component, labels, extraOps, null);
}

/** {@link createRegionIndex} with members also bucketed by `partitionOf`, read at insert. */
export function createPartitionedRegionIndex<Extra, Capture>(
  component: Component<unknown>,
  labels: RegionIndexLabels,
  extraOps: RegionExtraOps<Extra, Capture>,
  partitionOf: (world: World, e: Entity) => number,
): PartitionedRegionIndex<Extra, Capture> {
  return buildRegionIndex(component, labels, extraOps, partitionOf);
}

function buildRegionIndex<Extra, Capture>(
  component: Component<unknown>,
  labels: RegionIndexLabels,
  extraOps: RegionExtraOps<Extra, Capture>,
  partitionOf: ((world: World, e: Entity) => number) | null,
): PartitionedRegionIndex<Extra, Capture> {
  interface Member {
    readonly hx: number;
    readonly hy: number;
    readonly capture: Capture;
    readonly part: number;
  }

  const memo = createSpatialMemo<RegionState<Extra, Capture>, Member>(component, labels, {
    empty: () => ({
      byRegion: new Map(),
      byPart: partitionOf === null ? null : new Map(),
      byNode: null,
      list: [],
      shared: null,
      extra: extraOps.empty(),
    }),
    member: (world, e, hx, hy) => ({
      hx,
      hy,
      capture: extraOps.capture(world, e),
      part: partitionOf === null ? 0 : partitionOf(world, e),
    }),
    insert: (state, e, m) => {
      state.shared = null;
      insertSortedById(state.list, e, (id) => id);
      const member: RegionMember<Capture> = { e, hx: m.hx, hy: m.hy, capture: m.capture };
      insertIntoBuckets(state.byRegion, member);
      if (state.byPart !== null) {
        let regions = state.byPart.get(m.part);
        if (regions === undefined) {
          regions = new Map();
          state.byPart.set(m.part, regions);
        }
        insertIntoBuckets(regions, member);
      }
      state.byNode?.insert(e, m.hx, m.hy);
      extraOps.insert(state.extra, m.capture);
    },
    remove: (state, e, m) => {
      state.shared = null;
      removeSortedById(state.list, e, (id) => id);
      removeFromBuckets(state.byRegion, e, m.hx, m.hy);
      const regions = state.byPart?.get(m.part);
      if (regions !== undefined) {
        removeFromBuckets(regions, e, m.hx, m.hy);
        if (regions.size === 0) state.byPart?.delete(m.part);
      }
      state.byNode?.remove(e, m.hx, m.hy);
      extraOps.remove(state.extra, m.capture);
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
      for (const [key, bucket] of fresh.byRegion) {
        const heldBucket = held.byRegion.get(key);
        if (
          heldBucket === undefined ||
          heldBucket.length !== bucket.length ||
          bucket.some((m, i) => {
            const h = heldBucket[i];
            return (
              h === undefined || h.e !== m.e || h.hx !== m.hx || h.hy !== m.hy || h.capture !== m.capture
            );
          })
        ) {
          return [
            `${labels.verifier} region ${key} diverges from a fresh rebuild - a ${labels.singular} moved or changed in place`,
          ];
        }
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

  return {
    canonical: (world) => {
      const state = memo.read(world);
      state.shared ??= state.list.slice();
      return state.shared;
    },
    extra: (world) => memo.read(world).extra,
    near: (world, hx, hy, reach, keep, skipReach) => {
      const index = memo.read(world);
      const { minRx, maxRx, minRy, maxRy } = boxRegionRange(hx, hy, reach);
      const out: Entity[] = [];
      for (let rx = minRx; rx <= maxRx; rx++) {
        for (let ry = minRy; ry <= maxRy; ry++) {
          if (skipReach !== undefined && regionInBox(rx, ry, hx, hy, skipReach)) continue;
          const bucket = index.byRegion.get(regionKey(rx, ry));
          if (bucket === undefined) continue;
          for (const m of bucket) {
            if (!inBox(m, hx, hy, reach) || (keep !== undefined && !keep(m.capture))) continue;
            if (skipReach === undefined || !inBox(m, hx, hy, skipReach)) out.push(m.e);
          }
        }
      }
      // Each region list is ascending, but concatenating across regions is not, and a nearest-scan's
      // first-wins tie-break depends on the canonical ascending-id order.
      out.sort((a, b) => a - b);
      return out;
    },
    boxHoldsAll: (world, hx, hy, reach) => bucketsInBox(memo.read(world).byRegion, hx, hy, reach),
    atNode: (world, hx, hy) => {
      const state = memo.read(world);
      if (state.byNode === null) {
        const buckets = new NodeBuckets(world, []);
        for (const bucket of state.byRegion.values()) {
          for (const m of bucket) buckets.insert(m.e, m.hx, m.hy);
        }
        state.byNode = buckets;
      }
      return state.byNode.at(hx, hy);
    },
    someNear: (world, hx, hy, reach, test, keep) => {
      const index = memo.read(world);
      const { minRx, maxRx, minRy, maxRy } = boxRegionRange(hx, hy, reach);
      for (let rx = minRx; rx <= maxRx; rx++) {
        for (let ry = minRy; ry <= maxRy; ry++) {
          const bucket = index.byRegion.get(regionKey(rx, ry));
          if (bucket === undefined) continue;
          for (const m of bucket) {
            if (inBox(m, hx, hy, reach) && (keep === undefined || keep(m.capture)) && test(m.e)) return true;
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
  };
}
