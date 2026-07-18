import type { Component, Entity, World } from '../ecs/world.js';
import { lowerBound } from './spatial.js';
import { createSpatialMemo } from './spatial-memo.js';

/**
 * The per-world region spatial index shared by the resource and berry-bush indexes — the golden-rule-6
 * lever that lets a radius-bounded scan (a flag-bound gatherer, a hungry forager) read only the standing
 * entities near a point instead of every one on a decoded map. A {@link createSpatialMemo} rider: kept
 * incrementally against the indexed component's store generation (a standing entity never moves or loses
 * its Position without dying — the invariant the registered verifier re-checks), and its `near` answers
 * are provable supersets the caller's unchanged canonical filter/rank loop re-checks, so no winner can
 * differ from a full scan.
 */

/** Region edge (half-cell nodes): 32×32 (≈16×16 cells) — a flag/forage-radius query touches a handful of
 *  regions while region lists stay big enough that the merge cost is trivial. Only query cost depends on
 *  it, never a winner. */
const REGION_NODES = 32;
/** Region key packing (`rx * STRIDE + ry`): maps up to 65k regions per axis while staying a plain-number
 *  key (no per-lookup string mint). */
const REGION_KEY_STRIDE = 1 << 16;

interface RegionMember {
  readonly e: Entity;
  /** The member's anchor node — kept beside the id so the box filter needs no store read per query. */
  readonly hx: number;
  readonly hy: number;
}

interface RegionState<Extra> {
  byRegion: Map<number, RegionMember[]>;
  /** Ascending-id canonical membership — the mutable master copy behind {@link RegionIndex.canonical}. */
  list: Entity[];
  /** The shared frozen view handed to consumers, minted lazily and dropped on every change — a consumer
   *  holding one keeps an immutable snapshot (an in-place .sort() throws at the mutation site). */
  frozen: readonly Entity[] | null;
  extra: Extra;
}

/** Diagnostic labels for the cache verifier and its divergence messages (surfaced only by the
 *  `cachesCoherent` invariant). `verifier` must be the unique {@link World.registerCacheVerifier} id. */
export interface RegionIndexLabels {
  readonly verifier: string;
  readonly plural: string;
  readonly component: string;
  readonly singular: string;
}

/**
 * The per-index derived extra, maintained incrementally beside the membership. `capture` runs at insert
 * and must record everything `remove` needs — the entity may be destroyed by the time its removal replays.
 * `diverges` is the verifier's extra leg (held versus freshly folded).
 */
export interface RegionExtraOps<Extra, Capture> {
  empty(): Extra;
  capture(world: World, e: Entity): Capture;
  insert(extra: Extra, c: Capture): void;
  remove(extra: Extra, c: Capture): void;
  diverges(held: Extra, fresh: Extra): boolean;
}

/** The no-derived-extra ops for indexes that only need membership (the berry index). */
export const NO_REGION_EXTRA: RegionExtraOps<undefined, undefined> = {
  empty: () => undefined,
  capture: () => undefined,
  insert: () => {},
  remove: () => {},
  diverges: () => false,
};

/** A memoized region index over `(component, Position)` entities — see {@link createRegionIndex}. */
export interface RegionIndex<Extra> {
  /** The memoized ascending-id list of every indexed entity — shared, read-only and frozen (a consumer's
   *  in-place sort throws at the mutation site). */
  canonical(world: World): readonly Entity[];
  /** Every indexed entity whose anchor node lies within the axis-aligned box `reach` nodes around
   *  `(hx, hy)`, ascending-id — the caller's candidate superset (valid when `reach ≥ radius + the max
   *  anchor→interaction-cell offset`). Cost: O(regions touched + matches), not O(all indexed). */
  near(world: World, hx: number, hy: number, reach: number): Entity[];
  /** The per-index derived extra, maintained incrementally beside the membership. */
  extra(world: World): Extra;
}

function regionKeyOf(hx: number, hy: number): number {
  return Math.floor(hx / REGION_NODES) * REGION_KEY_STRIDE + Math.floor(hy / REGION_NODES);
}

/**
 * Build a memoized region index over the entities carrying `component` and a Position, maintained
 * incrementally against that component's store generation (see {@link createSpatialMemo}).
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
    empty: () => ({ byRegion: new Map(), list: [], frozen: null, extra: extraOps.empty() }),
    member: (world, e, hx, hy) => ({ hx, hy, capture: extraOps.capture(world, e) }),
    insert: (state, e, m) => {
      state.frozen = null;
      state.list.splice(
        lowerBound(state.list, e, (id) => id),
        0,
        e,
      );
      const key = regionKeyOf(m.hx, m.hy);
      let bucket = state.byRegion.get(key);
      if (bucket === undefined) {
        bucket = [];
        state.byRegion.set(key, bucket);
      }
      bucket.splice(
        lowerBound(bucket, e, (member) => member.e),
        0,
        { e, hx: m.hx, hy: m.hy },
      );
      extraOps.insert(state.extra, m.capture);
    },
    remove: (state, e, m) => {
      state.frozen = null;
      const li = lowerBound(state.list, e, (id) => id);
      if (state.list[li] === e) state.list.splice(li, 1);
      const key = regionKeyOf(m.hx, m.hy);
      const bucket = state.byRegion.get(key);
      if (bucket !== undefined) {
        const bi = lowerBound(bucket, e, (member) => member.e);
        if (bucket[bi]?.e === e) bucket.splice(bi, 1);
        if (bucket.length === 0) state.byRegion.delete(key);
      }
      extraOps.remove(state.extra, m.capture);
    },
    diverges: (held, fresh) => {
      if (held.list.length !== fresh.list.length || fresh.list.some((e, i) => held.list[i] !== e)) {
        return [
          `${labels.verifier} canonical list diverges from a fresh rebuild — an incremental splice missed`,
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
            `${labels.verifier} region ${key} diverges from a fresh rebuild — a ${labels.singular} moved in place`,
          ];
        }
      }
      if (extraOps.diverges(held.extra, fresh.extra)) {
        return [
          `${labels.verifier} derived extra diverges from a fresh rebuild — an incremental extra update missed`,
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
      const minRx = Math.floor(Math.max(0, hx - reach) / REGION_NODES);
      const maxRx = Math.floor((hx + reach) / REGION_NODES);
      const minRy = Math.floor(Math.max(0, hy - reach) / REGION_NODES);
      const maxRy = Math.floor((hy + reach) / REGION_NODES);
      const out: Entity[] = [];
      for (let rx = minRx; rx <= maxRx; rx++) {
        for (let ry = minRy; ry <= maxRy; ry++) {
          const bucket = index.byRegion.get(rx * REGION_KEY_STRIDE + ry);
          if (bucket === undefined) continue;
          for (const m of bucket) {
            if (Math.abs(m.hx - hx) <= reach && Math.abs(m.hy - hy) <= reach) out.push(m.e);
          }
        }
      }
      // Region lists are each ascending, but cross-region concatenation is not — restore the canonical
      // ascending-id order the nearest-scan's first-wins tie-break depends on.
      out.sort((a, b) => a - b);
      return out;
    },
  };
}
