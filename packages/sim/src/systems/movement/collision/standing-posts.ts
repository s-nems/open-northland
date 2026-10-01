import type { ContentSet } from '@open-northland/data';
import {
  Owner,
  PathFollow,
  PathRequest,
  Position,
  Settler,
  settlerTradeLog,
} from '../../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
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

/** One standing owned fighter, linked into its node's list so a shared node can name its highest id. */
interface Post {
  readonly entity: Entity;
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
 * entity; a Position write re-tests only an entity already standing, since moving cannot start a stand.
 */
interface PostIndex extends UnitWalkBlocks {
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly feed: ChangeFeed;
  readonly moves: ChangeFeed;
  /** The calm zones the town tally follows, refreshed by walk-block reads only. */
  zones: ReadonlyMap<number, ReadonlySet<NodeId>>;
  readonly byEntity: Map<Entity, Post>;
  /** 1 at each id in {@link byEntity}: the per-write test for the far more common Position writes. */
  standingIds: Uint8Array;
  /** Each counted node's list of posts, newest first. */
  readonly byNode: Map<NodeId, Post>;
  /** Each counted node's player: the highest id standing there. */
  readonly playerAt: Map<NodeId, number>;
  postTotal: number;
  readonly townByPlayer: Map<number, Map<NodeId, number>>;
  readonly townTotalByPlayer: Map<number, number>;
}

const indexes = new WeakMap<World, PostIndex>();

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
  const moves = held?.moves ?? world.watchChanges([], [Position]);
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
    const post: Post = { entity: e, node, player, inTown: false, next: undefined };
    index.byEntity.set(e, post);
    if (e >= index.standingIds.length) index.standingIds = grownFlags(index.standingIds, e);
    index.standingIds[e] = 1;
    link(index, post);
  } else if (held.node !== node || held.player !== player) {
    unlink(index, held);
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
  if (node === undefined) return;
  index.posts[node] = (index.posts[node] ?? 0) + 1;
  index.postTotal++;
  post.next = index.byNode.get(node);
  index.byNode.set(node, post);
  settleNodePlayer(index, node);
  post.inTown = index.zones.get(post.player)?.has(node) ?? false;
  if (post.inTown) addTown(index, post.player, node, 1);
}

function unlink(index: PostIndex, post: Post): void {
  const { node } = post;
  if (node === undefined) return;
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

/** Two soft-stacked bodies on one node keep the higher id's player. */
function settleNodePlayer(index: PostIndex, node: NodeId): void {
  let top = index.byNode.get(node);
  if (top === undefined) {
    index.playerAt.delete(node);
    return;
  }
  for (let at = top.next; at !== undefined; at = at.next) if (at.entity > top.entity) top = at;
  index.playerAt.set(node, top.player);
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
): { counts: Map<NodeId, number>; playerAt: Map<NodeId, number>; town: Map<number, Map<NodeId, number>> } {
  const counts = new Map<NodeId, number>();
  const playerAt = new Map<NodeId, number>();
  const town = new Map<number, Map<NodeId, number>>();
  for (const e of world.canonicalQuery(Owner, Settler)) {
    const p = world.tryGet(e, Position);
    if (p === undefined || !isStanding(world, e) || !hasBodyCollision(world, content, e)) continue;
    const hx = nodeHxOfPosition(p.x, p.y);
    const hy = nodeHyOfPosition(p.y);
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
  return { counts, playerAt, town };
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
