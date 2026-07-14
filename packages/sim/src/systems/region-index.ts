import { Position } from '../components/index.js';
import type { Component, Entity, World } from '../ecs/world.js';
import { nodeOfPosition } from '../nav/halfcell.js';
import { canonicalById } from './spatial.js';

/**
 * The per-world region spatial index shared by the resource and berry-bush indexes — the golden-rule-6
 * lever that lets a radius-bounded scan (a flag-bound gatherer, a hungry forager) read only the standing
 * entities near a point instead of every one on a decoded map. Derived read-state, never hashed: rebuilt
 * wholesale whenever the indexed component's store generation moves (create/destroy — a standing entity
 * never moves or loses its Position without dying, the invariant the registered verifier re-checks), and
 * its `near` answers are provable supersets the caller's unchanged canonical filter/rank loop re-checks,
 * so no winner can differ from a full scan.
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

interface RegionIndexState<Extra> {
  generation: number;
  list: readonly Entity[];
  byRegion: Map<number, RegionMember[]>;
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

/** A memoized region index over `(component, Position)` entities — see {@link createRegionIndex}. */
export interface RegionIndex<Extra> {
  /** The memoized ascending-id list of every indexed entity — shared, read-only and frozen (a consumer's
   *  in-place sort throws at the mutation site). */
  canonical(world: World): readonly Entity[];
  /** Every indexed entity whose anchor node lies within the axis-aligned box `reach` nodes around
   *  `(hx, hy)`, ascending-id — the caller's candidate superset (valid when `reach ≥ radius + the max
   *  anchor→interaction-cell offset`). Cost: O(regions touched + matches), not O(all indexed). */
  near(world: World, hx: number, hy: number, reach: number): Entity[];
  /** The per-index derived extra, folded over the canonical list at build time and cached alongside. */
  extra(world: World): Extra;
}

function regionKeyOf(hx: number, hy: number): number {
  return Math.floor(hx / REGION_NODES) * REGION_KEY_STRIDE + Math.floor(hy / REGION_NODES);
}

/**
 * Build a memoized region index over the entities carrying `component` and a {@link Position}, keyed and
 * invalidated on that component's store generation. `reduceExtra` folds the canonical list into a derived
 * value cached alongside (the resource index's distinct-harvest-atomics set; berries pass none).
 */
export function createRegionIndex<Extra>(
  component: Component<unknown>,
  labels: RegionIndexLabels,
  reduceExtra: (world: World, list: readonly Entity[]) => Extra,
): RegionIndex<Extra> {
  const cache = new WeakMap<World, RegionIndexState<Extra>>();

  const build = (world: World): RegionIndexState<Extra> => {
    const list = canonicalById(world.query(component, Position));
    const byRegion = new Map<number, RegionMember[]>();
    for (const e of list) {
      const p = world.get(e, Position);
      const n = nodeOfPosition(p.x, p.y);
      const key = regionKeyOf(n.hx, n.hy);
      let bucket = byRegion.get(key);
      if (bucket === undefined) {
        bucket = [];
        byRegion.set(key, bucket);
      }
      bucket.push({ e, hx: n.hx, hy: n.hy }); // canonical input order → each region list stays ascending-id
    }
    // Frozen like canonicalEntities' shared memo: an in-place .sort()/.reverse() by a consumer throws at
    // the mutation site instead of silently corrupting every other consumer's canonical order.
    return {
      generation: world.componentGeneration(component),
      list: Object.freeze(list),
      byRegion,
      extra: reduceExtra(world, list),
    };
  };

  const verify = (world: World): string[] => {
    const cached = cache.get(world);
    if (cached === undefined || cached.generation !== world.componentGeneration(component)) return [];
    const fresh = build(world);
    if (fresh.list.length !== cached.list.length || fresh.list.some((e, i) => cached.list[i] !== e)) {
      return [
        `${labels.verifier} holds ${cached.list.length} ${labels.plural} but re-derived ${fresh.list.length} — a ${labels.component}/Position changed without a ${labels.component}-store generation bump`,
      ];
    }
    for (const [key, bucket] of fresh.byRegion) {
      const held = cached.byRegion.get(key);
      if (
        held === undefined ||
        held.length !== bucket.length ||
        bucket.some((m, i) => {
          const h = held[i];
          return h === undefined || h.e !== m.e || h.hx !== m.hx || h.hy !== m.hy;
        })
      ) {
        return [
          `${labels.verifier} region ${key} diverges from a fresh rebuild — a ${labels.singular} moved in place`,
        ];
      }
    }
    return [];
  };

  const state = (world: World): RegionIndexState<Extra> => {
    const generation = world.componentGeneration(component);
    const cached = cache.get(world);
    if (cached !== undefined && cached.generation === generation) return cached;
    const fresh = build(world);
    cache.set(world, fresh);
    world.registerCacheVerifier(labels.verifier, () => verify(world));
    return fresh;
  };

  return {
    canonical: (world) => state(world).list,
    extra: (world) => state(world).extra,
    near: (world, hx, hy, reach) => {
      const index = state(world);
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
