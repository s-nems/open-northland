import {
  components,
  type EntitySnapshot,
  type Fixed,
  firstDifference,
  indexesOf,
  nodeOfPosition,
  type SnapshotIndexSpec,
  type TileBox,
  TileBuckets,
  type WorldSnapshot,
} from '@open-northland/sim';
import { readNumField, readPosition } from './snapshot/index.js';

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

function readPost(entity: EntitySnapshot): OverlayPost | null {
  const signpost = entity.components.Signpost as { links?: readonly number[] } | undefined;
  const position = readPosition(entity.components);
  const player = readNumField(entity.components, 'Owner', 'player');
  if (signpost === undefined || position === null || player === undefined) return null;
  return {
    id: entity.id,
    player,
    ...nodeOfPosition(position.x as Fixed, position.y as Fixed),
    links: signpost.links ?? [],
  };
}

function add(index: PostIndex, entity: EntitySnapshot): void {
  const post = readPost(entity);
  if (post === null) return;
  index.posts.set(post.id, post);
  index.buckets.set(post.id, post, post.hx / 2, post.hy / 2);
  index.revision++;
}

function remove(index: PostIndex, entity: EntitySnapshot): void {
  if (!index.posts.delete(entity.id)) return;
  index.buckets.delete(entity.id);
  index.revision++;
}

const POSTS: SnapshotIndexSpec<PostIndex> = {
  name: 'signpost networks',
  // A post never moves while it holds the role: a relocated one re-adds its `Signpost`, whose write
  // places it again. `Position` is read only as gained or lost, so a walker's step costs nothing here.
  reads: { values: ['Signpost', 'Owner'], presence: ['Position'] },
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

/** Expand the view by the goods search range: a post off screen can still cover visible ground or link
 *  across it. Buckets use half-node coordinates divided by two, with no visual-row stagger. */
export function overlayPostsWithin(index: PostIndex, player: number, nodes: TileBox): OverlayPost[] {
  const range = components.GOODS_SEARCH_RANGE_NODES;
  return index.buckets
    .within({
      minX: (nodes.minX - range) / 2,
      maxX: (nodes.maxX + range) / 2,
      minY: (nodes.minY - range) / 2,
      maxY: (nodes.maxY + range) / 2,
    })
    .filter((post) => post.player === player);
}

export function linkedPosts(index: PostIndex, post: OverlayPost): OverlayPost[] {
  const links: OverlayPost[] = [];
  for (const id of post.links) {
    const other = index.posts.get(id);
    if (other !== undefined && other.player === post.player) links.push(other);
  }
  return links;
}
