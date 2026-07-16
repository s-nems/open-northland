import { Position, Resource } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';

// The per-world "standing resource node at a half-cell tile" index, memoized against the Resource
// store's generation. `resourceAtTile` (the ground-drop → deposit work-cell join) is called per pile
// candidate per gatherer scan, and the linear reference — a full query over every resource on the map
// (tens of thousands on a decoded map) per call — collapsed a running colony to seconds per tick the
// moment loose ore piles appeared. Correctness rests on Resource rows being spatially immutable: a
// node's Position is set at spawn and never moves, so only Resource add/remove/destroy (all of which
// bump the store generation) can change the index; the registered verifier re-derives it under
// `verifyCaches()` like every incrementally-maintained cache.

interface ResourceTileCache {
  generation: number;
  /** tile key ({@link tileKey}) → goodType → lowest-id standing resource on that tile. */
  readonly byTile: Map<number, Map<number, Entity>>;
}

const resourceTileCache = new WeakMap<World, ResourceTileCache>();

/** Half-cell coords packed into one Map key. Stride comfortably above any map's node width. */
const TILE_KEY_STRIDE = 1 << 16;

function tileKey(x: number, y: number): number {
  return x * TILE_KEY_STRIDE + y;
}

function deriveResourceTileCache(world: World): ResourceTileCache {
  const byTile = new Map<number, Map<number, Entity>>();
  for (const e of world.query(Resource, Position)) {
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    const key = tileKey(n.hx, n.hy);
    let goods = byTile.get(key);
    if (goods === undefined) {
      goods = new Map();
      byTile.set(key, goods);
    }
    const goodType = world.get(e, Resource).goodType;
    const held = goods.get(goodType);
    // Canonical pick: the LOWEST id wins, whatever the store's insertion order.
    if (held === undefined || e < held) goods.set(goodType, e);
  }
  return { generation: world.componentGeneration(Resource), byTile };
}

function sameIndex(a: ResourceTileCache, b: ResourceTileCache): boolean {
  if (a.byTile.size !== b.byTile.size) return false;
  for (const [key, goods] of a.byTile) {
    const other = b.byTile.get(key);
    if (other === undefined || other.size !== goods.size) return false;
    for (const [goodType, entity] of goods) if (other.get(goodType) !== entity) return false;
  }
  return true;
}

function verifyResourceTileCache(world: World): string[] {
  const cached = resourceTileCache.get(world);
  if (cached === undefined) return [];
  if (cached.generation !== world.componentGeneration(Resource)) return [];
  if (sameIndex(cached, deriveResourceTileCache(world))) return [];
  return [
    'resourceTileIndex holds a stale tile→resource map — a Resource moved or mutated without a store-generation bump',
  ];
}

/**
 * The lowest-id standing resource of `goodType` whose node is exactly `(x, y)` (half-cell coords), or
 * null — byte-identical to the linear reference scan over `query(Resource, Position)`, served O(1)
 * from the memoized index.
 */
export function resourceAtTile(world: World, x: number, y: number, goodType: number): Entity | null {
  const generation = world.componentGeneration(Resource);
  let cache = resourceTileCache.get(world);
  if (cache === undefined || cache.generation !== generation) {
    cache = deriveResourceTileCache(world);
    resourceTileCache.set(world, cache);
    world.registerCacheVerifier('resourceTileIndex', () => verifyResourceTileCache(world));
  }
  return cache.byTile.get(tileKey(x, y))?.get(goodType) ?? null;
}
