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
 *  over by re-adding the owner. */
interface NetworkVersion {
  readonly membership: number;
  readonly values: number;
  readonly owners: number;
}

interface NetworkMemo {
  version: NetworkVersion;
  byPlayer: ReadonlyMap<number, readonly SignpostSite[]>;
}

/** Per-world memo; a verifier re-derives it on invariant-checked runs. */
const networkMemo = new WeakMap<World, NetworkMemo>();
const verifierRegistered = new WeakSet<World>();

function networkVersion(world: World): NetworkVersion {
  return {
    membership: world.componentGeneration(Signpost),
    values: world.componentValueGeneration(Signpost),
    owners: world.componentGeneration(Owner),
  };
}

function sameVersion(a: NetworkVersion, b: NetworkVersion): boolean {
  return a.membership === b.membership && a.values === b.values && a.owners === b.owners;
}

function buildNetwork(world: World): ReadonlyMap<number, readonly SignpostSite[]> {
  // Collect per player in canonical (ascending entity id) order - group labels derive from ids, so the
  // result is independent of store insertion history.
  const perPlayer = new Map<number, { entity: Entity; hx: number; hy: number; links: readonly Entity[] }[]>();
  for (const e of world.canonicalEntities()) {
    const post = world.tryGet(e, Signpost);
    if (post === undefined) continue;
    const p = world.tryGet(e, Position);
    const owner = world.tryGet(e, Owner);
    if (p === undefined || owner === undefined) continue;
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    let list = perPlayer.get(owner.player);
    if (list === undefined) {
      list = [];
      perPlayer.set(owner.player, list);
    }
    list.push({ entity: e, hx, hy, links: post.links });
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

/** The current signpost network, rebuilt only when a signpost rises, falls, relinks or changes hands. */
export function signpostNetwork(world: World): ReadonlyMap<number, readonly SignpostSite[]> {
  const version = networkVersion(world);
  const cached = networkMemo.get(world);
  if (cached !== undefined && sameVersion(cached.version, version)) return cached.byPlayer;
  const byPlayer = buildNetwork(world);
  networkMemo.set(world, { version, byPlayer });
  if (!verifierRegistered.has(world)) {
    verifierRegistered.add(world);
    world.registerCacheVerifier('signpostNetwork', () => verifyNetwork(world));
  }
  return byPlayer;
}

function verifyNetwork(world: World): string[] {
  const cached = networkMemo.get(world);
  if (cached === undefined || !sameVersion(cached.version, networkVersion(world))) return [];
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
  readonly network: NetworkVersion;
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
  const version = networkVersion(world);
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
    sameVersion(held.network, version)
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
    network: version,
    limit,
  });
  return limit;
}

/**
 * The area an equipment fetch may shop in: the settler's own confinement, or for a job that walks the
 * map unconfined (a fighter, a scout) the network at its feet. Source basis: the original's
 * `FindEquipment_Complex_Nearby` floods 40 nodes around the human, whatever its job, and then asks the
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
  const posts = signpostNetwork(world).get(player) ?? [];
  // A post is caught when it stands inside the range and on ground the spot connects to; a caught post
  // opens its whole group.
  const here = componentAt(terrain, hx, hy);
  const reachable = new Set<number>();
  for (const s of posts) {
    if (hexDistanceBetween(hx, hy, s.hx, s.hy) >= range) continue;
    if (here !== null && componentAt(terrain, s.hx, s.hy) !== here) continue;
    reachable.add(s.group);
  }
  const inRange: SignpostSite[] = [];
  const boxes: NodeBox[] = [hexNodeBox(hx, hy, range)];
  for (const s of posts) {
    if (!reachable.has(s.group)) continue;
    inRange.push(s);
    boxes.push(hexNodeBox(s.hx, s.hy, range));
  }
  return {
    bounds: unionNodeBoxes(boxes),
    allowsNode(node: NodeId): boolean {
      const cx = terrain.xOf(node);
      const cy = terrain.yOf(node);
      if (hexDistanceBetween(hx, hy, cx, cy) <= range) return true;
      for (const s of inRange) {
        if (hexDistanceBetween(s.hx, s.hy, cx, cy) < range) return true;
      }
      return false;
    },
  };
}
