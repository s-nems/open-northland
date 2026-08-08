import { insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import { createSpatialMemo } from './memo.js';
import { NodeBuckets, nodeKey } from './nodes.js';

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

interface RegionMember {
  readonly e: Entity;
  /** The member's anchor node, kept beside the id so the box filter needs no store read per query. */
  readonly hx: number;
  readonly hy: number;
}

interface RegionState<Extra> {
  byRegion: Map<number, RegionMember[]>;
  /** The same members re-bucketed at node granularity, minted by the first {@link RegionIndex.atNode}
   *  caller and maintained from then on. */
  byNode: NodeBuckets | null;
  /** Ascending-id canonical membership, the mutable master copy behind {@link RegionIndex.canonical}. */
  list: Entity[];
  /** The shared frozen view handed to consumers, dropped on every change, so a consumer holding one
   *  keeps an immutable snapshot. */
  frozen: readonly Entity[] | null;
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
 * replays.
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

/** A memoized region index over `(component, Position)` entities. */
export interface RegionIndex<Extra> {
  /** The memoized ascending-id list of every indexed entity, shared and frozen. */
  canonical(world: World): readonly Entity[];
  /** Every indexed entity whose anchor node lies within the axis-aligned box `reach` nodes around
   *  `(hx, hy)`, ascending-id. A candidate superset, valid only when `reach` covers the caller's radius
   *  plus the largest anchor-to-interaction-cell offset. */
  near(world: World, hx: number, hy: number, reach: number): Entity[];
  /** Whether any indexed entity inside the same box passes `test`. Unordered and first-hit, which a pure
   *  existence question does not need. */
  someNear(world: World, hx: number, hy: number, reach: number, test: (e: Entity) => boolean): boolean;
  /** Every indexed entity whose anchor node is exactly `(hx, hy)`, ascending-id. This is the index's live
   *  bucket, not a copy, so a caller that destroys members must copy it first. */
  atNode(world: World, hx: number, hy: number): readonly Entity[];
  /** The per-index derived extra, maintained incrementally beside the membership. */
  extra(world: World): Extra;
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

function inBox(m: RegionMember, hx: number, hy: number, reach: number): boolean {
  return Math.abs(m.hx - hx) <= reach && Math.abs(m.hy - hy) <= reach;
}

/** The node layer's held-versus-fresh verifier leg. The layer rides its own insert and remove calls
 *  beside `byRegion`, so a missed one is invisible to the region walk and would surface only as a wrong
 *  occupancy answer. Compared element-wise, so it still holds once an `atNode` caller picks a winner. */
function nodeLayerDivergence(
  verifier: string,
  held: NodeBuckets,
  fresh: Map<number, RegionMember[]>,
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

/**
 * Build a memoized region index over the entities carrying `component` and a Position, maintained
 * incrementally against that component's store generation.
 */
export function createRegionIndex<Extra, Capture>(
  component: Component<unknown>,
  labels: RegionIndexLabels,
  extraOps: RegionExtraOps<Extra, Capture>,
): RegionIndex<Extra> {
  interface Member {
    readonly hx: number;
    readonly hy: number;
    readonly capture: Capture;
  }

  const memo = createSpatialMemo<RegionState<Extra>, Member>(component, labels, {
    empty: () => ({ byRegion: new Map(), byNode: null, list: [], frozen: null, extra: extraOps.empty() }),
    member: (world, e, hx, hy) => ({ hx, hy, capture: extraOps.capture(world, e) }),
    insert: (state, e, m) => {
      state.frozen = null;
      insertSortedById(state.list, e, (id) => id);
      const key = regionKeyOf(m.hx, m.hy);
      let bucket = state.byRegion.get(key);
      if (bucket === undefined) {
        bucket = [];
        state.byRegion.set(key, bucket);
      }
      insertSortedById(bucket, { e, hx: m.hx, hy: m.hy }, (member) => member.e);
      state.byNode?.insert(e, m.hx, m.hy);
      extraOps.insert(state.extra, m.capture);
    },
    remove: (state, e, m) => {
      state.frozen = null;
      removeSortedById(state.list, e, (id) => id);
      const key = regionKeyOf(m.hx, m.hy);
      const bucket = state.byRegion.get(key);
      if (bucket !== undefined) {
        removeSortedById(bucket, e, (member) => member.e);
        if (bucket.length === 0) state.byRegion.delete(key);
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
      for (const [key, bucket] of fresh.byRegion) {
        const heldBucket = held.byRegion.get(key);
        if (
          heldBucket === undefined ||
          heldBucket.length !== bucket.length ||
          bucket.some((m, i) => {
            const h = heldBucket[i];
            return h === undefined || h.e !== m.e || h.hx !== m.hx || h.hy !== m.hy;
          })
        ) {
          return [
            `${labels.verifier} region ${key} diverges from a fresh rebuild - a ${labels.singular} moved in place`,
          ];
        }
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
      if (state.frozen === null) state.frozen = Object.freeze([...state.list]);
      return state.frozen;
    },
    extra: (world) => memo.read(world).extra,
    near: (world, hx, hy, reach) => {
      const index = memo.read(world);
      const { minRx, maxRx, minRy, maxRy } = boxRegionRange(hx, hy, reach);
      const out: Entity[] = [];
      for (let rx = minRx; rx <= maxRx; rx++) {
        for (let ry = minRy; ry <= maxRy; ry++) {
          const bucket = index.byRegion.get(regionKey(rx, ry));
          if (bucket === undefined) continue;
          for (const m of bucket) if (inBox(m, hx, hy, reach)) out.push(m.e);
        }
      }
      // Each region list is ascending, but concatenating across regions is not, and a nearest-scan's
      // first-wins tie-break depends on the canonical ascending-id order.
      out.sort((a, b) => a - b);
      return out;
    },
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
    someNear: (world, hx, hy, reach, test) => {
      const index = memo.read(world);
      const { minRx, maxRx, minRy, maxRy } = boxRegionRange(hx, hy, reach);
      for (let rx = minRx; rx <= maxRx; rx++) {
        for (let ry = minRy; ry <= maxRy; ry++) {
          const bucket = index.byRegion.get(regionKey(rx, ry));
          if (bucket === undefined) continue;
          for (const m of bucket) if (inBox(m, hx, hy, reach) && test(m.e)) return true;
        }
      }
      return false;
    },
  };
}
