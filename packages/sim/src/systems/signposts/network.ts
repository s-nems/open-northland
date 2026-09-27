import type { ContentSet } from '@open-northland/data';
import {
  CARRIER_WALK_RANGE_NODES,
  Owner,
  Position,
  Settler,
  Signpost,
  signpostNavigationEnabled,
  WALK_RANGE_NODES,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import {
  hexDistanceBetween,
  nodeHxOfPosition,
  nodeHyOfPosition,
  nodeOfPosition,
} from '../../nav/halfcell.js';
import { hexNodeBox, type NodeBox, type SpatialGate, unionNodeBoxes } from '../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { isCarrierJobRow, isDruidJob, isFighterJob, isHunterJob, isScoutJob } from '../readviews/index.js';

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

function buildNetwork(world: World): ReadonlyMap<number, readonly SignpostSite[]> {
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

function refreshedMemo(world: World): NetworkMemo {
  const keys = networkKeys(world);
  const cached = networkMemo.get(world);
  if (cached !== undefined && sameKeys(cached.keys, keys)) return cached;
  if (
    cached !== undefined &&
    cached.keys.membership === keys.membership &&
    cached.keys.values === keys.values &&
    ownersUnchanged(world, cached.byPlayer)
  ) {
    cached.keys = keys;
    return cached;
  }
  const memo = { keys, revision: (cached?.revision ?? 0) + 1, byPlayer: buildNetwork(world) };
  networkMemo.set(world, memo);
  if (!verifierRegistered.has(world)) {
    verifierRegistered.add(world);
    world.registerCacheVerifier('signpostNetwork', () => verifyNetwork(world));
  }
  return memo;
}

/** The current signpost network, rebuilt only when a signpost rises, falls, relinks or changes hands. */
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
 * and weighs only the two nearest guides on each side, where this gate tests hex distance (plus the
 * static terrain component for the catch) and opens every group with a post in range.
 */
export type NavigationLimit = SpatialGate;

/** One settler's memoized limit plus every input it derives from. Each input is re-checked on read, so a
 *  stale entry can never be served and the memo needs no coherence verifier. `terrain` and `content` are
 *  per-world constants, so they need no slot. */
interface LimitMemoEntry {
  readonly hx: number;
  readonly hy: number;
  readonly player: number;
  readonly jobType: number | null;
  readonly networkRevision: number;
  readonly limit: NavigationLimit | null;
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
 * mapless sim, a non-settler or unowned target, or an exempt job. The `signpostNavigationEnabled` toggle
 * is read live on every call, since an in-place rules flip bumps no generation, so it needs no memo slot.
 */
export function navigationLimitFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  e: Entity,
): NavigationLimit | null {
  if (!signpostNavigationEnabled(world)) return null;
  const settler = world.tryGet(e, Settler);
  const owner = world.tryGet(e, Owner);
  const p = world.tryGet(e, Position);
  if (settler === undefined || owner === undefined || p === undefined) return null;
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.y);
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
 * The area an equipment fetch may shop in: the settler's own confinement, or for a job that walks the
 * map unconfined (a fighter, a scout) the network at its feet. Source basis: the original's
 * equipment search floods 40 nodes around the human, whatever its job, and then asks the
 * guide link systems that flood reached; without a bound a soldier would cross the whole map for a sword
 * lying in a far field. Approximation: the feet network reuses the 50-node walk range as a hex
 * distance, not a 40-node walkable flood. Null only when nothing confines anyone (navigation off, an
 * unowned or mapless target).
 */
export function equipFetchLimitFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  e: Entity,
): NavigationLimit | null {
  const own = navigationLimitFor(world, content, terrain, e);
  if (own !== null) return own;
  const owner = world.tryGet(e, Owner);
  const p = world.tryGet(e, Position);
  if (owner === undefined || p === undefined) return null;
  return networkLimitAt(world, terrain, owner.player, nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
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
  // The original routes soldiers, heroes, scouts, hunters and druids over its global walk sectors
  // instead.
  if (
    isScoutJob(content, jobType) ||
    isFighterJob(content, jobType) ||
    isHunterJob(content, jobType) ||
    isDruidJob(content, jobType)
  )
    return null;
  return networkLimitAt(world, terrain, player, hx, hy, walkRangeOf(content, jobType));
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
  return component === -1 ? null : component;
}

/** The posts of the signpost groups one catch opens, shared by every settler of the player whose catch
 *  opens the same groups under the same range, and answering "strictly inside a post's range" from a
 *  bitmap over {@link bounds} painted on first use. */
class CaughtPosts {
  readonly bounds: NodeBox;
  private readonly width: number;
  private coverage: Uint8Array | undefined;

  constructor(
    private readonly posts: readonly SignpostSite[],
    private readonly range: number,
  ) {
    this.bounds = unionNodeBoxes(posts.map((s) => hexNodeBox(s.hx, s.hy, range)));
    this.width = this.bounds.maxX - this.bounds.minX + 1;
  }

  covers(x: number, y: number): boolean {
    const { minX, maxX, minY, maxY } = this.bounds;
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    const coverage = this.coverage ?? this.paint();
    return coverage[(y - minY) * this.width + (x - minX)] === 1;
  }

  /** Marks every node with `hexDistanceBetween(post, node) < range`, row by row: on a row `rows` off the
   *  post that holds for `|dx| < lim`, `lim = range - rows + floor(rows / 2)`, and an odd `rows` reaches
   *  one node further east on an even node row and one further west on an odd one. */
  private paint(): Uint8Array {
    const { minX, maxY, minY } = this.bounds;
    const coverage = new Uint8Array(this.width * (maxY - minY + 1));
    for (const s of this.posts) {
      for (let y = s.hy - this.range + 1; y < s.hy + this.range; y++) {
        const rows = Math.abs(y - s.hy);
        const lim = this.range - rows + Math.floor(rows / 2);
        const oddRows = rows % 2 !== 0;
        const west = oddRows && y % 2 !== 0 ? lim : lim - 1;
        const east = oddRows && y % 2 === 0 ? lim : lim - 1;
        const rowStart = (y - minY) * this.width - minX;
        coverage.fill(1, rowStart + s.hx - west, rowStart + s.hx + east + 1);
      }
    }
    this.coverage = coverage;
    return coverage;
  }
}

/** The shared {@link CaughtPosts} of one network revision, keyed by player, range and the ascending
 *  caught groups. */
interface CaughtPostsMemo {
  readonly revision: number;
  readonly byCatch: Map<string, CaughtPosts>;
}

const caughtPostsMemo = new WeakMap<World, CaughtPostsMemo>();

function sharedCaughtPosts(
  world: World,
  revision: number,
  player: number,
  range: number,
  posts: readonly SignpostSite[],
  groups: readonly number[],
): CaughtPosts {
  let memo = caughtPostsMemo.get(world);
  if (memo === undefined || memo.revision !== revision) {
    memo = { revision, byCatch: new Map() };
    caughtPostsMemo.set(world, memo);
  }
  const key = `${player}:${range}:${groups.join(',')}`;
  let caught = memo.byCatch.get(key);
  if (caught === undefined) {
    caught = new CaughtPosts(
      posts.filter((s) => groups.includes(s.group)),
      range,
    );
    memo.byCatch.set(key, caught);
  }
  return caught;
}

/** A spot's confinement: the walk range around the spot itself, inclusive, plus whatever its caught
 *  posts cover. */
class SignpostConfinement implements NavigationLimit {
  readonly bounds: NodeBox;

  constructor(
    private readonly terrain: TerrainGraph,
    private readonly hx: number,
    private readonly hy: number,
    private readonly range: number,
    private readonly caught: CaughtPosts | null,
  ) {
    const own = hexNodeBox(hx, hy, range);
    this.bounds = caught === null ? own : unionNodeBoxes([own, caught.bounds]);
  }

  allowsNode(node: NodeId): boolean {
    const x = this.terrain.xOf(node);
    const y = this.terrain.yOf(node);
    if (hexDistanceBetween(this.hx, this.hy, x, y) <= this.range) return true;
    return this.caught?.covers(x, y) === true;
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
  const network = refreshedMemo(world);
  const posts = network.byPlayer.get(player) ?? [];
  // A post is caught when it stands inside the range and on ground the spot connects to; a caught post
  // opens its whole group.
  const here = componentAt(terrain, hx, hy);
  const groups: number[] = [];
  for (const s of posts) {
    if (groups.includes(s.group)) continue;
    if (hexDistanceBetween(hx, hy, s.hx, s.hy) >= range) continue;
    if (here !== null && componentAt(terrain, s.hx, s.hy) !== here) continue;
    groups.push(s.group);
  }
  groups.sort((a, b) => a - b);
  const caught =
    groups.length === 0 ? null : sharedCaughtPosts(world, network.revision, player, range, posts, groups);
  return new SignpostConfinement(terrain, hx, hy, range, caught);
}
