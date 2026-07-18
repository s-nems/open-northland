import { Resource } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { lowerBound } from '../spatial.js';
import { createSpatialMemo } from '../spatial-memo.js';

// The per-world "standing resource node at a half-cell tile" index, a spatial-memo rider maintained
// incrementally against the Resource store's generation. `resourceAtTile` (the ground-drop → deposit
// work-cell join) is called per pile candidate per gatherer scan, and the linear reference — a full
// query over every resource on the map (tens of thousands on a decoded map) per call — collapsed a
// running colony to seconds per tick the moment loose ore piles appeared. Correctness rests on Resource
// rows being spatially immutable: a node's Position is set at spawn and never moves, so only Resource
// add/remove/destroy (all journaled generation bumps) can change the index; the registered verifier
// re-derives it under `verifyCaches()` like every incrementally-maintained cache.

/** tile key ({@link tileKey}) → goodType → ascending-id standing resources on that tile. Each list keeps
 *  every co-tile resource (not just the winner) so an incremental removal surfaces the runner-up. */
type ResourceTileMap = Map<number, Map<number, Entity[]>>;

/** Half-cell coords packed into one Map key. Stride comfortably above any map's node width. */
const TILE_KEY_STRIDE = 1 << 16;

function tileKey(x: number, y: number): number {
  return x * TILE_KEY_STRIDE + y;
}

const memo = createSpatialMemo<ResourceTileMap, { key: number; goodType: number }>(
  Resource,
  { verifier: 'resourceTileIndex', plural: 'resources', component: 'Resource' },
  {
    empty: () => new Map(),
    member: (world, e, hx, hy) => ({ key: tileKey(hx, hy), goodType: world.get(e, Resource).goodType }),
    insert: (byTile, e, m) => {
      let goods = byTile.get(m.key);
      if (goods === undefined) {
        goods = new Map();
        byTile.set(m.key, goods);
      }
      let list = goods.get(m.goodType);
      if (list === undefined) {
        list = [];
        goods.set(m.goodType, list);
      }
      list.splice(
        lowerBound(list, e, (id) => id),
        0,
        e,
      );
    },
    remove: (byTile, e, m) => {
      const goods = byTile.get(m.key);
      const list = goods?.get(m.goodType);
      if (goods === undefined || list === undefined) return;
      const i = lowerBound(list, e, (id) => id);
      if (list[i] !== e) return;
      list.splice(i, 1);
      if (list.length === 0) {
        goods.delete(m.goodType);
        if (goods.size === 0) byTile.delete(m.key);
      }
    },
    diverges: (held, fresh) => {
      if (sameIndex(held, fresh)) return [];
      return [
        'resourceTileIndex holds a stale tile→resource map — a Resource moved or mutated without a store-generation bump',
      ];
    },
  },
);

function sameIndex(a: ResourceTileMap, b: ResourceTileMap): boolean {
  if (a.size !== b.size) return false;
  for (const [key, goods] of a) {
    const other = b.get(key);
    if (other === undefined || other.size !== goods.size) return false;
    for (const [goodType, list] of goods) {
      const otherList = other.get(goodType);
      if (otherList === undefined || otherList.length !== list.length) return false;
      for (let i = 0; i < list.length; i++) if (otherList[i] !== list[i]) return false;
    }
  }
  return true;
}

/**
 * The lowest-id standing resource of `goodType` whose node is exactly `(x, y)` (half-cell coords), or
 * null — byte-identical to the linear reference scan over `query(Resource, Position)`, served O(1)
 * from the memoized index (each tile list is ascending-id, so the head is the canonical winner).
 */
export function resourceAtTile(world: World, x: number, y: number, goodType: number): Entity | null {
  return memo.read(world).get(tileKey(x, y))?.get(goodType)?.[0] ?? null;
}
