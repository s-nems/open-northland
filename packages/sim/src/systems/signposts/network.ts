import type { ContentSet } from '@open-northland/data';
import {
  LOCAL_NAV_RADIUS_NODES,
  Owner,
  Position,
  Settler,
  Signpost,
  signpostNavigationEnabled,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition, nodeOfPosition } from '../../nav/halfcell.js';
import { nodeBoxOfCircles, type SpatialGate, withinNodeRadius } from '../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { isFighterJob, isHunterJob, isScoutJob } from '../readviews/index.js';

/**
 * The per-player signpost network: which signposts exist, where, and which belong to one connected group.
 * Two same-player signposts connect iff their navigation circles overlap, world-metric distance ≤ the sum
 * of their `navRadius`, and connectivity is transitive. Source basis: the tutorial_001 briefing requires
 * signposts to stay linked, so two groups on opposite map sides never merge.
 */
export interface SignpostSite {
  readonly entity: Entity;
  /** Anchor node coords on the half-cell lattice. */
  readonly hx: number;
  readonly hy: number;
  readonly navRadius: number;
  readonly spacingRadius: number;
  /** Canonical group label: the smallest signpost entity id in this connected group. */
  readonly group: number;
}

interface NetworkMemo {
  version: number;
  byPlayer: ReadonlyMap<number, readonly SignpostSite[]>;
}

/** Per-world memo keyed by the Signpost store's generation: signposts never move or mutate once erected,
 *  so only an erect or tear-down invalidates it. A verifier re-derives it on invariant-checked runs. */
const networkMemo = new WeakMap<World, NetworkMemo>();
const verifierRegistered = new WeakSet<World>();

function buildNetwork(world: World): ReadonlyMap<number, readonly SignpostSite[]> {
  // Collect per player in canonical (ascending entity id) order - group labels derive from ids, so the
  // result is independent of store insertion history.
  const perPlayer = new Map<
    number,
    { entity: Entity; hx: number; hy: number; nav: number; spacing: number }[]
  >();
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
    list.push({ entity: e, hx, hy, nav: post.navRadius, spacing: post.spacingRadius });
  }
  const byPlayer = new Map<number, readonly SignpostSite[]>();
  for (const [player, posts] of perPlayer) {
    // Union-find over this player's posts: connected iff the nav circles overlap. O(n²) pairs - a
    // player's signposts number in the dozens, and this runs only when one is erected/torn down.
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
      for (let j = i + 1; j < posts.length; j++) {
        const b = posts[j];
        if (b !== undefined && withinNodeRadius(a.hx, a.hy, b.hx, b.hy, a.nav + b.nav)) {
          parent[find(j)] = find(i);
        }
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
      posts.map((p, i) => ({
        entity: p.entity,
        hx: p.hx,
        hy: p.hy,
        navRadius: p.nav,
        spacingRadius: p.spacing,
        group: label.get(find(i)) as number,
      })),
    );
  }
  return byPlayer;
}

/** The current signpost network, rebuilt only when a signpost is erected or torn down. */
export function signpostNetwork(world: World): ReadonlyMap<number, readonly SignpostSite[]> {
  const version = world.componentGeneration(Signpost);
  const cached = networkMemo.get(world);
  if (cached !== undefined && cached.version === version) return cached.byPlayer;
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
  if (cached === undefined || cached.version !== world.componentGeneration(Signpost)) return [];
  const fresh = buildNetwork(world);
  if (JSON.stringify([...fresh]) !== JSON.stringify([...cached.byPlayer])) {
    return ['signpostNetwork memo is stale - a Signpost mutation missed the component generation'];
  }
  return [];
}

/**
 * One settler's navigation confinement as a {@link SpatialGate}: the union of its local circle, radius
 * {@link LOCAL_NAV_RADIUS_NODES} around where it stands, and the nav circles of every signpost group that
 * circle reaches. Every rule keys on `allowsNode`; `bounds` lets searches shrink their scans.
 *
 * Approximation: the local circle re-centres on every query, so repeated in-circle hops can walk a unit
 * arbitrarily far outside the network, one local radius at a time. The original's anchor is not decoded.
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
  readonly signpostVersion: number;
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
 * mapless sim, a non-settler or unowned target, or an exempt job. Source basis: observed original
 * behaviour, the scout and every fighter roam globally. The `signpostNavigationEnabled` toggle is read
 * live on every call, since an in-place rules flip bumps no generation, so it needs no memo slot.
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
  const signpostVersion = world.componentGeneration(Signpost);
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
    held.signpostVersion === signpostVersion
  ) {
    return held.limit;
  }
  const limit = computeNavigationLimit(world, content, terrain, settler.jobType, owner.player, hx, hy);
  if (memo.entries.size >= memo.sweepAt) sweepDeadEntries(world, memo);
  memo.entries.set(e, { hx, hy, player: owner.player, jobType: settler.jobType, signpostVersion, limit });
  return limit;
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
  // Scouts, fighters, and hunters roam globally; an authored rule bounds the hunter by its own work flag
  // instead.
  if (isScoutJob(content, jobType) || isFighterJob(content, jobType) || isHunterJob(content, jobType))
    return null;
  return networkLimitAt(world, terrain, player, hx, hy);
}

/** The confinement a spot carries whoever stands on it: the local circle around `(hx, hy)` unioned with the
 *  nav circles of every signpost group it reaches. {@link navigationLimitFor} adds the per-job exemptions,
 *  which an errand does not inherit. */
export function networkLimitAt(
  world: World,
  terrain: TerrainGraph,
  player: number,
  hx: number,
  hy: number,
): NavigationLimit | null {
  if (!signpostNavigationEnabled(world)) return null;
  const posts = signpostNetwork(world).get(player) ?? [];
  // Reachable groups: a group counts iff some member's nav circle intersects the local circle.
  const reachable = new Set<number>();
  for (const s of posts) {
    if (withinNodeRadius(hx, hy, s.hx, s.hy, s.navRadius + LOCAL_NAV_RADIUS_NODES)) {
      reachable.add(s.group);
    }
  }
  const inRange: SignpostSite[] = [];
  const circles = [{ x: hx, y: hy, r: LOCAL_NAV_RADIUS_NODES }];
  for (const s of posts) {
    if (!reachable.has(s.group)) continue;
    inRange.push(s);
    circles.push({ x: s.hx, y: s.hy, r: s.navRadius });
  }
  const bounds = nodeBoxOfCircles(circles);
  return {
    bounds,
    allowsNode(node: NodeId): boolean {
      const cx = terrain.xOf(node);
      const cy = terrain.yOf(node);
      if (withinNodeRadius(hx, hy, cx, cy, LOCAL_NAV_RADIUS_NODES)) return true;
      for (const s of inRange) {
        if (withinNodeRadius(s.hx, s.hy, cx, cy, s.navRadius)) return true;
      }
      return false;
    },
  };
}
