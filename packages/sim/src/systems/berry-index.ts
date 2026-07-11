import { BerryBush, Position } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { nodeOfPosition } from '../nav/halfcell.js';
import { canonicalById } from './spatial.js';

/**
 * The per-world BERRY-BUSH spatial index — the golden-rule-6 twin of {@link import('./resource-index.js')}
 * for {@link BerryBush} entities. A decoded map spawns one bush per fruited-bush placement (tens of
 * thousands), and the eat drive's `nearestRipeBush` runs per HUNGRY settler; without this, that scan was
 * the "full-world scan inside a per-entity loop" that pins a big crowd. Bushes NEVER move and forage/
 * regrow mutate in place via `world.touch` (which does NOT bump the store generation), so the index is
 * rebuilt only when a bush is created/destroyed (the store generation moves) — its answers are provable
 * SUPERSETS the caller's canonical filter/rank loop re-checks, so no winner can differ from a full scan.
 */

/** Region edge (half-cell nodes) of the {@link bushesNearNode} index — 32×32 like the resource index, so
 *  a forage-radius query touches a handful of regions. Only query COST depends on it, never a winner. */
const BUSH_REGION_NODES = 32;
/** Region key packing (`rx * STRIDE + ry`) — a plain-number key, no per-lookup string mint. */
const REGION_KEY_STRIDE = 1 << 16;

interface RegionMember {
  readonly e: Entity;
  /** The bush's anchor node — kept beside the id so the box filter needs no store read per query. */
  readonly hx: number;
  readonly hy: number;
}

interface BushRegionIndex {
  /** The {@link BerryBush} store generation this index was derived at (the invalidation key). */
  generation: number;
  /** Ascending-id list of every BerryBush+Position entity — the memoized {@link canonicalBushes}. */
  list: readonly Entity[];
  /** Region key → its members, each list ascending-id (built from the canonical list). */
  byRegion: Map<number, RegionMember[]>;
}

const bushRegionCache = new WeakMap<World, BushRegionIndex>();

function regionKeyOf(hx: number, hy: number): number {
  return Math.floor(hx / BUSH_REGION_NODES) * REGION_KEY_STRIDE + Math.floor(hy / BUSH_REGION_NODES);
}

function buildBushRegionIndex(world: World): BushRegionIndex {
  const list = canonicalById(world.query(BerryBush, Position));
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
  // Frozen like the resource memo: a consumer's in-place .sort()/.reverse() throws at the mutation site
  // instead of silently corrupting every other consumer's canonical order.
  return { generation: world.componentGeneration(BerryBush), list: Object.freeze(list), byRegion };
}

function bushRegionIndex(world: World): BushRegionIndex {
  const generation = world.componentGeneration(BerryBush);
  const cached = bushRegionCache.get(world);
  if (cached !== undefined && cached.generation === generation) return cached;
  const fresh = buildBushRegionIndex(world);
  bushRegionCache.set(world, fresh);
  world.registerCacheVerifier('bushRegionIndex', () => verifyBushRegionIndex(world));
  return fresh;
}

function verifyBushRegionIndex(world: World): string[] {
  const cached = bushRegionCache.get(world);
  if (cached === undefined || cached.generation !== world.componentGeneration(BerryBush)) return [];
  const fresh = buildBushRegionIndex(world);
  if (fresh.list.length !== cached.list.length || fresh.list.some((e, i) => cached.list[i] !== e)) {
    return [
      `bushRegionIndex holds ${cached.list.length} bushes but re-derived ${fresh.list.length} — a BerryBush/Position changed without a BerryBush-store generation bump`,
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
      return [`bushRegionIndex region ${key} diverges from a fresh rebuild — a bush moved in place`];
    }
  }
  return [];
}

/**
 * The memoized ascending-id list of every `BerryBush`+`Position` entity — what `collectTargets` used to
 * rebuild (query + sort) EVERY tick even when nobody was hungry. Cached per world against the **BerryBush
 * store generation**: bushes are created/destroyed through `add`/`destroy` (which bump it), and a bush
 * never moves or loses its Position, nor does forage/regrow bump the generation (they `touch` in place) —
 * the invariant the {@link bushRegionIndex} verifier re-checks. Shared, read-only and FROZEN.
 */
export function canonicalBushes(world: World): readonly Entity[] {
  return bushRegionIndex(world).list;
}

/**
 * Every berry bush whose ANCHOR node lies within the axis-aligned box `reach` nodes around `(hx, hy)`,
 * ascending-id — the forager's candidate SUPERSET. Passing `reach ≥ forage radius + the max anchor→
 * interaction-cell offset` makes it a provable superset of the true "interaction cell within radius"
 * set (a bush is non-blocking, so its cell is its anchor unless a resource footprint overlaps the tile,
 * then an immediate walkable neighbour — ≤ a couple nodes), so the caller's unchanged cellDist filter +
 * rank picks the same winner as a full scan. Cost: O(regions touched + matches) instead of O(all bushes)
 * per hungry settler — the golden-rule-6 fix.
 */
export function bushesNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  const index = bushRegionIndex(world);
  const minRx = Math.floor(Math.max(0, hx - reach) / BUSH_REGION_NODES);
  const maxRx = Math.floor((hx + reach) / BUSH_REGION_NODES);
  const minRy = Math.floor(Math.max(0, hy - reach) / BUSH_REGION_NODES);
  const maxRy = Math.floor((hy + reach) / BUSH_REGION_NODES);
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
  // Region lists are each ascending, but cross-region concatenation is not — restore canonical order so
  // the nearest-scan's ascending-cell-id tie-break stays reproducible.
  out.sort((a, b) => a - b);
  return out;
}
