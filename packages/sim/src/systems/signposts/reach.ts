import type { ContentSet } from '@open-northland/data';
import { Building, Owner, Position, signpostNavigationEnabled } from '../../components/index.js';
import type { ChangeFeed } from '../../ecs/change-feed.js';
import type { Entity, World } from '../../ecs/world.js';
import { type TileBox, TileBuckets } from '../../inspect/tile-buckets.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import { NO_WALK, type NodeBox, type SpatialGate } from '../../nav/node-circle.js';
import {
  type ReachArea,
  type ReachSearch,
  reachBox,
  reachContains,
  walkLengthTo,
} from '../../nav/range-search.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { walkStepsBetween } from '../../nav/walk-steps.js';
import { interactionNode } from '../footprint/interaction.js';
import { GroupCoverage } from './group-coverage.js';
import { type SignpostSite, signpostNetwork, signpostNetworkRevision, spotKey } from './network.js';
import {
  CARRIER_WALK_REACH_SHAPE,
  dropFallenPostReaches,
  GOODS_SEARCH_SHAPE,
  postTerrainReach,
  REACH_SHAPE_COUNT,
  type ReachShape,
  type ReachSpan,
  signpostMask,
  standingReach,
  type TerrainReach,
  terrainReach,
  WALK_REACH_SHAPE,
} from './terrain-reach.js';

/** What a cache's answers depend on beyond the terrain: the walk-block mask version, the mirrored road
 *  revision, the signpost network revision and the door revision. */
interface ReachVersions {
  readonly mask: number;
  readonly roads: number;
  readonly network: number;
  readonly doors: number;
}

interface ReachCache {
  readonly terrain: TerrainGraph;
  readonly versions: ReachVersions;
  /** Moves whenever the mask or road version does: the reading group coverages re-check posts against. */
  readonly epoch: number;
  readonly spots: Map<number, TerrainReach>;
  readonly network: NetworkReach;
  /** Kept across every version: a limit built under older versions is rebased onto the current ones,
   *  sharing its network-derived groups while its player's posts did not move. */
  readonly limits: GenerationalCache<ReachLimit>;
  readonly views: Map<number, SignpostReachView>;
  /** The world mutation version {@link versions} were last confirmed at; no version moves without a write. */
  confirmedAt: number;
}
const caches = new WeakMap<World, ReachCache>();

/** What derives from one signpost network revision, kept through mask, road and door changes. */
interface NetworkReach {
  readonly revision: number;
  readonly sites: TileBuckets<SignpostSite & { player: number }>;
  /** Each group's posts by group label, an entity id and so unique across players. */
  readonly groupPosts: ReadonlyMap<number, readonly SignpostSite[]>;
  /** Each group's coverage per reach shape, keyed by group label and shape id. */
  readonly coverages: Map<number, GroupCoverage>;
}

/** Local searches held, about (2 * range - 1)^2 bytes each: enough that a settler re-planning from the
 *  spot it stands on finds its search again a scan beat later. */
const SPOT_REACH_CAP = 1024;
/** Limits per cache generation, so at most twice this many are held: about the distinct spots a late
 *  15-seat game asks within a few hundred ticks. A limit is a few references over a held local search and
 *  shared group coverages, so this bounds the local searches limits keep alive past {@link SPOT_REACH_CAP}.
 *  Measured on the 15-seat piec_dolin bench, 2000 ticks from tick 90000: heap at end 554 MB, RSS peak
 *  1171 MB. */
const LIMIT_GENERATION_CAP = 4096;

/**
 * A bounded memo keeping what was asked within the last two generations of `cap` insertions: a read
 * promotes an old entry, and a full young generation retires the old one whole. Unlike a recency-ordered
 * map, a hit neither deletes nor reinserts, so reads churn no hash table.
 */
export class GenerationalCache<V> {
  private young = new Map<number, V>();
  private old = new Map<number, V>();

  constructor(private readonly cap: number) {}

  get(key: number): V | undefined {
    const recent = this.young.get(key);
    if (recent !== undefined) return recent;
    const aged = this.old.get(key);
    if (aged !== undefined) this.set(key, aged);
    return aged;
  }

  /** A stale copy left in the old generation is shadowed by the young one until it retires. */
  set(key: number, value: V): void {
    if (this.young.size >= this.cap && !this.young.has(key)) {
      const retired = this.old;
      this.old = this.young;
      retired.clear();
      this.young = retired;
    }
    this.young.set(key, value);
  }
}

interface DoorEntry {
  readonly player: number;
  readonly hx: number;
  readonly hy: number;
}

interface Doors {
  readonly feed: ChangeFeed;
  readonly entries: Map<Entity, DoorEntry>;
  /** The same doors per player, bucketed by tile, so a box query walks one player's doors near it. */
  readonly byPlayer: Map<number, TileBuckets<Entity>>;
  revision: number;
  /** What the last read resolved doors against; the verifier re-derives with the same pair. */
  content: ContentSet;
  terrain: TerrainGraph;
  /** Brings one building's entry in line with the world. */
  readonly refresh: (id: Entity) => void;
}
const doorCaches = new WeakMap<World, Doors>();
function doorsOf(world: World, content: ContentSet, terrain: TerrainGraph): Doors {
  let held = doorCaches.get(world);
  if (held === undefined) {
    const made: Doors = {
      // A placed building never changes Position (only humans and vehicles teleport), so a Position
      // value feed would only record every walker on every step; the verifier below guards the rule.
      feed: world.watchChanges([Building, Position, Owner], [Building, Owner]),
      entries: new Map(),
      byPlayer: new Map(),
      revision: 0,
      content,
      terrain,
      refresh: (id) => refreshDoor(world, made, id),
    };
    made.feed.lose();
    doorCaches.set(world, made);
    world.registerCacheVerifier('signpostDoors', () => verifyDoors(world, made));
    held = made;
  }
  held.content = content;
  held.terrain = terrain;
  if (held.feed.drain(held.refresh)) {
    const ids = new Set([...held.entries.keys(), ...world.query(Building, Position, Owner)]);
    for (const id of ids) held.refresh(id);
  }
  return held;
}

function dropDoor(doors: Doors, id: Entity, old: DoorEntry | undefined): void {
  if (old === undefined) return;
  doors.entries.delete(id);
  doors.byPlayer.get(old.player)?.delete(id);
  doors.revision++;
}

/** Bring `id`'s entry in line with the world. */
function refreshDoor(world: World, doors: Doors, id: Entity): void {
  const old = doors.entries.get(id);
  if (!world.has(id, Building)) {
    dropDoor(doors, id, old);
    return;
  }
  const player = world.tryGet(id, Owner)?.player;
  const door = interactionNode(world, { content: doors.content, terrain: doors.terrain }, id);
  if (player === undefined || door === null) {
    dropDoor(doors, id, old);
  } else if (old?.player !== player || old.hx !== door.x || old.hy !== door.y) {
    if (old !== undefined && old.player !== player) doors.byPlayer.get(old.player)?.delete(id);
    doors.entries.set(id, { player, hx: door.x, hy: door.y });
    let buckets = doors.byPlayer.get(player);
    if (buckets === undefined) {
      buckets = new TileBuckets();
      doors.byPlayer.set(player, buckets);
    }
    buckets.set(id, id, door.x / 2, door.y / 2);
    doors.revision++;
  }
}

/** Every owned building's door must match its entry unless a change of it awaits the next read. */
function verifyDoors(world: World, doors: Doors): string[] {
  const pending = new Set<Entity>();
  if (doors.feed.peek((id) => pending.add(id))) return [];
  const ctx = { content: doors.content, terrain: doors.terrain };
  const problems: string[] = [];
  const seen = new Set<Entity>();
  for (const id of world.query(Building, Position, Owner)) {
    seen.add(id);
    if (pending.has(id)) continue;
    const door = interactionNode(world, ctx, id);
    const player = world.get(id, Owner).player;
    const entry = doors.entries.get(id);
    if (door === null) {
      if (entry !== undefined) problems.push(`signpostDoors lists building ${id} without a door`);
    } else if (entry === undefined || entry.player !== player || entry.hx !== door.x || entry.hy !== door.y) {
      problems.push(
        `signpostDoors holds a stale door for building ${id} (player ${player} at ${door.x},${door.y})`,
      );
    }
  }
  let bucketed = 0;
  for (const buckets of doors.byPlayer.values()) bucketed += buckets.size;
  if (bucketed !== doors.entries.size)
    problems.push(`signpostDoors buckets ${bucketed} doors for ${doors.entries.size} entries`);
  for (const [id, entry] of doors.entries) {
    if (doors.byPlayer.get(entry.player)?.has(id) !== true)
      problems.push(`signpostDoors misses building ${id} in player ${entry.player}'s buckets`);
    if (!seen.has(id) && !pending.has(id))
      problems.push(`signpostDoors lists ${id}, which is no owned building`);
  }
  return problems;
}

export function signpostReachKey(world: World, content: ContentSet, terrain: TerrainGraph): string {
  return reachKeyOf(reachVersions(world, content, terrain));
}

function reachKeyOf(v: ReachVersions): string {
  return `${v.mask}:${v.roads}:${v.network}:${v.doors}`;
}

/** Whether `v` still names the world's current versions, read without building a key. */
function versionsHold(v: ReachVersions, world: World, content: ContentSet, terrain: TerrainGraph): boolean {
  return (
    v.mask === signpostMask(world, content, terrain).version &&
    v.roads === terrain.mirroredRoadRevision &&
    v.network === signpostNetworkRevision(world) &&
    v.doors === doorsOf(world, content, terrain).revision
  );
}

function reachVersions(world: World, content: ContentSet, terrain: TerrainGraph): ReachVersions {
  return {
    mask: signpostMask(world, content, terrain).version,
    roads: terrain.mirroredRoadRevision,
    network: signpostNetworkRevision(world),
    doors: doorsOf(world, content, terrain).revision,
  };
}

function cacheOf(world: World, content: ContentSet, terrain: TerrainGraph): ReachCache {
  let cache = caches.get(world);
  const mutation = world.mutationVersion;
  if (cache?.terrain === terrain && cache.confirmedAt === mutation) return cache;
  if (
    cache === undefined ||
    cache.terrain !== terrain ||
    !versionsHold(cache.versions, world, content, terrain)
  ) {
    const versions = reachVersions(world, content, terrain);
    const held = cache?.terrain === terrain ? cache : undefined;
    let network = held?.network;
    if (network?.revision !== versions.network) {
      network = networkReach(world, versions.network, network);
      dropFallenPostReaches(world);
    }
    const reread =
      held !== undefined && (held.versions.mask !== versions.mask || held.versions.roads !== versions.roads);
    cache = {
      terrain,
      versions,
      epoch: held === undefined ? 0 : held.epoch + (reread ? 1 : 0),
      spots: held?.spots ?? new Map(),
      network,
      views: new Map(),
      limits: held?.limits ?? new GenerationalCache(LIMIT_GENERATION_CAP),
      confirmedAt: mutation,
    };
    caches.set(world, cache);
  }
  cache.confirmedAt = mutation;
  return cache;
}

/** The network's site buckets and groups, taking over each coverage of `prior` whose group kept the
 *  same posts on the same nodes, since its counts derive from those posts' searches alone. */
function networkReach(world: World, revision: number, prior: NetworkReach | undefined): NetworkReach {
  const sites = new TileBuckets<SignpostSite & { player: number }>();
  const groupPosts = new Map<number, SignpostSite[]>();
  for (const [player, posts] of signpostNetwork(world)) {
    for (const p of posts) {
      sites.set(p.entity, { ...p, player }, p.hx / 2, p.hy / 2);
      let members = groupPosts.get(p.group);
      if (members === undefined) {
        members = [];
        groupPosts.set(p.group, members);
      }
      members.push(p);
    }
  }
  const coverages = new Map<number, GroupCoverage>();
  for (const [key, coverage] of prior?.coverages ?? []) {
    const posts = groupPosts.get(Math.floor(key / REACH_SHAPE_COUNT));
    if (posts !== undefined && samePosts(coverage.posts, posts)) coverages.set(key, coverage);
  }
  return { revision, sites, groupPosts, coverages };
}

function samePosts(a: readonly SignpostSite[], b: readonly SignpostSite[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i] as SignpostSite;
    const q = b[i] as SignpostSite;
    if (p.entity !== q.entity || p.hx !== q.hx || p.hy !== q.hy) return false;
  }
  return true;
}

export function goodsReachAt(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  hx: number,
  hy: number,
): ReachArea {
  return spotReachAt(world, content, terrain, hx, hy, GOODS_SEARCH_SHAPE).area;
}

/** The search of `shape` from the spot itself, held per spot and shape. */
function spotReachAt(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  hx: number,
  hy: number,
  shape: ReachShape,
): ReachSearch {
  const cache = cacheOf(world, content, terrain);
  const key = spotKey(terrain, shape.id, hx, hy);
  const held = key === null ? undefined : cache.spots.get(key);
  const found = terrainReach(world, content, terrain, hx, hy, shape.own, held);
  if (key === null) return found;
  // Re-inserted on every read, so the map runs least recently asked first and eviction drops the oldest.
  if (held !== undefined) cache.spots.delete(key);
  else if (cache.spots.size >= SPOT_REACH_CAP) {
    for (const oldest of cache.spots.keys()) {
      cache.spots.delete(oldest);
      break;
    }
  }
  cache.spots.set(key, found);
  return found;
}

/** The spot's held search of `shape` while no node it read changed since, without flooding for one. */
function heldSpotReach(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  hx: number,
  hy: number,
  shape: ReachShape,
): ReachSearch | undefined {
  const key = spotKey(terrain, shape.id, hx, hy);
  const held = key === null ? undefined : cacheOf(world, content, terrain).spots.get(key);
  return held === undefined ? undefined : standingReach(world, content, terrain, held);
}

function postReach(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  id: Entity,
  hx: number,
  hy: number,
  span: ReachSpan,
): ReachArea {
  return postTerrainReach(world, content, terrain, id, hx, hy, span).area;
}

/** Goods are discovered locally or through the connected guides reached by the same local search. */
export function goodsSearchLimitAt(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number | undefined,
  hx: number,
  hy: number,
): GoodsSearchLimit | null {
  if (!signpostNavigationEnabled(world) || player === undefined) return null;
  return reachLimitAt(world, content, terrain, player, hx, hy, GOODS_SEARCH_SHAPE);
}

/** A goods search as a gate: it spends ground resistance, so it measures no walk. */
export interface GoodsSearchLimit extends SpatialGate {
  mayAllowNear(x: number, y: number, radius: number): boolean;
  /** The flood-free half of `allowsNode`: inside the hex range or under a caught group. */
  catchesNode(node: NodeId): boolean;
  /** The player's network list the search's groups derive from. */
  readonly sites: readonly SignpostSite[] | undefined;
}

/**
 * Where a settler of `player` standing on `(hx, hy)` may walk, a `carrier` over its longer range: a goal
 * a walk of bounded length reaches from the spot, or from a post of a signpost group such a walk catches.
 * Null on a spot no walk starts from, a blocked or unwalkable node, which the caller judges by distance.
 *
 * Source basis: the original plans a leg with a bounded directed search from the current position, else
 * through a guide its walkable search catches near the start and one near the goal in the same link
 * system. Approximations: one step-counted flood stands for both searches, and every caught group opens
 * where the original weighs the two nearest guides on each side.
 */
export function walkReachLimitAt(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number,
  hx: number,
  hy: number,
  carrier: boolean,
): WalkReach | null {
  if (!floodMayEnter(world, content, terrain, hx, hy)) return null;
  const shape = carrier ? CARRIER_WALK_REACH_SHAPE : WALK_REACH_SHAPE;
  return reachLimitAt(world, content, terrain, player, hx, hy, shape);
}

/** Whether a flood can mark node `(x, y)` and start from it: unblocked, with nonzero resistance. */
export function floodMayEnter(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  x: number,
  y: number,
): boolean {
  if (!terrain.inBounds(x, y)) return false;
  const node = terrain.nodeAt(x, y);
  // A walkable node's flood entry resistance is its resistanceAt; any other node's is zero.
  return (
    terrain.isWalkable(node) &&
    terrain.resistanceAt(node) !== 0 &&
    !signpostMask(world, content, terrain).has(node)
  );
}

/** A walk reach that also tells how long the walk from its spot is. */
export interface WalkReach extends SpatialGate {
  /** The steps of the spot's own walk to `(x, y)` when at most `within`, else {@link NO_WALK}: a node
   *  reached only through a signpost group has no length. */
  ownWalkSteps(x: number, y: number, within: number): number;
}

/** Nodes a search for one walk length settles before the spot's own flood answers instead: a walk round
 *  an obstacle, or none at all. Performance knob: both give the same length. */
const WALK_SEARCH_MAX_SETTLED = 1024;

function reachLimitAt(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number,
  hx: number,
  hy: number,
  shape: ReachShape,
): ReachLimit {
  const cache = cacheOf(world, content, terrain);
  const key = spotKey(terrain, player * REACH_SHAPE_COUNT + shape.id, hx, hy);
  const held = key === null ? undefined : cache.limits.get(key);
  if (held?.builtUnder(cache)) return held;
  const sites = signpostNetwork(world).get(player);
  const made =
    held !== undefined && held.sites === sites
      ? held.rebased(cache)
      : new ReachLimit(
          {
            world,
            content,
            terrain,
            hx,
            hy,
            shape,
            sites,
            groups: limitGroups(world, content, terrain, cache, player, hx, hy, shape),
          },
          cache,
        );
  if (key !== null) cache.limits.set(key, made);
  return made;
}

/** Whether a door of one of `player`'s buildings, finished or not, lies under both goods searches. Only
 *  the player's doors bucketed inside both searches' boxes are asked. The answer reads only what
 *  {@link signpostReachKey} versions. */
export function goodsSearchesShareDoor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number,
  a: SpatialGate,
  b: SpatialGate,
): boolean {
  const box: NodeBox = {
    minX: Math.max(a.bounds.minX, b.bounds.minX),
    maxX: Math.min(a.bounds.maxX, b.bounds.maxX),
    minY: Math.max(a.bounds.minY, b.bounds.minY),
    maxY: Math.min(a.bounds.maxY, b.bounds.maxY),
  };
  if (box.minX > box.maxX || box.minY > box.maxY) return false;
  const doors = doorsOf(world, content, terrain);
  const buckets = doors.byPlayer.get(player);
  if (buckets === undefined) return false;
  const end = buckets.collect(tileBoxOf(box), doorScratch);
  for (let i = 0; i < end; i++) {
    const door = doors.entries.get(doorScratch[i] as Entity);
    if (door === undefined) continue;
    if (door.hx < box.minX || door.hx > box.maxX || door.hy < box.minY || door.hy > box.maxY) continue;
    const node = terrain.nodeAt(door.hx, door.hy);
    if (a.allowsNode(node) && b.allowsNode(node)) return true;
  }
  return false;
}

/** The doors {@link goodsSearchesShareDoor} last collected; slots past its end hold stale entries. */
const doorScratch: Entity[] = [];

/**
 * {@link goodsSearchLimitAt} without its terrain flood: a node passes inside hex range of the spot or under
 * a group caught by that range. The flood is the one cost that grows with distinct spots, so a read that
 * asks for thousands of spots per click takes this half and over-lists what lies across water or walls
 * inside the range. Null where {@link goodsSearchLimitAt} is.
 */
export function goodsSearchCatchAt(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number | undefined,
  hx: number,
  hy: number,
): SpatialGate | null {
  const limit = goodsSearchLimitAt(world, content, terrain, player, hx, hy);
  if (limit === null) return null;
  return { bounds: limit.bounds, allowsNode: (node) => limit.catchesNode(node) };
}

/**
 * A spot's goods search or walk reach under a {@link ReachShape}: its own terrain search plus the signpost
 * groups that search reaches. A caught post lies strictly inside the catch range, so a node outside the
 * own range and outside every group with a post inside the catch range passes under no search result.
 * The own search floods only for a node inside the range that no caught group covers, or for a walk
 * length a search towards the node leaves undecided.
 *
 * Whether a group is caught is read off its posts' held floods: the own flood marks post `p` exactly when
 * `p`'s flood marks the spot, while both nodes are unblocked with nonzero resistance. A flood marks a
 * node once it enters a neighbour of it under budget, and a path's cost sums the resistances of the nodes
 * it enters after its start, so the reversed path, ending next to the other end, costs the same. A spot
 * failing that test resolves through its own flood.
 *
 * A limit answers only under the reach key it was built under: asked after that key moved, it throws
 * rather than mix two worlds, since a client restored from a snapshot would resolve it differently.
 */
class ReachLimit implements WalkReach {
  /** Per nearby group, whether the own search catches it, once asked; made on the first ask, since most
   *  rebased limits are never asked. */
  private caught: boolean[] | undefined;
  private local: ReachSearch | undefined;
  /** {@link heldFlood}'s answer, null for none; undefined until asked. */
  private held: ReachSearch | null | undefined;
  /** The reach versions and epoch the limit was built under, and the world mutation version it was last
   *  confirmed at. */
  private readonly versions: ReachVersions;
  private readonly epoch: number;
  private confirmedAt: number;

  constructor(
    /** What the limit asks about, shared by every limit rebased from it. */
    private readonly spot: LimitSpot,
    cache: ReachCache,
  ) {
    this.versions = cache.versions;
    this.epoch = cache.epoch;
    this.confirmedAt = spot.world.mutationVersion;
  }

  get bounds(): NodeBox {
    return this.spot.groups.bounds;
  }

  /** The player's network list the groups derive from; the network keeps a list's identity while its
   *  posts stay put, so an unchanged list keeps the groups valid. */
  get sites(): readonly SignpostSite[] | undefined {
    return this.spot.sites;
  }

  /** Whether the limit answers under `cache`'s current versions as built. */
  builtUnder(cache: ReachCache): boolean {
    return this.versions === cache.versions;
  }

  /** This spot's limit under `cache`'s versions, for a network still listing {@link sites}: the groups
   *  depend on the player's posts alone, while the searches and catches are asked afresh. */
  rebased(cache: ReachCache): ReachLimit {
    return new ReachLimit(this.spot, cache);
  }

  allowsNode(node: NodeId): boolean {
    this.confirmKey();
    const x = this.spot.terrain.xOf(node);
    const y = this.spot.terrain.yOf(node);
    const inRange = hexDistanceBetween(this.spot.hx, this.spot.hy, x, y) < this.spot.shape.own.range;
    if (this.local !== undefined && reachContains(this.local.area, x, y)) return true;
    const nearby = this.spot.groups.nearby;
    for (let i = 0; i < nearby.length; i++)
      if ((nearby[i] as GroupCoverage).covers(x, y, this.epoch) && this.catches(i)) return true;
    // The own flood marks nothing outside the hex range.
    return inRange && reachContains(this.ownSearch().area, x, y);
  }

  /** The flood-free half of {@link allowsNode}: inside the hex range or under a caught group. */
  catchesNode(node: NodeId): boolean {
    this.confirmKey();
    const x = this.spot.terrain.xOf(node);
    const y = this.spot.terrain.yOf(node);
    return (
      hexDistanceBetween(this.spot.hx, this.spot.hy, x, y) < this.spot.shape.own.range ||
      this.nearbyCovers(x, y)
    );
  }

  private nearbyCovers(x: number, y: number): boolean {
    const nearby = this.spot.groups.nearby;
    for (let i = 0; i < nearby.length; i++)
      if ((nearby[i] as GroupCoverage).covers(x, y, this.epoch)) return true;
    return false;
  }

  /** Hex distance obeys the triangle inequality and never exceeds Manhattan distance, so no node within
   *  Manhattan `radius` of `(x, y)` lies inside the hex range unless `(x, y)` lies inside the range
   *  widened by `radius`; a group's coverage is ruled out by its bounds widened the same way. */
  mayAllowNear(x: number, y: number, radius: number): boolean {
    this.confirmKey();
    const near = this.spot.groups.reaches;
    if (x < near.minX - radius || x > near.maxX + radius || y < near.minY - radius || y > near.maxY + radius)
      return false;
    if (hexDistanceBetween(this.spot.hx, this.spot.hy, x, y) < this.spot.shape.own.range + radius)
      return true;
    const nearby = this.spot.groups.nearby;
    for (let i = 0; i < nearby.length; i++) {
      const b = (nearby[i] as GroupCoverage).bounds;
      if (x >= b.minX - radius && x <= b.maxX + radius && y >= b.minY - radius && y <= b.maxY + radius)
        return true;
    }
    return false;
  }

  /** Throws once a world write moved the reach key since the limit was built. */
  private confirmKey(): void {
    const version = this.spot.world.mutationVersion;
    if (version === this.confirmedAt) return;
    if (!versionsHold(this.versions, this.spot.world, this.spot.content, this.spot.terrain)) {
      throw new Error('reach limit asked after the signpost reach key moved; ask a fresh limit');
    }
    this.confirmedAt = version;
  }

  /** Read off the own flood when one is at hand, the limit's or the spot's held one, else searched for
   *  towards the node, which on open ground costs a walk's length where the flood costs its whole area. */
  ownWalkSteps(x: number, y: number, within: number): number {
    this.confirmKey();
    const { world, content, terrain, hx, hy, shape } = this.spot;
    const asked = Math.min(within, shape.own.budget);
    let flood = this.local ?? this.heldFlood();
    if (flood === undefined) {
      const blocked = signpostMask(world, content, terrain).levelled();
      const found = walkStepsBetween(terrain, blocked, hx, hy, x, y, asked, WALK_SEARCH_MAX_SETTLED);
      if (found !== undefined) return found;
      flood = this.ownSearch();
    }
    const steps = walkLengthTo(flood.costs, x, y);
    return steps > asked ? NO_WALK : steps;
  }

  /** The spot's flood an earlier limit left held, when it still answers as it stands; looked for once,
   *  since the limit answers under one reach key. */
  private heldFlood(): ReachSearch | undefined {
    if (this.held === undefined) {
      const { world, content, terrain, hx, hy, shape } = this.spot;
      this.held = heldSpotReach(world, content, terrain, hx, hy, shape) ?? null;
    }
    return this.held ?? undefined;
  }

  private ownSearch(): ReachSearch {
    this.local ??= spotReachAt(
      this.spot.world,
      this.spot.content,
      this.spot.terrain,
      this.spot.hx,
      this.spot.hy,
      this.spot.shape,
    );
    return this.local;
  }

  /** Whether the own search marks a post of nearby group `i`. */
  private catches(i: number): boolean {
    this.caught ??= [];
    const known = this.caught[i];
    if (known !== undefined) return known;
    const posts = this.spot.groups.nearbyPosts[i] as readonly SignpostSite[];
    let caught = false;
    const { world, content, terrain, shape } = this.spot;
    if (this.local === undefined && floodMayEnter(world, content, terrain, this.spot.hx, this.spot.hy)) {
      for (let k = 0; k < posts.length && !caught; k++) {
        const p = posts[k] as SignpostSite;
        if (!floodMayEnter(world, content, terrain, p.hx, p.hy)) continue;
        const reach = postReach(world, content, terrain, p.entity, p.hx, p.hy, shape.post);
        caught = reachContains(reach, this.spot.hx, this.spot.hy);
      }
    } else {
      const local = this.ownSearch().area;
      for (let k = 0; k < posts.length && !caught; k++) {
        const p = posts[k] as SignpostSite;
        caught = reachContains(local, p.hx, p.hy);
      }
    }
    this.caught[i] = caught;
    return caught;
  }
}

/** A limit's spot and what it derives from the signpost network alone, kept across rebases. */
interface LimitSpot {
  readonly world: World;
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly hx: number;
  readonly hy: number;
  readonly shape: ReachShape;
  readonly sites: readonly SignpostSite[] | undefined;
  readonly groups: LimitGroups;
}

/** What a spot's limit derives from the signpost network alone. */
interface LimitGroups {
  readonly bounds: NodeBox;
  /** The hex range's box, not clamped to the map, joined with each nearby group's bounds: a node outside
   *  it lies neither inside the hex range nor inside a nearby group's bounds. */
  readonly reaches: NodeBox;
  /** Every group with a post inside the catch range: the ones the search may catch. */
  readonly nearby: readonly GroupCoverage[];
  /** Per {@link nearby} group, its posts inside the catch range. */
  readonly nearbyPosts: readonly (readonly SignpostSite[])[];
}

function limitGroups(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  cache: ReachCache,
  player: number,
  hx: number,
  hy: number,
  shape: ReachShape,
): LimitGroups {
  const range = shape.own.range;
  const own = reachBox(terrain, hx, hy, range);
  const end = cache.network.sites.collect(tileBoxOf(own), postScratch);
  // Groups in the order their first post was collected; a spot catches a handful, so a scan beats a map.
  const nearby = nearbyScratch;
  const nearbyPosts = nearbyPostsScratch;
  for (let g = 0; g < nearbyPosts.length; g++) (nearbyPosts[g] as SignpostSite[]).length = 0;
  let count = 0;
  let { minX, maxX, minY, maxY } = own;
  let nearMinX = hx - range + 1;
  let nearMaxX = hx + range - 1;
  let nearMinY = hy - range + 1;
  let nearMaxY = hy + range - 1;
  for (let i = 0; i < end; i++) {
    const p = postScratch[i] as SignpostSite & { player: number };
    if (p.player !== player || hexDistanceBetween(hx, hy, p.hx, p.hy) >= shape.catchRange) continue;
    let g = 0;
    while (g < count && (nearbyPosts[g] as SignpostSite[])[0]?.group !== p.group) g++;
    if (g < count) {
      (nearbyPosts[g] as SignpostSite[]).push(p);
      continue;
    }
    const coverage = coverageOf(world, content, terrain, cache, p.group, shape);
    nearby[count] = coverage;
    nearbyPosts[count] ??= [];
    (nearbyPosts[count] as SignpostSite[]).push(p);
    count++;
    const b = coverage.bounds;
    if (b.minX < minX) minX = b.minX;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxY > maxY) maxY = b.maxY;
    if (b.minX < nearMinX) nearMinX = b.minX;
    if (b.maxX > nearMaxX) nearMaxX = b.maxX;
    if (b.minY < nearMinY) nearMinY = b.minY;
    if (b.maxY > nearMaxY) nearMaxY = b.maxY;
  }
  // Copied out of the scratch at their own length, since a spot holds its groups while its network stands.
  const groups: LimitGroups = {
    bounds: { minX, maxX, minY, maxY },
    reaches: { minX: nearMinX, maxX: nearMaxX, minY: nearMinY, maxY: nearMaxY },
    nearby: nearby.slice(0, count),
    nearbyPosts: sizedPostsOf(nearbyPosts, count),
  };
  nearby.length = 0;
  for (let g = 0; g < count; g++) (nearbyPosts[g] as SignpostSite[]).length = 0;
  return groups;
}

/** Copies of the first `count` post lists, each at its own length. */
function sizedPostsOf(posts: readonly (readonly SignpostSite[])[], count: number): SignpostSite[][] {
  const sized = posts.slice(0, count) as SignpostSite[][];
  for (let g = 0; g < count; g++) sized[g] = (posts[g] as readonly SignpostSite[]).slice();
  return sized;
}

/** {@link limitGroups}'s nearby groups and their posts while it collects them, emptied before it returns;
 *  a post list slot is kept for the next spot. */
const nearbyScratch: GroupCoverage[] = [];
const nearbyPostsScratch: SignpostSite[][] = [];

/** The posts {@link limitGroups} last collected; slots past its end hold stale entries. */
const postScratch: (SignpostSite & { player: number })[] = [];

/** The tile box over a node box, whose buckets file a superset of the posts inside it. */
function tileBoxOf(box: NodeBox): TileBox {
  return { minX: box.minX / 2, maxX: box.maxX / 2, minY: box.minY / 2, maxY: box.maxY / 2 };
}

/** A group's coverage, kept while the network holds. */
function coverageOf(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  cache: ReachCache,
  group: number,
  shape: ReachShape,
): GroupCoverage {
  const key = group * REACH_SHAPE_COUNT + shape.id;
  let coverage = cache.network.coverages.get(key);
  if (coverage === undefined) {
    const posts = cache.network.groupPosts.get(group) ?? [];
    coverage = new GroupCoverage(world, content, terrain, posts, shape.post);
    cache.network.coverages.set(key, coverage);
  }
  return coverage;
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
    area: postReach(world, content, terrain, post.entity, post.hx, post.hy, GOODS_SEARCH_SHAPE.post),
  }));
  const doors = new Map<number, { hx: number; hy: number }>();
  const settlements: ReachArea[] = [];
  for (const [entity, door] of doorsOf(world, content, terrain).entries) {
    if (door.player !== player) continue;
    doors.set(entity, door);
    if (posts.length === 0) settlements.push(goodsReachAt(world, content, terrain, door.hx, door.hy));
  }
  const view = { key: reachKeyOf(cache.versions), player, posts, doors, settlements };
  cache.views.set(player, view);
  return view;
}
