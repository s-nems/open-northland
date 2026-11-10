import type { ContentSet } from '@open-northland/data';
import {
  AssistantRecruit,
  CARRIER_WALK_RANGE_NODES,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  Owner,
  ownerOf,
  Position,
  Settler,
  Signpost,
  signpostNavigationEnabled,
  WALK_RANGE_NODES,
} from '../../components/index.js';
import { BIT_MASK, BITS_PER_WORD, WORD_SHIFT } from '../../core/bit-words.js';
import { contentIndex } from '../../core/content-index.js';
import { SMALL_INTEGER_SPAN } from '../../core/small-integer.js';
import type { Entity, World } from '../../ecs/world.js';
import {
  hexDistanceBetween,
  nodeHxOfPosition,
  nodeHyOfPosition,
  nodeOfPosition,
} from '../../nav/halfcell.js';
import {
  hexNodeBox,
  inNodeBox,
  type NodeBox,
  type SpatialGate,
  unionNodeBoxes,
} from '../../nav/node-circle.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../nav/terrain/index.js';
import { isCarrierJobRow, isDruidJob, isFighterJob, isHunterJob, isScoutJob } from '../readviews/index.js';
import { goodsSearchLimitAt } from './reach.js';

/**
 * The per-player signpost network: which signposts stand where and which belong to one connected group,
 * the transitive closure of the stored `Signpost.links`.
 */
export interface SignpostSite {
  readonly entity: Entity;
  /** Anchor node coords on the half-cell lattice. */
  readonly hx: number;
  readonly hy: number;
  /** Canonical group label: the smallest signpost entity id in this connected group. */
  readonly group: number;
}

/** The Signpost store's membership and value generations, since a post rising or falling rewrites its
 *  neighbours' links in the same call, and the Owner store's membership, since a script hands a town
 *  over by re-adding the owner. Any change sends the memo to check whether the network really moved. */
interface NetworkKeys {
  readonly membership: number;
  readonly values: number;
  readonly owners: number;
}

interface NetworkMemo {
  keys: NetworkKeys;
  /** Moves on every rebuild, never on Owner churn that leaves the network intact, so the per-settler
   *  limits and the erect overlay keyed on it outlive every birth, death and placement. Memo-local: it
   *  never feeds a sim decision itself. */
  revision: number;
  byPlayer: ReadonlyMap<number, readonly SignpostSite[]>;
}

/** Per-world memo; a verifier re-derives it on invariant-checked runs. */
const networkMemo = new WeakMap<World, NetworkMemo>();
const verifierRegistered = new WeakSet<World>();

function networkKeys(world: World): NetworkKeys {
  return {
    membership: world.componentGeneration(Signpost),
    values: world.componentValueGeneration(Signpost),
    owners: world.componentGeneration(Owner),
  };
}

function sameKeys(a: NetworkKeys, b: NetworkKeys): boolean {
  return a.membership === b.membership && a.values === b.values && a.owners === b.owners;
}

/** Whether `keys` still name `world`'s signpost and owner stores, read without building a key object. */
function keysCurrent(world: World, keys: NetworkKeys): boolean {
  return (
    keys.membership === world.componentGeneration(Signpost) &&
    keys.values === world.componentValueGeneration(Signpost) &&
    keys.owners === world.componentGeneration(Owner)
  );
}

function buildNetwork(world: World): Map<number, readonly SignpostSite[]> {
  // Collect per player in canonical (ascending entity id) order - group labels derive from ids, so the
  // result is independent of store insertion history.
  const perPlayer = new Map<number, { entity: Entity; hx: number; hy: number; links: readonly Entity[] }[]>();
  for (const e of world.canonicalQuery(Signpost, Position, Owner)) {
    const p = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    const player = world.get(e, Owner).player;
    let list = perPlayer.get(player);
    if (list === undefined) {
      list = [];
      perPlayer.set(player, list);
    }
    list.push({ entity: e, hx, hy, links: world.get(e, Signpost).links });
  }
  const byPlayer = new Map<number, readonly SignpostSite[]>();
  for (const [player, posts] of perPlayer) {
    const indexOf = new Map<Entity, number>(posts.map((p, i) => [p.entity, i]));
    const parent = posts.map((_, i) => i);
    const find = (i: number): number => {
      let root = i;
      for (let next = parent[root]; next !== undefined && next !== root; next = parent[root]) root = next;
      for (let next = parent[i]; next !== undefined && next !== root; next = parent[i]) {
        parent[i] = root;
        i = next;
      }
      return root;
    };
    posts.forEach((a, i) => {
      for (const linked of a.links) {
        const j = indexOf.get(linked);
        if (j !== undefined) parent[find(j)] = find(i);
      }
    });
    // Canonical group label: the smallest entity id in the group (posts are already id-ascending).
    const label = new Map<number, number>();
    posts.forEach((p, i) => {
      const root = find(i);
      if (!label.has(root)) label.set(root, p.entity as number);
    });
    byPlayer.set(
      player,
      posts.map((p, i) => ({ entity: p.entity, hx: p.hx, hy: p.hy, group: label.get(find(i)) as number })),
    );
  }
  return byPlayer;
}

/** Whether every post the network lists still stands for the player it is listed under, and no post
 *  joined: the one question an Owner-only change asks. */
function ownersUnchanged(world: World, byPlayer: ReadonlyMap<number, readonly SignpostSite[]>): boolean {
  let listed = 0;
  for (const [player, sites] of byPlayer) {
    for (const site of sites) {
      if (world.tryGet(site.entity, Owner)?.player !== player) return false;
      listed++;
    }
  }
  return listed === world.canonicalQuery(Signpost, Position, Owner).length;
}

/** Whether the Owner journal replays every change since generation `since` and none touched an entity
 *  holding a signpost: posts hold their owners, and no post gained or lost one. */
function noPostOwnerMoved(world: World, since: number): boolean {
  journalWorld = world;
  postOwnerMoved = false;
  const replayed = world.replayMembershipSince(Owner, since, notePostOwner);
  journalWorld = undefined;
  return replayed && !postOwnerMoved;
}

/** The world {@link notePostOwner} reads, set only while {@link noPostOwnerMoved} replays. */
let journalWorld: World | undefined;
let postOwnerMoved = false;
function notePostOwner(entity: Entity): void {
  if (journalWorld?.has(entity, Signpost)) postOwnerMoved = true;
}

function refreshedMemo(world: World): NetworkMemo {
  const cached = networkMemo.get(world);
  if (cached !== undefined && keysCurrent(world, cached.keys)) return cached;
  const keys = networkKeys(world);
  if (
    cached !== undefined &&
    cached.keys.membership === keys.membership &&
    cached.keys.values === keys.values &&
    (noPostOwnerMoved(world, cached.keys.owners) || ownersUnchanged(world, cached.byPlayer))
  ) {
    cached.keys = keys;
    return cached;
  }
  world.journalMembership(Owner);
  const byPlayer = buildNetwork(world);
  if (cached !== undefined) keepUnchangedPlayers(cached.byPlayer, byPlayer);
  const memo = { keys, revision: (cached?.revision ?? 0) + 1, byPlayer };
  networkMemo.set(world, memo);
  if (!verifierRegistered.has(world)) {
    verifierRegistered.add(world);
    world.registerCacheVerifier('signpostNetwork', () => verifyNetwork(world));
  }
  return memo;
}

/** Swaps into `fresh` the `previous` list of every player whose posts did not move, so a player's list
 *  keeps its identity across rebuilds another player caused, and the caches keyed on it survive. */
function keepUnchangedPlayers(
  previous: ReadonlyMap<number, readonly SignpostSite[]>,
  fresh: Map<number, readonly SignpostSite[]>,
): void {
  for (const [player, sites] of fresh) {
    const was = previous.get(player);
    if (was !== undefined && sameSites(was, sites)) fresh.set(player, was);
  }
}

function sameSites(a: readonly SignpostSite[], b: readonly SignpostSite[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as SignpostSite;
    const y = b[i] as SignpostSite;
    if (x.entity !== y.entity || x.hx !== y.hx || x.hy !== y.hy || x.group !== y.group) return false;
  }
  return true;
}

/** The posts `player` holds in `network`, the shared empty list for a player with none. */
function sitesOf(network: NetworkMemo, player: number): readonly SignpostSite[] {
  return network.byPlayer.get(player) ?? NO_SITES;
}

const NO_SITES: readonly SignpostSite[] = [];

/** The current signpost network, rebuilt only when a signpost rises, falls, relinks or changes hands. A
 *  player whose posts did not move keeps his list object. */
export function signpostNetwork(world: World): ReadonlyMap<number, readonly SignpostSite[]> {
  return refreshedMemo(world).byPlayer;
}

/** A key that moves whenever {@link signpostNetwork} returns a different network, for caches over it. */
export function signpostNetworkRevision(world: World): number {
  return refreshedMemo(world).revision;
}

function verifyNetwork(world: World): string[] {
  const cached = networkMemo.get(world);
  if (cached === undefined || !sameKeys(cached.keys, networkKeys(world))) return [];
  const fresh = buildNetwork(world);
  if (JSON.stringify([...fresh]) !== JSON.stringify([...cached.byPlayer])) {
    return ['signpostNetwork memo is stale - a Signpost mutation missed the component generation'];
  }
  return [];
}

/**
 * One settler's navigation confinement as a {@link SpatialGate}: the hex range it may walk from where it
 * stands, plus the range around every post of each signpost group it catches. Every rule keys on
 * `allowsNode`; `bounds` lets searches shrink their scans.
 *
 * Source basis: the original's guided pathfinder: a leg is planned within the walk range of the current
 * position, or through a guide within that range of the start and one within it of the goal, both in one
 * link system. Approximations: the original floods walkable ground to catch a guide and to cover a goal,
 * and weighs only the two nearest guides on each side, where this gate tests hex distance and opens
 * every group with a post in range. Project rule, which keeps it closer to the flood: a caught post and
 * an allowed node lie on the spot's static land component when both stand on walkable land.
 */
export type NavigationLimit = SpatialGate;

/** One settler's memoized limit plus every input it derives from. Each input is re-checked on read, so a
 *  stale entry can never be served and the memo needs no coherence verifier. `terrain` and `content` are
 *  per-world constants, so they need no slot. Rewritten in place when the settler moves. */
interface LimitMemoEntry {
  hx: number;
  hy: number;
  player: number;
  jobType: number | null;
  networkRevision: number;
  limit: NavigationLimit | null;
}

interface LimitMemo {
  readonly entries: Map<Entity, LimitMemoEntry>;
  /** Entry count that triggers the next dead-entry sweep: entity ids are never reused, so without a sweep
   *  the map would grow with every settler that ever lived. Doubled after each sweep. */
  sweepAt: number;
}

const LIMIT_MEMO_SWEEP_MIN = 256;

const limitMemo = new WeakMap<World, LimitMemo>();

/**
 * The navigation limit confining settler `e`, or null when it is unlimited: signpost navigation off, a
 * mapless sim, a non-settler or unowned target, an exempt job, or a human whose script behaviour lifts the
 * walk range. The `signpostNavigationEnabled` toggle is read live on every call, since an in-place rules
 * flip bumps no generation, so it needs no memo slot.
 */
export function navigationLimitFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  e: Entity,
): NavigationLimit | null {
  if (!signpostNavigationEnabled(world)) return null;
  if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.UNLIMITED_WALK_RANGE)) return null;
  const settler = world.tryGet(e, Settler);
  const owner = world.tryGet(e, Owner);
  const p = world.tryGet(e, Position);
  if (settler === undefined || owner === undefined || p === undefined) return null;
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.x, p.y);
  const networkRevision = signpostNetworkRevision(world);
  let memo = limitMemo.get(world);
  if (memo === undefined) {
    memo = { entries: new Map(), sweepAt: LIMIT_MEMO_SWEEP_MIN };
    limitMemo.set(world, memo);
  }
  const held = memo.entries.get(e);
  if (
    held !== undefined &&
    held.hx === hx &&
    held.hy === hy &&
    held.player === owner.player &&
    held.jobType === settler.jobType &&
    held.networkRevision === networkRevision
  ) {
    return held.limit;
  }
  const limit = computeNavigationLimit(world, content, terrain, settler.jobType, owner.player, hx, hy);
  if (held !== undefined) {
    held.hx = hx;
    held.hy = hy;
    held.player = owner.player;
    held.jobType = settler.jobType;
    held.networkRevision = networkRevision;
    held.limit = limit;
    return limit;
  }
  if (memo.entries.size >= memo.sweepAt) sweepDeadEntries(world, memo);
  memo.entries.set(e, {
    hx,
    hy,
    player: owner.player,
    jobType: settler.jobType,
    networkRevision,
    limit,
  });
  return limit;
}

/**
 * The confinement an equip errand shops inside: the settler's own `limit`, or, for a job with none
 * (a soldier) and for a recruit being armed, the settlement network at his feet - the original's
 * equipment-search bound. The store search cuts it further to the goods search from `here`. The errand
 * and the pick menu both read it, so a menu row names only a store the fetch can reach.
 */
export function equipErrandConfinement(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  limit: NavigationLimit | null,
): NavigationLimit | undefined {
  if (limit !== null && !world.has(e, AssistantRecruit)) return limit;
  const owner = ownerOf(world, e);
  if (owner === undefined) return limit ?? undefined;
  return networkLimitAt(world, terrain, owner, terrain.xOf(here), terrain.yOf(here)) ?? undefined;
}

/** Equipment uses the same terrain-limited 40-node goods search, including exempt professions. */
export function equipFetchLimitFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  e: Entity,
): NavigationLimit | null {
  const owner = world.tryGet(e, Owner);
  const p = world.tryGet(e, Position);
  if (owner === undefined || p === undefined) return null;
  return goodsSearchLimitAt(
    world,
    content,
    terrain,
    owner.player,
    nodeHxOfPosition(p.x, p.y),
    nodeHyOfPosition(p.x, p.y),
  );
}

function sweepDeadEntries(world: World, memo: LimitMemo): void {
  for (const entity of memo.entries.keys()) {
    if (!world.has(entity, Settler)) memo.entries.delete(entity);
  }
  memo.sweepAt = Math.max(LIMIT_MEMO_SWEEP_MIN, memo.entries.size * 2);
}

function computeNavigationLimit(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  jobType: number | null,
  player: number,
  hx: number,
  hy: number,
): NavigationLimit | null {
  if (!confinedJob(content, jobType)) return null;
  return networkLimitAt(world, terrain, player, hx, hy, walkRangeOf(content, jobType));
}

/**
 * The spots from which a settler of `jobType` and `player` would be allowed one of `goals`: the reverse of
 * the confinement it carries standing there, within its walk range of a goal or catching a signpost group
 * whose posts cover one, on the goal's land. A search over many candidate spots tests each with a few
 * distance checks instead of deriving every spot's confinement. A `slack` widens both ranges and drops
 * the ground tests, so the answer also admits every spot within that many Manhattan nodes of one that
 * qualifies, hex distance never exceeding Manhattan. Null when nothing confines the job.
 */
export function spotsReaching(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  jobType: number | null,
  player: number,
  goals: readonly NodeId[],
  slack = 0,
): ((hx: number, hy: number) => boolean) | null {
  if (!signpostNavigationEnabled(world) || !confinedJob(content, jobType)) return null;
  const range = walkRangeOf(content, jobType);
  const posts = refreshedMemo(world).byPlayer.get(player) ?? [];
  const goalLands = goals.map((goal) => landComponentOf(terrain, goal));
  const landsOfGroup = goalLandsByGroup(terrain, posts, goals, goalLands, range);
  const serving = landsOfGroup.size === 0 ? NO_SITES : posts.filter((s) => landsOfGroup.has(s.group));
  const judgeGround = slack === 0;
  // Boxes round the goals and the serving posts turn away a far spot before any distance test.
  const reachOf = range + slack;
  const goalBox =
    goals.length === 0
      ? null
      : unionNodeBoxes(goals.map((g) => hexNodeBox(terrain.xOf(g), terrain.yOf(g), reachOf)));
  const postBox =
    serving.length === 0 ? null : unionNodeBoxes(serving.map((s) => hexNodeBox(s.hx, s.hy, reachOf)));
  // Indexed loops: the test runs per candidate spot, and an array iterator here is not always elided.
  return (hx, hy) => {
    const nearGoals = goalBox !== null && inNodeBox(goalBox, hx, hy);
    const nearPosts = postBox !== null && inNodeBox(postBox, hx, hy);
    if (!nearGoals && !nearPosts) return false;
    const land = judgeGround ? landComponentAt(terrain, hx, hy) : null;
    for (let i = 0; nearGoals && i < goals.length; i++) {
      const goal = goals[i] as NodeId;
      if (
        hexDistanceBetween(hx, hy, terrain.xOf(goal), terrain.yOf(goal)) <= reachOf &&
        sameLand(land, goalLands[i] as number | null)
      )
        return true;
    }
    const here = judgeGround ? componentAt(terrain, hx, hy) : null;
    for (let i = 0; nearPosts && i < serving.length; i++) {
      const s = serving[i] as SignpostSite;
      if (
        hexDistanceBetween(hx, hy, s.hx, s.hy) < reachOf &&
        (here === null || componentAt(terrain, s.hx, s.hy) === here) &&
        (land === null || coversLand(landsOfGroup.get(s.group), land))
      )
        return true;
    }
    return false;
  };
}

/** The lands of the goals each group covers with a post strictly inside `range`, by group label (null for
 *  a goal off walkable land, which any spot may claim). */
function goalLandsByGroup(
  terrain: TerrainGraph,
  posts: readonly SignpostSite[],
  goals: readonly NodeId[],
  goalLands: readonly (number | null)[],
  range: number,
): Map<number, (number | null)[]> {
  const landsOfGroup = new Map<number, (number | null)[]>();
  for (const s of posts) {
    let lands = landsOfGroup.get(s.group);
    for (let i = 0; i < goals.length; i++) {
      const goal = goals[i] as NodeId;
      const land = goalLands[i] as number | null;
      if (lands?.includes(land) === true) continue;
      if (hexDistanceBetween(s.hx, s.hy, terrain.xOf(goal), terrain.yOf(goal)) >= range) continue;
      if (lands === undefined) {
        lands = [];
        landsOfGroup.set(s.group, lands);
      }
      lands.push(land);
    }
  }
  return landsOfGroup;
}

function coversLand(lands: readonly (number | null)[] | undefined, land: number): boolean {
  return lands !== undefined && (lands.includes(land) || lands.includes(null));
}

/** Whether signposts confine `jobType`. The original routes soldiers, heroes, scouts, hunters and druids
 *  over its global walk sectors instead. */
export function confinedJob(content: ContentSet, jobType: number | null): boolean {
  return !(
    isScoutJob(content, jobType) ||
    isFighterJob(content, jobType) ||
    isHunterJob(content, jobType) ||
    isDruidJob(content, jobType)
  );
}

/** A carrier plans longer legs than any other trade, as in the original. */
function walkRangeOf(content: ContentSet, jobType: number | null): number {
  const job = jobType === null ? undefined : contentIndex(content).jobs.get(jobType);
  return job !== undefined && isCarrierJobRow(job) ? CARRIER_WALK_RANGE_NODES : WALK_RANGE_NODES;
}

/** The static walkable component under `(x, y)`, or null off the map or on unwalkable ground, where the
 *  catch below cannot judge connectivity and does not try. */
function componentAt(terrain: TerrainGraph, x: number, y: number): number | null {
  if (!terrain.inBounds(x, y)) return null;
  const component = terrain.componentOf(terrain.nodeAt(x, y));
  return component === NO_COMPONENT ? null : component;
}

/** The static land component of a walkable node, or null for one off the map or off walkable land (water,
 *  a trunk, a rock), where the island rules below do not judge. */
export function landComponentAt(terrain: TerrainGraph, x: number, y: number): number | null {
  return terrain.inBounds(x, y) ? landComponentOf(terrain, terrain.nodeAt(x, y)) : null;
}

function landComponentOf(terrain: TerrainGraph, node: NodeId): number | null {
  return terrain.isWalkable(node) ? terrain.componentOf(node) : null;
}

/** Whether two {@link landComponentAt} answers may lie on one island: equal, or either unjudged. */
export function sameLand(a: number | null, b: number | null): boolean {
  return a === null || b === null || a === b;
}

/** The posts of the signpost groups one catch opens, shared by every settler of the player whose catch
 *  opens the same groups under the same range, answering "strictly inside a post's range" from a bitmap
 *  painted on first use. */
class CaughtPosts {
  readonly bounds: NodeBox;
  private coverage: PostCoverage | undefined;
  /** The coverage widened by each radius {@link coversNear} was asked about: a scan alternates between the
   *  few work reaches its footprints carry. */
  private readonly near = new Map<number, PostCoverage>();

  constructor(
    readonly posts: readonly SignpostSite[],
    private readonly range: number,
  ) {
    this.bounds = unionNodeBoxes(posts.map((s) => hexNodeBox(s.hx, s.hy, range)));
  }

  covers(x: number, y: number): boolean {
    this.coverage ??= new PostCoverage(this.posts, this.range);
    return this.coverage.has(x, y);
  }

  /** False only when no node within Manhattan `radius` of `(x, y)` is covered. Hex distance obeys the
   *  triangle inequality and never exceeds Manhattan distance, so such a node's post lies strictly inside
   *  `range + radius` of `(x, y)`. */
  coversNear(x: number, y: number, radius: number): boolean {
    let near = this.near.get(radius);
    if (near === undefined) {
      near = new PostCoverage(this.posts, this.range + radius);
      this.near.set(radius, near);
    }
    return near.has(x, y);
  }
}

/** Every set bit of a word. */
const ALL_BITS = ~0;

/** Every node strictly inside hex `range` of one of `posts`, as a bitmap over their bounding box: a bit
 *  per node, since a player keeps a coverage per caught group set and radius while his posts stand. */
class PostCoverage {
  private readonly bounds: NodeBox;
  private readonly width: number;
  private readonly words: Uint32Array;

  constructor(posts: readonly SignpostSite[], range: number) {
    this.bounds = unionNodeBoxes(posts.map((s) => hexNodeBox(s.hx, s.hy, range)));
    this.width = this.bounds.maxX - this.bounds.minX + 1;
    this.words = paintCoverage(posts, range, this.bounds, this.width);
  }

  has(x: number, y: number): boolean {
    const { minX, maxX, minY, maxY } = this.bounds;
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    const cell = (y - minY) * this.width + (x - minX);
    return ((this.words[cell >>> WORD_SHIFT] as number) & (1 << (cell & BIT_MASK))) !== 0;
  }
}

/** Marks every node with `hexDistanceBetween(post, node) < range`, row by row: on a row `rows` off the
 *  post that holds for `|dx| < lim`, `lim = range - rows + floor(rows / 2)`, and an odd `rows` reaches
 *  one node further east on an even node row and one further west on an odd one. */
function paintCoverage(
  posts: readonly SignpostSite[],
  range: number,
  bounds: NodeBox,
  width: number,
): Uint32Array {
  const { minX, maxY, minY } = bounds;
  const words = new Uint32Array(Math.ceil((width * (maxY - minY + 1)) / BITS_PER_WORD));
  for (const s of posts) {
    for (let y = s.hy - range + 1; y < s.hy + range; y++) {
      const rows = Math.abs(y - s.hy);
      const lim = range - rows + Math.floor(rows / 2);
      const oddRows = rows % 2 !== 0;
      const west = oddRows && y % 2 !== 0 ? lim : lim - 1;
      const east = oddRows && y % 2 === 0 ? lim : lim - 1;
      const rowStart = (y - minY) * width - minX;
      setBits(words, rowStart + s.hx - west, rowStart + s.hx + east + 1);
    }
  }
  return words;
}

/** Set the bits `from` up to, not including, `to`. */
function setBits(words: Uint32Array, from: number, to: number): void {
  if (from >= to) return;
  const first = from >>> WORD_SHIFT;
  const last = (to - 1) >>> WORD_SHIFT;
  const head = ALL_BITS << (from & BIT_MASK);
  const tail = ALL_BITS >>> (BIT_MASK - ((to - 1) & BIT_MASK));
  if (first === last) {
    words[first] = (words[first] as number) | (head & tail);
    return;
  }
  words[first] = (words[first] as number) | head;
  words.fill(ALL_BITS >>> 0, first + 1, last);
  words[last] = (words[last] as number) | tail;
}

/**
 * One player's shared {@link CaughtPosts}, keyed by range and the ascending caught groups, valid while his
 * post list is `sites`. When his posts move, the previous catches stay on as `stale`: a catch whose posts
 * are still the same entities on the same nodes keeps its painted coverage.
 */
interface PlayerCatches {
  sites: readonly SignpostSite[];
  byCatch: Map<string, CaughtPosts>;
  stale: Map<string, CaughtPosts> | undefined;
}

const caughtPostsMemo = new WeakMap<World, Map<number, PlayerCatches>>();

function sharedCaughtPosts(
  world: World,
  player: number,
  range: number,
  sites: readonly SignpostSite[],
  groups: readonly number[],
): CaughtPosts {
  let byPlayer = caughtPostsMemo.get(world);
  if (byPlayer === undefined) {
    byPlayer = new Map();
    caughtPostsMemo.set(world, byPlayer);
  }
  let catches = byPlayer.get(player);
  if (catches === undefined) {
    catches = { sites, byCatch: new Map(), stale: undefined };
    byPlayer.set(player, catches);
  } else if (catches.sites !== sites) {
    // A list nobody read a catch from leaves the older catches standing in for it.
    if (catches.byCatch.size > 0) catches.stale = catches.byCatch;
    catches.byCatch = new Map();
    catches.sites = sites;
  }
  const key = `${range}:${groups.join(',')}`;
  let caught = catches.byCatch.get(key);
  if (caught === undefined) {
    const posts = sites.filter((s) => groups.includes(s.group));
    const was = catches.stale?.get(key);
    caught = was !== undefined && samePostNodes(was.posts, posts) ? was : new CaughtPosts(posts, range);
    catches.byCatch.set(key, caught);
  }
  return caught;
}

/** Whether `a` and `b` list the same posts on the same nodes: all a coverage bitmap is painted from. */
function samePostNodes(a: readonly SignpostSite[], b: readonly SignpostSite[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as SignpostSite;
    const y = b[i] as SignpostSite;
    if (x.entity !== y.entity || x.hx !== y.hx || x.hy !== y.hy) return false;
  }
  return true;
}

/** A spot's confinement: the walk range around the spot itself, inclusive, plus whatever its caught
 *  posts cover, on the spot's land when it stands on land. */
class SignpostConfinement implements NavigationLimit {
  readonly bounds: NodeBox;
  private readonly land: number | null;

  constructor(
    private readonly terrain: TerrainGraph,
    private readonly hx: number,
    private readonly hy: number,
    private readonly range: number,
    private readonly caught: CaughtPosts | null,
  ) {
    const own = hexNodeBox(hx, hy, range);
    this.bounds = caught === null ? own : unionNodeBoxes([own, caught.bounds]);
    this.land = landComponentAt(terrain, hx, hy);
  }

  allowsNode(node: NodeId): boolean {
    const x = this.terrain.xOf(node);
    const y = this.terrain.yOf(node);
    const reached =
      hexDistanceBetween(this.hx, this.hy, x, y) <= this.range || this.caught?.covers(x, y) === true;
    if (!reached || this.land === null) return reached;
    return sameLand(this.land, landComponentOf(this.terrain, node));
  }

  /** The own range widened by `radius` on the same grounds as {@link CaughtPosts.coversNear}. */
  mayAllowNear(x: number, y: number, radius: number): boolean {
    if (hexDistanceBetween(this.hx, this.hy, x, y) <= this.range + radius) return true;
    return this.caught?.coversNear(x, y, radius) === true;
  }
}

/** The confinement a spot carries whoever stands on it: the walk range around `(hx, hy)` unioned with
 *  the range around every post of each signpost group it catches. {@link navigationLimitFor} adds the
 *  per-job exemptions and the carrier's longer range, which an errand does not inherit. */
export function networkLimitAt(
  world: World,
  terrain: TerrainGraph,
  player: number,
  hx: number,
  hy: number,
  range = WALK_RANGE_NODES,
): NavigationLimit | null {
  if (!signpostNavigationEnabled(world)) return null;
  const sites = sitesOf(refreshedMemo(world), player);
  const spots = spotLimitsOf(world, terrain, player, sites);
  const key = spotKey(terrain, range, hx, hy);
  if (key !== null) {
    const held = spots.limits.get(key);
    if (held !== undefined) return held;
  }
  const limit = deriveNetworkLimit(terrain, world, sites, player, hx, hy, range);
  if (key !== null) {
    if (spots.limits.size >= SPOT_LIMIT_MEMO_CAP) spots.limits.clear();
    spots.limits.set(key, limit);
  }
  return limit;
}

function deriveNetworkLimit(
  terrain: TerrainGraph,
  world: World,
  posts: readonly SignpostSite[],
  player: number,
  hx: number,
  hy: number,
  range: number,
): SignpostConfinement {
  // A post is caught when it stands inside the range and on ground the spot connects to; a caught post
  // opens its whole group. Kept ascending as found.
  const here = componentAt(terrain, hx, hy);
  const groups: number[] = [];
  for (const s of posts) {
    if (groups.includes(s.group)) continue;
    if (hexDistanceBetween(hx, hy, s.hx, s.hy) >= range) continue;
    if (here !== null && componentAt(terrain, s.hx, s.hy) !== here) continue;
    let at = groups.length;
    while (at > 0 && (groups[at - 1] as number) > s.group) at--;
    groups.splice(at, 0, s.group);
  }
  const caught = groups.length === 0 ? null : sharedCaughtPosts(world, player, range, posts, groups);
  return new SignpostConfinement(terrain, hx, hy, range, caught);
}

/** One player's spot limits, shared by every settler of his that plans from the same spot: a limit is a
 *  pure function of the spot, the range and his posts, so it holds while his list is `sites`. */
interface SpotLimits {
  readonly terrain: TerrainGraph;
  readonly sites: readonly SignpostSite[];
  readonly limits: Map<number, SignpostConfinement>;
}

/** Spots held per player before his memo starts over, bounding it on a long-lived network. */
const SPOT_LIMIT_MEMO_CAP = 8192;

const spotLimitMemos = new WeakMap<World, Map<number, SpotLimits>>();

function spotLimitsOf(
  world: World,
  terrain: TerrainGraph,
  player: number,
  sites: readonly SignpostSite[],
): SpotLimits {
  let byPlayer = spotLimitMemos.get(world);
  if (byPlayer === undefined) {
    byPlayer = new Map();
    spotLimitMemos.set(world, byPlayer);
  }
  let memo = byPlayer.get(player);
  if (memo === undefined || memo.sites !== sites || memo.terrain !== terrain) {
    memo = { terrain, sites, limits: new Map() };
    byPlayer.set(player, memo);
  }
  return memo;
}

/** A spot on the terrain under a non-negative `lead` (a range, a player) as one small integer, so a memo
 *  lookup boxes no heap number; null off the terrain or past that span, for the caller to answer
 *  uncached. */
export function spotKey(terrain: TerrainGraph, lead: number, hx: number, hy: number): number | null {
  if (lead < 0 || hx < 0 || hy < 0 || hx >= terrain.width || hy >= terrain.height) return null;
  const key = (lead * terrain.height + hy) * terrain.width + hx;
  return key < SMALL_INTEGER_SPAN ? key : null;
}
