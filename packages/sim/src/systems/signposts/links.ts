import type { ContentSet } from '@open-northland/data';
import { Owner, Position, Signpost } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { TileBuckets } from '../../inspect/tile-buckets.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { type NodeArea, nodeHxOfPosition, nodeHyOfPosition, nodeOfPosition } from '../../nav/halfcell.js';
import { floodReach, reachContains } from '../../nav/range-search.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { System } from '../context.js';
import type { WalkBlockMask } from '../footprint/walk-block-mask.js';
import { signpostNetworkRevision } from './network.js';
import {
  ChangedNodeList,
  dropFallenPostReaches,
  postTerrainReach,
  SIGNPOST_LINK_SPAN,
  signpostMask,
} from './terrain-reach.js';

interface Site {
  readonly id: Entity;
  readonly hx: number;
  readonly hy: number;
}
interface Sites {
  generation: number;
  readonly buckets: TileBuckets<Site>;
}
const sites = new WeakMap<World, Sites>();
/** Every standing post's site, replaying the posts added or removed since the last read when the
 *  membership journal still holds them. A post never moves, so only its membership is followed. */
function sitesOf(world: World): TileBuckets<Site> {
  const generation = world.componentGeneration(Signpost);
  const held = sites.get(world);
  if (held !== undefined) {
    if (held.generation === generation) return held.buckets;
    const { buckets } = held;
    if (world.replayMembershipSince(Signpost, held.generation, (id) => placeSite(world, buckets, id))) {
      held.generation = generation;
      return buckets;
    }
  }
  world.journalMembership(Signpost);
  const buckets = new TileBuckets<Site>();
  for (const id of world.query(Signpost, Position)) placeSite(world, buckets, id);
  sites.set(world, { generation, buckets });
  return buckets;
}

function placeSite(world: World, buckets: TileBuckets<Site>, id: Entity): void {
  const p = world.has(id, Signpost) ? world.tryGet(id, Position) : undefined;
  if (p === undefined) {
    buckets.delete(id);
    return;
  }
  const n = nodeOfPosition(p.x, p.y);
  buckets.set(id, { id, ...n }, n.hx / 2, n.hy / 2);
}

/** Scratch for the sites a link search collects, refilled per post: the search calls nothing that
 *  searches links again. */
const nearbyScratch: Site[] = [];
const linkTargets = { nodes: nearbyScratch, count: 0 };
/** Id scratch filled by count, never truncated, so it keeps its capacity across calls. */
const linkedScratch: Entity[] = [];
const mergedScratch: Entity[] = [];
const NO_BLOCKS: BlockOverlay = { size: 0, has: () => false };
/** The tile box a link search collects sites over, rewritten per post. */
const siteBox = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

/** Each post's latest link list, handed out again while it is unchanged; never stored in a component. */
const heldLinks = new WeakMap<World, Map<Entity, readonly Entity[]>>();
/** The box the latest {@link reachableLinks} call's reach read, or null when it asked no reach. */
let lastLinkSearch: NodeArea | null = null;

/** The same player's posts `post`'s reach takes in, ascending. The flood stops once it has taken in
 *  every candidate it can, as only their containment is asked. Callers must not keep the list. */
function reachableLinks(
  world: World,
  terrain: TerrainGraph,
  post: Entity,
  content?: ContentSet,
): readonly Entity[] {
  const p = world.get(post, Position);
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.x, p.y);
  const r = SIGNPOST_LINK_SPAN.range;
  const owner = world.get(post, Owner).player;
  siteBox.minX = (hx - r) / 2;
  siteBox.maxX = (hx + r) / 2;
  siteBox.minY = (hy - r) / 2;
  siteBox.maxY = (hy + r) / 2;
  const count = sitesOf(world).collect(siteBox, nearbyScratch);
  let candidates = 0;
  for (let i = 0; i < count; i++) {
    const site = nearbyScratch[i] as Site;
    if (site.id !== post && world.tryGet(site.id, Owner)?.player === owner)
      nearbyScratch[candidates++] = site;
  }
  lastLinkSearch = null;
  if (candidates === 0) return NO_LINKS;
  linkTargets.count = candidates;
  const { budget, groundCost } = SIGNPOST_LINK_SPAN;
  const search =
    content === undefined
      ? floodReach(terrain, NO_BLOCKS, hx, hy, r, budget, groundCost, linkTargets)
      : postTerrainReach(world, content, terrain, post, hx, hy, SIGNPOST_LINK_SPAN, linkTargets);
  lastLinkSearch = search.searched;
  const area = search.area;
  let linkedCount = 0;
  for (let i = 0; i < candidates; i++) {
    const site = nearbyScratch[i] as Site;
    if (reachContains(area, site.hx, site.hy))
      linkedCount = insertAscending(linkedScratch, linkedCount, site.id);
  }
  let byPost = heldLinks.get(world);
  if (byPost === undefined) {
    byPost = new Map();
    heldLinks.set(world, byPost);
  }
  const held = byPost.get(post);
  if (held !== undefined && sameIds(held, linkedScratch, linkedCount)) return held;
  const linked = linkedScratch.slice(0, linkedCount);
  byPost.set(post, linked);
  return linked;
}

/** Insert `id` into the ascending first `count` entries of `ids`, returning the new count. A link list is
 *  short, so shifting beats a sort, which allocates a work array per call. */
function insertAscending(ids: Entity[], count: number, id: Entity): number {
  let at = count;
  while (at > 0 && (ids[at - 1] as Entity) > id) {
    ids[at] = ids[at - 1] as Entity;
    at--;
  }
  ids[at] = id;
  return count + 1;
}

/** Whether `a` equals the first `count` entries of `b`. */
function sameIds(a: readonly Entity[], b: readonly Entity[], count: number): boolean {
  if (a.length !== count) return false;
  for (let i = 0; i < count; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Links follow {@link SIGNPOST_LINK_SPAN}, whatever the ground's resistance.
 *  Link count remains uncapped; the original retains at most eight neighbours. */
export function settleSignpostLinks(
  world: World,
  terrain: TerrainGraph,
  post: Entity,
  content?: ContentSet,
): void {
  const linked = reachableLinks(world, terrain, post, content);
  world.mut(post, Signpost).links = linked.slice();
  for (const other of linked) {
    const links = world.get(other, Signpost).links;
    if (!links.includes(post)) world.mut(other, Signpost).links = [...links, post].sort((a, b) => a - b);
  }
}

/** The mask version, road revision and network revision each world's links were last settled at. */
interface Layout {
  mask: number;
  roads: number;
  network: number;
  /** The mask, its version and the terrain's resistance clock the pass's reaches were read under. */
  readMask: WalkBlockMask | undefined;
  readMaskVersion: number;
  readResistanceClock: number;
  /** Per post, the links the pass found and the box its reach read, the box empty when it read none. */
  readonly found: Map<Entity, FoundLinks>;
}
interface FoundLinks {
  links: readonly Entity[];
  minHx: number;
  maxHx: number;
  minHy: number;
  maxHy: number;
}
const layouts = new WeakMap<World, Layout>();

/** The whole map as a node area, its far edges set per pass. */
const WHOLE_MAP = { minHx: 0, maxHx: 0, minHy: 0, maxHy: 0 };
/** The changes since the last pass, read across the whole post loop. */
const passChanges = new ChangedNodeList();

/**
 * Whether the last pass's links still hold for every post whose read box no listed change meets: no post
 * rose, fell or changed hands since, so each post's candidates are the same, and a reach whose read nodes
 * kept their blocks and resistances answers as it did. Lists the changes into `passChanges`.
 */
function listChangesSinceLastPass(
  layout: Layout | undefined,
  mask: WalkBlockMask,
  terrain: TerrainGraph,
  network: number,
): boolean {
  if (layout === undefined || layout.readMask !== mask || layout.network !== network) return false;
  WHOLE_MAP.maxHx = terrain.width - 1;
  WHOLE_MAP.maxHy = terrain.height - 1;
  return passChanges.listSince(mask, terrain, WHOLE_MAP, layout.readMaskVersion, layout.readResistanceClock);
}

/** {@link reachableLinks} for `post`, or the last pass's list when it still holds; records what it found. */
function passLinks(
  world: World,
  terrain: TerrainGraph,
  content: ContentSet,
  layout: Layout,
  post: Entity,
  reuse: boolean,
): readonly Entity[] {
  const held = layout.found.get(post);
  if (reuse && held !== undefined && !passChanges.meets(held.minHx, held.maxHx, held.minHy, held.maxHy))
    return held.links;
  const links = reachableLinks(world, terrain, post, content);
  const read = lastLinkSearch;
  const found = held ?? { links, minHx: 0, maxHx: -1, minHy: 0, maxHy: -1 };
  found.links = links;
  found.minHx = read?.minHx ?? 0;
  found.maxHx = read?.maxHx ?? -1;
  found.minHy = read?.minHy ?? 0;
  found.maxHy = read?.maxHy ?? -1;
  if (held === undefined) layout.found.set(post, found);
  return links;
}

/** Per pass, the posts' own link lists by post index, and the posts naming each post as a flat list
 *  ascending per post: `incomingStart[i]` to `incomingStart[i + 1]` of `incoming` for post `i`. */
const outgoing: (readonly Entity[])[] = [];
let incomingStart = new Int32Array(0);
let incoming = new Int32Array(0);
/** Per pass, each post's index plus one by entity id, zero for any other id; zeroed again after the pass. */
let postSlots = new Int32Array(0);

/** A changed road, building or landscape can connect or cut an existing network. */
export const signpostLinksSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const held = layouts.get(world);
  // The mask is read first: it mirrors the roads into the terrain.
  const maskLayer = signpostMask(world, ctx.content, terrain);
  const mask = maskLayer.version;
  const network = signpostNetworkRevision(world);
  if (held?.mask === mask && held.roads === terrain.mirroredRoadRevision && held.network === network) return;
  const posts = world.canonicalQuery(Signpost, Position, Owner);
  dropFallenPostReaches(world);
  dropFallenLinks(world);
  const reuse = listChangesSinceLastPass(held, maskLayer, terrain, network);
  const layout: Layout = held ?? {
    mask: 0,
    roads: 0,
    network: 0,
    readMask: undefined,
    readMaskVersion: 0,
    readResistanceClock: 0,
    found: new Map(),
  };
  // A post that fell keeps no entry: every entry is asked again whenever the network moves.
  if (!reuse) layout.found.clear();
  layout.readMask = maskLayer;
  layout.readMaskVersion = mask;
  layout.readResistanceClock = terrain.resistanceClock;
  // A link is either post's reach taking the other in: each post's own list, and the posts whose list
  // names it, gathered in ascending post order.
  if (incomingStart.length < posts.length + 1) incomingStart = new Int32Array(posts.length + 1);
  incomingStart.fill(0, 0, posts.length + 1);
  fillPostSlots(posts);
  let named = 0;
  // A reused pass whose posts all found the lists they found before writes what it wrote then: no
  // signpost was written since, or the network revision would have moved.
  let moved = !reuse;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i] as Entity;
    const before = layout.found.get(post)?.links;
    const linked = passLinks(world, terrain, ctx.content, layout, post, reuse);
    if (linked !== before) moved = true;
    outgoing[i] = linked;
    // Indexed, like the loops below: `for...of` allocates an iterator result per element on this path.
    for (let k = 0; k < linked.length; k++) {
      const at = postIndex(linked[k] as Entity);
      if (at < 0) continue;
      incomingStart[at + 1] = (incomingStart[at + 1] as number) + 1;
      named++;
    }
  }
  if (moved) mergeLinks(world, posts, named);
  outgoing.fill(NO_LINKS, 0, posts.length);
  for (let i = 0; i < posts.length; i++) postSlots[posts[i] as Entity] = 0;
  // Settling links moves the network revision, so the layout is read after it.
  layout.mask = signpostMask(world, ctx.content, terrain).version;
  layout.roads = terrain.mirroredRoadRevision;
  layout.network = signpostNetworkRevision(world);
  layouts.set(world, layout);
};

/** Write each post's links: its own {@link outgoing} list merged with the posts naming it, `named` names
 *  counted per post in {@link incomingStart}. */
function mergeLinks(world: World, posts: readonly Entity[], named: number): void {
  for (let i = 0; i < posts.length; i++)
    incomingStart[i + 1] = (incomingStart[i + 1] as number) + (incomingStart[i] as number);
  if (incoming.length < named) incoming = new Int32Array(named);
  // Filled in ascending post order, each post's span ends ascending; the fill moves each start to its end.
  for (let i = 0; i < posts.length; i++) {
    const linked = outgoing[i] as readonly Entity[];
    for (let k = 0; k < linked.length; k++) {
      const at = postIndex(linked[k] as Entity);
      if (at < 0) continue;
      incoming[incomingStart[at] as number] = posts[i] as Entity;
      incomingStart[at] = (incomingStart[at] as number) + 1;
    }
  }
  let from = 0;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i] as Entity;
    const to = incomingStart[i] as number;
    const count = mergeAscending(outgoing[i] as readonly Entity[], incoming, from, to, mergedScratch);
    if (!sameIds(world.get(post, Signpost).links, mergedScratch, count))
      world.mut(post, Signpost).links = mergedScratch.slice(0, count);
    from = to;
  }
}

/** Index each post of the ascending list `posts` in {@link postSlots}. */
function fillPostSlots(posts: readonly Entity[]): void {
  const last = posts[posts.length - 1];
  if (last === undefined) return;
  if (postSlots.length <= last) postSlots = new Int32Array(Math.max(last + 1, postSlots.length * 2));
  for (let i = 0; i < posts.length; i++) postSlots[posts[i] as Entity] = i + 1;
}

/** `id`'s index in the pass's posts, or -1. */
function postIndex(id: Entity): number {
  return id < postSlots.length ? (postSlots[id] as number) - 1 : -1;
}

const NO_LINKS: readonly Entity[] = [];

/** The signpost membership generation each world's held links were last pruned at. */
const linksPrunedAt = new WeakMap<World, number>();

function dropFallenLinks(world: World): void {
  const byPost = heldLinks.get(world);
  const generation = world.componentGeneration(Signpost);
  if (byPost === undefined || linksPrunedAt.get(world) === generation) return;
  linksPrunedAt.set(world, generation);
  for (const post of byPost.keys()) if (!world.isAlive(post)) byPost.delete(post);
}

/** The union of ascending id lists `a` and `b`'s `from` to `to`, ascending and without repeats, written
 *  over the start of `out`; returns its count. */
function mergeAscending(
  a: readonly Entity[],
  b: Int32Array,
  from: number,
  to: number,
  out: Entity[],
): number {
  let count = 0;
  let i = 0;
  let j = from;
  while (i < a.length || j < to) {
    const x = a[i];
    const y = j < to ? (b[j] as Entity) : undefined;
    if (y === undefined || (x !== undefined && x < y)) {
      out[count++] = x as Entity;
      i++;
    } else if (x === undefined || y < x) {
      out[count++] = y;
      j++;
    } else {
      out[count++] = x;
      i++;
      j++;
    }
  }
  return count;
}

/** Drop a falling post from its neighbours' link lists, before it is destroyed. */
export function unlinkSignpost(world: World, post: Entity): void {
  for (const other of world.get(post, Signpost).links) {
    const links = world.tryMut(other, Signpost);
    if (links !== undefined) links.links = links.links.filter((e) => e !== post);
  }
}

/** Re-settle the links of a post that changed hands: it leaves its old owner's posts and joins the new
 *  owner's in range. Source basis: the original's guide rescan links same-player guides only. */
export function relinkSignpost(
  world: World,
  terrain: TerrainGraph,
  post: Entity,
  content?: ContentSet,
): void {
  unlinkSignpost(world, post);
  world.mut(post, Signpost).links = [];
  settleSignpostLinks(world, terrain, post, content);
}
