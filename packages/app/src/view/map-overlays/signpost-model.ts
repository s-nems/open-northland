import {
  firstDifference,
  hexDistanceBetween,
  indexesOf,
  nodeOfPosition,
  type SnapshotIndexSpec,
  type TileBox,
  TileBuckets,
  WALK_RANGE_NODES,
  type WorldSnapshot,
} from '@open-northland/sim';
import { ownerPlayerOf, positionOf, type SnapshotEntity } from '../../game/snapshot.js';

export interface OverlayPost {
  readonly id: number;
  readonly player: number;
  readonly hx: number;
  readonly hy: number;
  readonly links: readonly number[];
}

interface PostIndex {
  readonly posts: Map<number, OverlayPost>;
  readonly buckets: TileBuckets<OverlayPost>;
  revision: number;
}

function readPost(entity: SnapshotEntity): OverlayPost | null {
  const signpost = entity.components.Signpost as { links?: readonly number[] } | undefined;
  const position = positionOf(entity);
  const player = ownerPlayerOf(entity);
  if (signpost === undefined || position === undefined || player === undefined) return null;
  return { id: entity.id, player, ...nodeOfPosition(position.x, position.y), links: signpost.links ?? [] };
}

function add(index: PostIndex, entity: SnapshotEntity): void {
  const post = readPost(entity);
  if (post === null) return;
  index.posts.set(post.id, post);
  index.buckets.set(post.id, post, post.hx / 2, post.hy / 2);
  index.revision++;
}

function remove(index: PostIndex, entity: SnapshotEntity): void {
  if (!index.posts.delete(entity.id)) return;
  index.buckets.delete(entity.id);
  index.revision++;
}

const POSTS: SnapshotIndexSpec<PostIndex> = {
  name: 'map overlay signposts',
  reads: { values: ['Signpost', 'Owner', 'Position'] },
  empty: () => ({ posts: new Map(), buckets: new TileBuckets(), revision: 0 }),
  add,
  remove,
  replace: (index, previous, next) => {
    if (!index.posts.has(previous.id) && next.components.Signpost === undefined) return;
    const before = index.posts.get(previous.id);
    const after = readPost(next);
    if (before !== undefined && after !== null && firstDifference(before, after) === null) return;
    remove(index, previous);
    add(index, next);
  },
  differs: (held, fresh) => firstDifference(held.posts, fresh.posts),
};

export function signpostOverlayIndex(snapshot: WorldSnapshot): PostIndex {
  return indexesOf(snapshot).get(POSTS);
}

/** Expand the view by the civilian range: a post off screen can still cover visible ground or link
 *  across it. Buckets use half-node coordinates divided by two, with no visual-row stagger. */
export function overlayPostsWithin(index: PostIndex, player: number, nodes: TileBox): OverlayPost[] {
  const range = WALK_RANGE_NODES;
  return index.buckets
    .within({
      minX: (nodes.minX - range) / 2,
      maxX: (nodes.maxX + range) / 2,
      minY: (nodes.minY - range) / 2,
      maxY: (nodes.maxY + range) / 2,
    })
    .filter((post) => post.player === player);
}

/** The sim's civilian guide coverage, with its strict outer boundary. This is a navigation range,
 *  not a walkability test; carriers have a longer range and some professions are unrestricted. */
export function postCovers(post: OverlayPost, hx: number, hy: number): boolean {
  return hexDistanceBetween(post.hx, post.hy, hx, hy) < WALK_RANGE_NODES;
}

export function linkedPosts(index: PostIndex, post: OverlayPost): OverlayPost[] {
  const links: OverlayPost[] = [];
  for (const id of post.links) {
    const other = index.posts.get(id);
    if (other !== undefined && other.player === post.player) links.push(other);
  }
  return links;
}
