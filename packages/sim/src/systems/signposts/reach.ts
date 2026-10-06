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
import { hexDistanceBetween } from '../../nav/halfcell.js';
import { type NodeBox, type SpatialGate, unionNodeBoxes } from '../../nav/node-circle.js';
import { type ReachArea, reachContains, reachGate } from '../../nav/range-search.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { interactionNode } from '../footprint/interaction.js';
import { type SignpostSite, signpostNetwork, signpostNetworkRevision } from './network.js';
import {
  dropFallenPostReaches,
  postTerrainReach,
  signpostTerrainKey,
  type TerrainReach,
  terrainReach,
} from './terrain-reach.js';

interface ReachCache {
  readonly terrain: TerrainGraph;
  readonly key: string;
  readonly spots: Map<string, TerrainReach>;
  readonly sites: TileBuckets<SignpostSite & { player: number }>;
  readonly groups: Map<number, GroupGate>;
  /** The previous key's group gates, taken over unchanged when their posts' searches still hold. */
  readonly priorGroups: ReadonlyMap<number, GroupGate>;
  readonly limits: Map<string, SpatialGate>;
  readonly views: Map<number, SignpostReachView>;
}
const caches = new WeakMap<World, ReachCache>();

/** A signpost group's coverage, the union of its posts' searches. */
interface GroupGate {
  readonly areas: readonly ReachArea[];
  readonly gate: SpatialGate;
}

/** Local searches held, about (2 * range - 1)^2 bytes each: enough that a settler re-planning from the
 *  spot it stands on finds its search again a scan beat later. */
const SPOT_REACH_CAP = 1024;

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
      spots: cache?.terrain === terrain ? cache.spots : new Map(),
      views: new Map(),
      sites,
      groups: new Map(),
      priorGroups: cache?.terrain === terrain ? cache.groups : new Map(),
      limits: new Map(),
    };
    caches.set(world, cache);
    dropFallenPostReaches(world);
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
  // Re-inserted on every read, so the map runs least recently asked first and eviction drops the oldest.
  if (held !== undefined) cache.spots.delete(key);
  else if (cache.spots.size >= SPOT_REACH_CAP) {
    for (const oldest of cache.spots.keys()) {
      cache.spots.delete(oldest);
      break;
    }
  }
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
  return postTerrainReach(world, content, terrain, id, hx, hy, GOODS_SEARCH_RANGE_NODES).area;
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
  const limit = new GoodsSearchLimit(world, content, terrain, cache, player, hx, hy);
  if (cache.limits.size >= 256) cache.limits.clear();
  cache.limits.set(key, limit);
  return limit;
}

/**
 * A spot's goods search: its own terrain search plus the signpost groups that search reaches. A caught
 * post lies strictly inside the hex range, so a node outside that range and outside every group with a
 * post inside it passes under no search result, and the search floods only when asked about another node.
 * A limit answers only under the reach key it was built under: asked after that key moved, it throws
 * rather than mix two worlds, since a client restored from a snapshot would resolve it differently.
 */
class GoodsSearchLimit implements SpatialGate {
  readonly bounds: NodeBox;
  /** Every group with a post inside the hex range: the ones the search may catch. */
  private readonly nearby: readonly SpatialGate[];
  private resolved: SpatialGate | undefined;
  /** The reach key the limit was built under, and the world mutation version it was last confirmed at. */
  private readonly key: string;
  private confirmedAt: number;

  constructor(
    private readonly world: World,
    private readonly content: ContentSet,
    private readonly terrain: TerrainGraph,
    cache: ReachCache,
    private readonly player: number,
    private readonly hx: number,
    private readonly hy: number,
  ) {
    this.key = cache.key;
    this.confirmedAt = world.mutationVersion;
    const range = GOODS_SEARCH_RANGE_NODES;
    // The local search's own result bounds.
    const own = {
      minX: Math.max(0, hx - range + 1),
      maxX: Math.min(terrain.width - 1, hx + range - 1),
      minY: Math.max(0, hy - range + 1),
      maxY: Math.min(terrain.height - 1, hy + range - 1),
    };
    const groups = new Set<number>();
    for (const p of postsWithin(cache, own)) {
      if (p.player === player && hexDistanceBetween(hx, hy, p.hx, p.hy) < range) groups.add(p.group);
    }
    this.nearby = [...groups].map((group) => groupGate(world, content, terrain, cache, player, group));
    this.bounds = unionNodeBoxes([own, ...this.nearby.map((g) => g.bounds)]);
  }

  allowsNode(node: NodeId): boolean {
    this.confirmKey();
    const x = this.terrain.xOf(node);
    const y = this.terrain.yOf(node);
    if (
      hexDistanceBetween(this.hx, this.hy, x, y) >= GOODS_SEARCH_RANGE_NODES &&
      !this.nearby.some((g) => g.allowsNode(node))
    ) {
      return false;
    }
    this.resolved ??= this.resolve();
    return this.resolved.allowsNode(node);
  }

  /** Hex distance obeys the triangle inequality and never exceeds Manhattan distance, so no node within
   *  Manhattan `radius` of `(x, y)` lies inside the hex range unless `(x, y)` lies inside the range
   *  widened by `radius`; a group's coverage is ruled out by its bounds widened the same way. */
  mayAllowNear(x: number, y: number, radius: number): boolean {
    this.confirmKey();
    if (hexDistanceBetween(this.hx, this.hy, x, y) < GOODS_SEARCH_RANGE_NODES + radius) return true;
    return this.nearby.some(
      ({ bounds: b }) =>
        x >= b.minX - radius && x <= b.maxX + radius && y >= b.minY - radius && y <= b.maxY + radius,
    );
  }

  /** Throws once a world write moved the reach key since the limit was built. */
  private confirmKey(): void {
    const version = this.world.mutationVersion;
    if (version === this.confirmedAt) return;
    if (signpostReachKey(this.world, this.content, this.terrain) !== this.key) {
      throw new Error('goods search limit asked after the signpost reach key moved; ask a fresh limit');
    }
    this.confirmedAt = version;
  }

  private resolve(): SpatialGate {
    const { world, content, terrain, player } = this;
    const cache = cacheOf(world, content, terrain);
    const local = goodsReachAt(world, content, terrain, this.hx, this.hy);
    const groups = new Set(
      postsWithin(cache, local)
        .filter((p) => p.player === player && reachContains(local, p.hx, p.hy))
        .map((p) => p.group),
    );
    const gates: SpatialGate[] = [reachGate(terrain, [local])];
    for (const group of groups) gates.push(groupGate(world, content, terrain, cache, player, group));
    return { bounds: this.bounds, allowsNode: (node) => gates.some((g) => g.allowsNode(node)) };
  }
}

/** The posts filed in the tiles over a node box, a superset of those inside it. */
function postsWithin(cache: ReachCache, box: NodeBox): (SignpostSite & { player: number })[] {
  return cache.sites.within({
    minX: box.minX / 2,
    maxX: box.maxX / 2,
    minY: box.minY / 2,
    maxY: box.maxY / 2,
  });
}

/** A group's coverage, reused across reach keys while every post search in it is the one held. */
function groupGate(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  cache: ReachCache,
  player: number,
  group: number,
): SpatialGate {
  let held = cache.groups.get(group);
  if (held === undefined) {
    const posts = (signpostNetwork(world).get(player) ?? []).filter((p) => p.group === group);
    const areas = posts.map((p) => postReach(world, content, terrain, p.entity, p.hx, p.hy));
    const prior = cache.priorGroups.get(group);
    held =
      prior !== undefined &&
      prior.areas.length === areas.length &&
      prior.areas.every((a, i) => a === areas[i])
        ? prior
        : { areas, gate: reachGate(terrain, areas) };
    cache.groups.set(group, held);
  }
  return held.gate;
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
