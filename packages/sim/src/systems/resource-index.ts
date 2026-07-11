import { Position, Resource } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { nodeOfPosition } from '../nav/halfcell.js';
import { canonicalById } from './spatial.js';

/**
 * The per-world RESOURCE spatial index — the golden-rule-6 lever that lets a flag-bound gatherer's
 * `nearestHarvestableFor` scan read only the standing nodes near its flag instead of every resource
 * on a decoded map (~17k). Derived read-state, never hashed: it is rebuilt wholesale whenever the
 * {@link Resource} store generation moves (create/destroy — standing nodes never move or lose their
 * Position without dying, the invariant the registered verifier re-checks under invariant-checked
 * runs) and its answers are provable SUPERSETS re-filtered by the unchanged canonical scan loop, so
 * no winner can differ from the full scan's.
 */

/**
 * Region edge (half-cell nodes) of the {@link resourcesNearNode} spatial index — square regions of
 * 32×32 nodes (≈16×16 cells). Sized so a flag-radius query (radius 24 + work-cell slack) touches a
 * handful of regions while region lists stay big enough that the per-query merge cost is trivial.
 * A named tuning constant, not a data pin: only query COST depends on it, never a winner.
 */
const RESOURCE_REGION_NODES = 32;
/** Region key packing (`rx * STRIDE + ry`): supports maps up to 65k regions per axis — far beyond
 *  any real map — while staying a plain number key (no string mint per lookup). */
const REGION_KEY_STRIDE = 1 << 16;

interface RegionMember {
  readonly e: Entity;
  /** The member's anchor node — kept beside the id so the box filter needs no store read per query. */
  readonly hx: number;
  readonly hy: number;
}

interface ResourceRegionIndex {
  /** The {@link Resource} store generation this index was derived at (see the invalidation note). */
  generation: number;
  /** Ascending-id list of every Resource+Position entity — the memoized {@link canonicalResources}. */
  list: readonly Entity[];
  /** Region key → its members, each list ascending-id (built from the canonical list). */
  byRegion: Map<number, RegionMember[]>;
  /** Every DISTINCT `Resource.harvestAtomic` present on the indexed nodes — the exact dormancy probe
   *  {@link resourceHarvestAtomics} serves (a job allowing none of these can harvest nothing). */
  atomics: ReadonlySet<number>;
}

const resourceRegionCache = new WeakMap<World, ResourceRegionIndex>();

function regionKeyOf(hx: number, hy: number): number {
  return Math.floor(hx / RESOURCE_REGION_NODES) * REGION_KEY_STRIDE + Math.floor(hy / RESOURCE_REGION_NODES);
}

function buildResourceRegionIndex(world: World): ResourceRegionIndex {
  const list = canonicalById(world.query(Resource, Position));
  const byRegion = new Map<number, RegionMember[]>();
  const atomics = new Set<number>();
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
    atomics.add(world.get(e, Resource).harvestAtomic);
  }
  // Frozen like canonicalEntities' shared memo: an in-place .sort()/.reverse() by a consumer throws at
  // the mutation site instead of silently corrupting every other consumer's canonical order.
  return { generation: world.componentGeneration(Resource), list: Object.freeze(list), byRegion, atomics };
}

function resourceRegionIndex(world: World): ResourceRegionIndex {
  const generation = world.componentGeneration(Resource);
  const cached = resourceRegionCache.get(world);
  if (cached !== undefined && cached.generation === generation) return cached;
  const fresh = buildResourceRegionIndex(world);
  resourceRegionCache.set(world, fresh);
  world.registerCacheVerifier('resourceRegionIndex', () => verifyResourceRegionIndex(world));
  return fresh;
}

function verifyResourceRegionIndex(world: World): string[] {
  const cached = resourceRegionCache.get(world);
  if (cached === undefined || cached.generation !== world.componentGeneration(Resource)) return [];
  const fresh = buildResourceRegionIndex(world);
  if (fresh.list.length !== cached.list.length || fresh.list.some((e, i) => cached.list[i] !== e)) {
    return [
      `resourceRegionIndex holds ${cached.list.length} resources but re-derived ${fresh.list.length} — a Resource/Position changed without a Resource-store generation bump`,
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
      return [`resourceRegionIndex region ${key} diverges from a fresh rebuild — a resource moved in place`];
    }
  }
  return [];
}

/**
 * The memoized ascending-id list of every `Resource`+`Position` entity — what `collectTargets` used to
 * rebuild (query + sort, O(n log n)) EVERY tick: with a decoded map's ~17k standing nodes that per-tick
 * sort alone was a milliseconds-scale cost. Cached per world against the **Resource store generation**:
 * nodes are created/destroyed through `add`/`destroy` (which bump it), and a standing node never moves
 * or loses its Position without dying — the invariant the {@link resourceRegionIndex} verifier re-checks
 * under invariant-checked runs. Shared, read-only and FROZEN — a consumer's in-place sort throws.
 */
export function canonicalResources(world: World): readonly Entity[] {
  return resourceRegionIndex(world).list;
}

/**
 * Every DISTINCT `harvestAtomic` present on the standing resources — the EXACT dormancy probe for a
 * nearest-harvestable scan: a settler whose allowed atomics intersect none of these can match no
 * candidate (`allowed.has(res.harvestAtomic)` fails for every node), so its whole scan is provably
 * null and skipped in O(present atomics). Unlike a content-derived "job has a harvest atomic" gate,
 * this stays exact even for a fixture node carrying an out-of-content atomic id. A drained node
 * (`remaining <= 0`) still contributes its atomic — the gate only ever ELIDES provably-null scans.
 */
export function resourceHarvestAtomics(world: World): ReadonlySet<number> {
  return resourceRegionIndex(world).atomics;
}

/**
 * Every resource whose ANCHOR node lies within the axis-aligned box `reach` nodes around `(hx, hy)`,
 * ascending-id — the flag-bound gatherer's candidate superset. The box is a SUPERSET of the true
 * "work cell within `radius` of the flag" disc as long as `reach ≥ radius + max work-cell offset`
 * (the caller adds that slack): any node whose work cell can pass the radius test has its anchor
 * within `radius + slack`, so scanning only these candidates provably picks the same winner as the
 * full canonical scan — the filter/rank loop itself is unchanged. Cost: O(regions touched + matches)
 * instead of O(all resources) per scan, the golden-rule-6 fix for per-gatherer whole-map scans.
 */
export function resourcesNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  const index = resourceRegionIndex(world);
  const minRx = Math.floor(Math.max(0, hx - reach) / RESOURCE_REGION_NODES);
  const maxRx = Math.floor((hx + reach) / RESOURCE_REGION_NODES);
  const minRy = Math.floor(Math.max(0, hy - reach) / RESOURCE_REGION_NODES);
  const maxRy = Math.floor((hy + reach) / RESOURCE_REGION_NODES);
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
}
