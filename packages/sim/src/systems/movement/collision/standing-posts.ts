import type { ContentSet } from '@open-northland/data';
import {
  Owner,
  PathFollow,
  PathRequest,
  Position,
  Settler,
  settlerTradeLog,
} from '../../../components/index.js';
import { insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { type NodeMoveFeed, watchNodeMoves } from '../../spatial/node-moves.js';
import { calmZonesByPlayer, isStanding } from './bodies.js';
import { hasBodyCollision, ownedFighters } from './owned-fighters.js';

/**
 * The nodes standing colliders block for routing, split by who is asking: every post blocks every collider
 * requester, except that a post inside its owner's calm zone is town garrison, which its own player routes
 * through while an enemy is steered around it. Membership-only and never hashed. A live view of the
 * per-world index: valid until the next read of it.
 */
export interface UnitWalkBlocks {
  /** Row-major posts per node, field and town alike, zero off every post. */
  readonly posts: Uint16Array;
  /** How many posts {@link posts} counts in total. */
  readonly postTotal: number;
  /** Per player with any, its own town posts per node: the share of {@link posts} that never blocks it. */
  readonly townByPlayer: ReadonlyMap<number, ReadonlyMap<NodeId, number>>;
  /** Per player with any, how many town posts {@link townByPlayer} counts for it. */
  readonly townTotalByPlayer: ReadonlyMap<number, number>;
}

/** The standing colliders by half-cell node, for a reader that needs the bodies rather than the counts. */
export interface StandingPostGrid {
  /** Append the posts on node `(hx, hy)`, on or off the lattice, to `out` from index `at` in ascending
   *  id, and return the new count. Valid until the next read of the index. */
  collect(hx: number, hy: number, out: Entity[], at: number): number;
}

/** One standing owned fighter, linked into its node's list so a shared node can name its highest id. */
interface Post {
  readonly entity: Entity;
  /** The half-cell node of its Position, on or off the lattice. */
  hx: number;
  hy: number;
  /** Undefined while it stands off the map, where it blocks nothing. */
  node: NodeId | undefined;
  player: number;
  /** Counted as town garrison under {@link PostIndex.zones}. */
  inTown: boolean;
  next: Post | undefined;
}

/**
 * Every standing owned fighter with a position, kept across ticks. A membership change of a store the
 * standing test reads, an in-place PathRequest or Owner write, or a logged trade change re-tests that
 * entity; a node change re-tests only an entity already standing, since moving cannot start a stand.
 */
interface PostIndex extends UnitWalkBlocks, StandingPostGrid {
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly feed: ChangeFeed;
  readonly moves: NodeMoveFeed;
  /** The calm zones the town tally follows, refreshed by walk-block reads only. */
  zones: ReadonlyMap<number, ReadonlySet<NodeId>>;
  readonly byEntity: Map<Entity, Post>;
  /** 1 at each id in {@link byEntity}: the per-entry test for the far more common node changes. */
  standingIds: Uint8Array;
  /** Each counted node's list of posts, ascending id. */
  readonly byNode: Map<NodeId, Post>;
  /** The posts standing off the lattice, ascending id. */
  readonly offMap: Post[];
  /** Each counted node's player: the highest id standing there. */
  readonly playerAt: Map<NodeId, number>;
  postTotal: number;
  readonly townByPlayer: Map<number, Map<NodeId, number>>;
  readonly townTotalByPlayer: Map<number, number>;
}

const indexes = new WeakMap<World, PostIndex>();
const postId = (post: Post): number => post.entity;

/** The zones a fresh index sorts by until a walk-block read hands it the real ones. */
const NO_ZONES: ReadonlyMap<number, ReadonlySet<NodeId>> = new Map();

/** The node, player and post count of every standing collider, brought up to date. */
function postIndex(world: World, content: ContentSet, terrain: TerrainGraph): PostIndex {
  const held = indexes.get(world);
  if (held === undefined || held.content !== content || held.terrain !== terrain) {
    return rebuild(world, content, terrain);
  }
  const restow = (e: Entity): void => restowPost(world, held, e);
  if (held.feed.drain(restow)) return rebuild(world, content, terrain);
  const moved = (e: Entity): void => {
    if (held.standingIds[e] === 1) restow(e);
  };
  if (held.moves.drain(moved)) return rebuild(world, content, terrain);
  const trades = settlerTradeLog(world, 'standingPosts');
  for (const e of trades) restow(e);
  trades.clear();
  return held;
}

function rebuild(world: World, content: ContentSet, terrain: TerrainGraph): PostIndex {
  const held = indexes.get(world);
  const feed =
    held?.feed ??
    world.watchChanges([Owner, Settler, Position, PathFollow, PathRequest], [PathRequest, Owner]);
  const moves = held?.moves ?? watchNodeMoves(world);
  feed.drain(() => {});
  moves.drain(() => {});
  settlerTradeLog(world, 'standingPosts').clear();
  let posts: Uint16Array;
  if (held !== undefined && held.terrain === terrain) {
    posts = held.posts;
    for (const node of held.byNode.keys()) posts[node] = 0;
  } else {
    posts = new Uint16Array(terrain.nodeCount);
  }
  const index: PostIndex = {
    collect: (hx, hy, out, at) => collectPosts(index, hx, hy, out, at),
    content,
    terrain,
    feed,
    moves,
    zones: held?.zones ?? NO_ZONES,
    posts,
    postTotal: 0,
    byEntity: new Map(),
    standingIds: new Uint8Array(world.nextEntityId),
    byNode: new Map(),
    offMap: [],
    playerAt: new Map(),
    townByPlayer: new Map(),
    townTotalByPlayer: new Map(),
  };
  for (const e of ownedFighters(world, content)) restowPost(world, index, e);
  if (held === undefined) world.registerCacheVerifier('standingPosts', () => verifyIndex(world));
  indexes.set(world, index);
  return index;
}

/** Re-test `e` and move, add or drop its post to match. */
function restowPost(world: World, index: PostIndex, e: Entity): void {
  const held = index.byEntity.get(e);
  const p = world.tryGet(e, Position);
  if (p === undefined || !isStanding(world, e) || !hasBodyCollision(world, index.content, e)) {
    if (held !== undefined) {
      unlink(index, held);
      index.byEntity.delete(e);
      index.standingIds[e] = 0;
    }
    return;
  }
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.y);
  const node = index.terrain.inBounds(hx, hy) ? index.terrain.nodeAt(hx, hy) : undefined;
  const player = world.get(e, Owner).player;
  if (held === undefined) {
    const post: Post = { entity: e, hx, hy, node, player, inTown: false, next: undefined };
    index.byEntity.set(e, post);
    if (e >= index.standingIds.length) index.standingIds = grownFlags(index.standingIds, e);
    index.standingIds[e] = 1;
    link(index, post);
  } else if (held.hx !== hx || held.hy !== hy || held.player !== player) {
    unlink(index, held);
    held.hx = hx;
    held.hy = hy;
    held.node = node;
    held.player = player;
    link(index, held);
  }
}

function grownFlags(flags: Uint8Array, e: Entity): Uint8Array {
  const next = new Uint8Array(Math.max(e + 1, flags.length * 2));
  next.set(flags);
  return next;
}

function link(index: PostIndex, post: Post): void {
  const { node } = post;
  if (node === undefined) {
    insertSortedById(index.offMap, post, postId);
    return;
  }
  index.posts[node] = (index.posts[node] ?? 0) + 1;
  index.postTotal++;
  const head = index.byNode.get(node);
  if (head === undefined || head.entity > post.entity) {
    post.next = head;
    index.byNode.set(node, post);
  } else {
    let at = head;
    while (at.next !== undefined && at.next.entity < post.entity) at = at.next;
    post.next = at.next;
    at.next = post;
  }
  settleNodePlayer(index, node);
  post.inTown = index.zones.get(post.player)?.has(node) ?? false;
  if (post.inTown) addTown(index, post.player, node, 1);
}

function unlink(index: PostIndex, post: Post): void {
  const { node } = post;
  if (node === undefined) {
    removeSortedById(index.offMap, post.entity, postId);
    return;
  }
  index.posts[node] = (index.posts[node] ?? 0) - 1;
  index.postTotal--;
  let head = index.byNode.get(node);
  if (head === post) {
    head = post.next;
  } else {
    for (let at = head; at !== undefined; at = at.next) {
      if (at.next === post) {
        at.next = post.next;
        break;
      }
    }
  }
  post.next = undefined;
  if (head === undefined) index.byNode.delete(node);
  else index.byNode.set(node, head);
  settleNodePlayer(index, node);
  if (post.inTown) addTown(index, post.player, node, -1);
  post.inTown = false;
}

/** Two soft-stacked bodies on one node keep the higher id's player: the list's last. */
function settleNodePlayer(index: PostIndex, node: NodeId): void {
  let top = index.byNode.get(node);
  if (top === undefined) {
    index.playerAt.delete(node);
    return;
  }
  while (top.next !== undefined) top = top.next;
  index.playerAt.set(node, top.player);
}

function collectPosts(index: PostIndex, hx: number, hy: number, out: Entity[], at: number): number {
  let count = at;
  if (index.terrain.inBounds(hx, hy)) {
    const node = index.terrain.nodeAt(hx, hy);
    if (index.posts[node] === 0) return count;
    for (let post = index.byNode.get(node); post !== undefined; post = post.next) out[count++] = post.entity;
    return count;
  }
  for (const post of index.offMap) if (post.hx === hx && post.hy === hy) out[count++] = post.entity;
  return count;
}

function addTown(index: PostIndex, player: number, node: NodeId, delta: number): void {
  let town = index.townByPlayer.get(player);
  if (town === undefined) {
    town = new Map();
    index.townByPlayer.set(player, town);
  }
  const count = (town.get(node) ?? 0) + delta;
  if (count === 0) town.delete(node);
  else town.set(node, count);
  const total = (index.townTotalByPlayer.get(player) ?? 0) + delta;
  if (total === 0) {
    index.townTotalByPlayer.delete(player);
    index.townByPlayer.delete(player);
  } else {
    index.townTotalByPlayer.set(player, total);
  }
}

/** Re-sort every post into field or town under new calm zones. */
function recountTown(index: PostIndex, zones: ReadonlyMap<number, ReadonlySet<NodeId>>): void {
  index.zones = zones;
  index.townByPlayer.clear();
  index.townTotalByPlayer.clear();
  for (const post of index.byEntity.values()) {
    post.inTown = post.node !== undefined && (zones.get(post.player)?.has(post.node) ?? false);
    if (post.inTown && post.node !== undefined) addTown(index, post.player, post.node, 1);
  }
}

/**
 * The nodes standing colliders occupy regardless of calm zones, each with the player standing there: an
 * approach cell someone already stands on is a taken melee slot even inside a town garrison. Two soft-
 * stacked bodies on one node keep the higher id's player. Membership-only; valid until the next read.
 */
export function standingFighterPosts(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): ReadonlyMap<NodeId, number> {
  return postIndex(world, content, terrain).playerAt;
}

/** The standing colliders by node, for the separation pass's firm movers. */
export function standingPostGrid(world: World, content: ContentSet, terrain: TerrainGraph): StandingPostGrid {
  return postIndex(world, content, terrain);
}

/** Only this read refreshes the calm zones, so a posts-only read never pays a zone rebuild. */
export function unitWalkBlocks(world: World, content: ContentSet, terrain: TerrainGraph): UnitWalkBlocks {
  const index = postIndex(world, content, terrain);
  const zones = calmZonesByPlayer(world, terrain);
  if (zones !== index.zones) recountTown(index, zones);
  return index;
}

/** A fresh scan of every standing collider in ascending id, the index's verifier's reference. */
function derivePosts(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  zones: ReadonlyMap<number, ReadonlySet<NodeId>>,
): FreshPosts {
  const counts = new Map<NodeId, number>();
  const playerAt = new Map<NodeId, number>();
  const town = new Map<number, Map<NodeId, number>>();
  const grid: Map<string, Entity[]> = new Map();
  for (const e of world.canonicalQuery(Owner, Settler)) {
    const p = world.tryGet(e, Position);
    if (p === undefined || !isStanding(world, e) || !hasBodyCollision(world, content, e)) continue;
    const hx = nodeHxOfPosition(p.x, p.y);
    const hy = nodeHyOfPosition(p.y);
    const key = nodeKey(hx, hy);
    const listed = grid.get(key);
    if (listed === undefined) grid.set(key, [e]);
    else listed.push(e);
    if (!terrain.inBounds(hx, hy)) continue;
    const node = terrain.nodeAt(hx, hy);
    const player = world.get(e, Owner).player;
    counts.set(node, (counts.get(node) ?? 0) + 1);
    playerAt.set(node, player);
    if (!zones.get(player)?.has(node)) continue;
    let own = town.get(player);
    if (own === undefined) {
      own = new Map();
      town.set(player, own);
    }
    own.set(node, (own.get(node) ?? 0) + 1);
  }
  return { counts, playerAt, town, grid };
}

interface FreshPosts {
  readonly counts: Map<NodeId, number>;
  readonly playerAt: Map<NodeId, number>;
  readonly town: Map<number, Map<NodeId, number>>;
  /** Each occupied node's posts in ascending id, keyed by {@link nodeKey}, on or off the lattice. */
  readonly grid: Map<string, Entity[]>;
}

const nodeKey = (hx: number, hy: number): string => `${hx},${hy}`;

/** Whether every node the index lists, on or off the lattice, collects exactly a fresh scan's posts. */
function sameGrid(index: PostIndex, fresh: ReadonlyMap<string, readonly Entity[]>): boolean {
  const listed = new Set<string>();
  for (const post of index.byEntity.values()) listed.add(nodeKey(post.hx, post.hy));
  if (listed.size !== fresh.size) return false;
  return [...fresh].every(([key, posts]) => {
    const [hx = 0, hy = 0] = key.split(',').map(Number);
    const out: Entity[] = [];
    out.length = index.collect(hx, hy, out, 0);
    return listed.has(key) && out.length === posts.length && out.every((e, i) => e === posts[i]);
  });
}

function sameCounts(a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

/** Brings the index up to date, then compares it with a fresh scan: a missed change shows up as a post
 *  the feeds never moved. */
function verifyIndex(world: World): string[] {
  const held = indexes.get(world);
  if (held === undefined) return [];
  const index = postIndex(world, held.content, held.terrain);
  const fresh = derivePosts(world, index.content, index.terrain, index.zones);
  const problems: string[] = [];
  let freshTotal = 0;
  for (const count of fresh.counts.values()) freshTotal += count;
  let countedNodes = 0;
  for (const count of index.posts) if (count > 0) countedNodes++;
  const countsSame = [...fresh.counts].every(([node, count]) => index.posts[node] === count);
  if (!countsSame || countedNodes !== fresh.counts.size || index.postTotal !== freshTotal) {
    problems.push(
      `standingPosts counts ${index.postTotal} posts on ${countedNodes} nodes, a scan ${freshTotal}`,
    );
  }
  if (index.byNode.size !== fresh.counts.size || !sameCounts(index.playerAt, fresh.playerAt)) {
    problems.push('standingPosts names another player or node list than a fresh scan');
  }
  const townSame =
    index.townByPlayer.size === fresh.town.size &&
    [...fresh.town].every(([player, town]) => {
      const own = index.townByPlayer.get(player);
      let total = 0;
      for (const count of town.values()) total += count;
      return own !== undefined && sameCounts(own, town) && index.townTotalByPlayer.get(player) === total;
    });
  if (!townSame) problems.push('standingPosts town garrison diverges from a fresh scan');
  if (!sameGrid(index, fresh.grid))
    problems.push('standingPosts collects other posts by node than a fresh scan');
  return problems;
}

/**
 * A collider requester's walk overlay: `dynamic` plus every post except its own player's town garrison.
 * A membership test is two array reads, touching the town map only on a post.
 */
export class ColliderWalkBlocks implements BlockOverlay {
  private readonly dynamic: BlockOverlay;
  private readonly posts: Uint16Array;
  private readonly ownTown: ReadonlyMap<NodeId, number> | undefined;
  readonly size: number;
  constructor(dynamic: BlockOverlay, units: UnitWalkBlocks, player: number) {
    this.dynamic = dynamic;
    this.posts = units.posts;
    this.ownTown = units.townByPlayer.get(player);
    // 0 exactly when nothing blocks this requester, which lets the search skip its pocket probe.
    this.size = dynamic.size + units.postTotal - (units.townTotalByPlayer.get(player) ?? 0);
  }
  has(node: NodeId): boolean {
    if (this.dynamic.has(node)) return true;
    const posts = this.posts[node] ?? 0;
    return posts > 0 && posts > (this.ownTown?.get(node) ?? 0);
  }
}
