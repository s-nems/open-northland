import type { ContentSet } from '@open-northland/data';
import {
  Building,
  GOODS_SEARCH_RANGE_NODES,
  Owner,
  Position,
  signpostNavigationEnabled,
} from '../../components/index.js';
import type { ChangeFeed } from '../../ecs/change-feed.js';
import type { Entity, World } from '../../ecs/world.js';
import { TileBuckets } from '../../inspect/tile-buckets.js';
import type { SpatialGate } from '../../nav/node-circle.js';
import { type ReachArea, reachContains, reachGate } from '../../nav/range-search.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { interactionNode } from '../footprint/interaction.js';
import { type SignpostSite, signpostNetwork, signpostNetworkRevision } from './network.js';
import { signpostTerrainKey, type TerrainReach, terrainReach } from './terrain-reach.js';

interface ReachCache {
  readonly terrain: TerrainGraph;
  readonly key: string;
  readonly posts: Map<Entity, TerrainReach>;
  readonly spots: Map<string, TerrainReach>;
  readonly sites: TileBuckets<SignpostSite & { player: number }>;
  readonly groups: Map<number, SpatialGate>;
  readonly limits: Map<string, SpatialGate>;
  readonly views: Map<number, SignpostReachView>;
}
const caches = new WeakMap<World, ReachCache>();

interface Doors {
  readonly feed: ChangeFeed;
  readonly entries: Map<Entity, { player: number; hx: number; hy: number }>;
  revision: number;
}
const doorCaches = new WeakMap<World, Doors>();
function doorsOf(world: World, content: ContentSet, terrain: TerrainGraph): Doors {
  let held = doorCaches.get(world);
  if (held === undefined) {
    held = {
      feed: world.watchChanges([Building, Position, Owner], [Building, Position, Owner]),
      entries: new Map(),
      revision: 0,
    };
    held.feed.lose();
    doorCaches.set(world, held);
  }
  const state = held;
  const update = (id: Entity): void => {
    const old = state.entries.get(id);
    if (!world.has(id, Building)) {
      if (state.entries.delete(id)) state.revision++;
      return;
    }
    const player = world.tryGet(id, Owner)?.player;
    const door = interactionNode(world, { content, terrain }, id);
    if (player === undefined || door === null) {
      if (state.entries.delete(id)) state.revision++;
    } else if (old?.player !== player || old.hx !== door.x || old.hy !== door.y) {
      state.entries.set(id, { player, hx: door.x, hy: door.y });
      state.revision++;
    }
  };
  if (state.feed.drain(update)) {
    const ids = new Set([...state.entries.keys(), ...world.query(Building, Position, Owner)]);
    for (const id of ids) update(id);
  }
  return state;
}

export function signpostReachKey(world: World, content: ContentSet, terrain: TerrainGraph): string {
  return `${signpostTerrainKey(world, content, terrain)}:${signpostNetworkRevision(world)}:${doorsOf(world, content, terrain).revision}`;
}

function cacheOf(world: World, content: ContentSet, terrain: TerrainGraph): ReachCache {
  const key = signpostReachKey(world, content, terrain);
  let cache = caches.get(world);
  if (cache === undefined || cache.terrain !== terrain || cache.key !== key) {
    const sites = new TileBuckets<SignpostSite & { player: number }>();
    for (const [player, posts] of signpostNetwork(world))
      for (const p of posts) sites.set(p.entity, { ...p, player }, p.hx / 2, p.hy / 2);
    cache = {
      terrain,
      key,
      posts: new Map(cache?.terrain === terrain ? [...cache.posts].filter(([id]) => world.isAlive(id)) : []),
      spots: cache?.terrain === terrain ? cache.spots : new Map(),
      views: new Map(),
      sites,
      groups: new Map(),
      limits: new Map(),
    };
    caches.set(world, cache);
  }
  return cache;
}

export function goodsReachAt(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  hx: number,
  hy: number,
): ReachArea {
  const cache = cacheOf(world, content, terrain);
  const key = `${hx}:${hy}`;
  const held = cache.spots.get(key);
  const found = terrainReach(world, content, terrain, hx, hy, GOODS_SEARCH_RANGE_NODES, held);
  if (cache.spots.size >= 256 && held === undefined) cache.spots.clear();
  cache.spots.set(key, found);
  return found.area;
}

function postReach(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  id: Entity,
  hx: number,
  hy: number,
): ReachArea {
  const cache = cacheOf(world, content, terrain);
  const found = terrainReach(world, content, terrain, hx, hy, GOODS_SEARCH_RANGE_NODES, cache.posts.get(id));
  cache.posts.set(id, found);
  return found.area;
}

/** Goods are discovered locally or through the connected guides reached by the same local search. */
export function goodsSearchLimitAt(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number | undefined,
  hx: number,
  hy: number,
): SpatialGate | null {
  if (!signpostNavigationEnabled(world) || player === undefined) return null;
  const cache = cacheOf(world, content, terrain);
  const key = `${player}:${hx}:${hy}`;
  const held = cache.limits.get(key);
  if (held !== undefined) return held;
  const local = goodsReachAt(world, content, terrain, hx, hy);
  const nearby = cache.sites.within({
    minX: local.minX / 2,
    maxX: local.maxX / 2,
    minY: local.minY / 2,
    maxY: local.maxY / 2,
  });
  const groups = new Set(
    nearby.filter((p) => p.player === player && reachContains(local, p.hx, p.hy)).map((p) => p.group),
  );
  const gates: SpatialGate[] = [reachGate(terrain, [local])];
  for (const group of groups) {
    let gate = cache.groups.get(group);
    if (gate === undefined) {
      const posts = (signpostNetwork(world).get(player) ?? []).filter((p) => p.group === group);
      gate = reachGate(
        terrain,
        posts.map((p) => postReach(world, content, terrain, p.entity, p.hx, p.hy)),
      );
      cache.groups.set(group, gate);
    }
    gates.push(gate);
  }
  const bounds = {
    minX: Math.min(...gates.map((g) => g.bounds.minX)),
    maxX: Math.max(...gates.map((g) => g.bounds.maxX)),
    minY: Math.min(...gates.map((g) => g.bounds.minY)),
    maxY: Math.max(...gates.map((g) => g.bounds.maxY)),
  };
  const limit = {
    bounds,
    allowsNode: (node: Parameters<SpatialGate['allowsNode']>[0]) => gates.some((g) => g.allowsNode(node)),
  };
  if (cache.limits.size >= 256) cache.limits.clear();
  cache.limits.set(key, limit);
  return limit;
}

export interface SignpostReachPost {
  readonly id: number;
  readonly group: number;
  readonly area: ReachArea;
}
export interface SignpostReachView {
  readonly key: string;
  readonly player: number;
  readonly posts: readonly SignpostReachPost[];
  /** Building stock is reached at its door, not through its blocked body. */
  readonly doors: ReadonlyMap<number, { readonly hx: number; readonly hy: number }>;
  /** Local settlement searches also work before the first signpost is raised. */
  readonly settlements: readonly ReachArea[];
}

export function signpostReachView(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number,
): SignpostReachView {
  const cache = cacheOf(world, content, terrain);
  const held = cache.views.get(player);
  if (held !== undefined) return held;
  const posts = (signpostNetwork(world).get(player) ?? []).map((post) => ({
    id: post.entity,
    group: post.group,
    area: postReach(world, content, terrain, post.entity, post.hx, post.hy),
  }));
  const doors = new Map<number, { hx: number; hy: number }>();
  const settlements: ReachArea[] = [];
  for (const [entity, door] of doorsOf(world, content, terrain).entries) {
    if (door.player !== player) continue;
    doors.set(entity, door);
    if (posts.length === 0) settlements.push(goodsReachAt(world, content, terrain, door.hx, door.hy));
  }
  const view = { key: cache.key, player, posts, doors, settlements };
  cache.views.set(player, view);
  return view;
}
