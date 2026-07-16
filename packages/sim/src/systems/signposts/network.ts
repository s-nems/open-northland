import {
  LOCAL_NAV_RADIUS_NODES,
  Owner,
  Position,
  Settler,
  Signpost,
  signpostNavigationEnabled,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { isFighterJob, SCOUT_JOB } from '../readviews/index.js';
import { type NodeBox, nodeBoxOfCircles, withinNodeRadius } from './geometry.js';

/**
 * The per-player SIGNPOST NETWORK — which signposts exist, where, and which belong to one connected
 * group. Two same-player signposts are connected iff their navigation circles OVERLAP (world-metric
 * distance ≤ the sum of their `navRadius`), and connectivity is transitive: the original's rule that
 * signposts must stay linked for settlers to travel between them ("Make sure the signposts are always
 * connected!" — tutorial_001 briefing, source basis). Two groups on opposite map sides never merge, so
 * a settler cannot cross between them.
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

/** Per-world memo of the network, keyed by the Signpost store's add/remove generation — signposts never
 *  move or mutate once erected, so the memo can only be invalidated by an erect/tear-down. A coherence
 *  verifier re-derives it on invariant-checked runs (the `cachesCoherent` contract for derived state
 *  that feeds sim decisions). */
const networkMemo = new WeakMap<World, NetworkMemo>();
const verifierRegistered = new WeakSet<World>();

function buildNetwork(world: World): ReadonlyMap<number, readonly SignpostSite[]> {
  // Collect per player in canonical (ascending entity id) order — group labels derive from ids, so the
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
    // Union-find over this player's posts: connected iff the nav circles overlap. O(n²) pairs — a
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
    return ['signpostNetwork memo is stale — a Signpost mutation missed the component generation'];
  }
  return [];
}

/**
 * One settler's navigation confinement: the union of its LOCAL circle (radius
 * {@link LOCAL_NAV_RADIUS_NODES} around where it stands) and the nav circles of every signpost group it
 * can reach — a group is reachable iff some member's circle intersects the settler's local circle. The
 * whole of the user-facing rule keys on {@link allowsNode}: a gatherer only harvests, a worker only
 * fetches, a builder only builds, and a move order only walks to an allowed node.
 */
export interface NavigationLimit {
  /** Whether `node` lies inside this settler's allowed area. */
  allowsNode(node: NodeId): boolean;
  /** A box provably containing every allowed node ({@link nodeBoxOfCircles}) — lets a search BOUND its
   *  scan/ring expansion to the confined area; membership stays {@link allowsNode}'s call. */
  readonly bounds: NodeBox;
}

/** `limit` as the optional cell-gate shape the target queries take (`InteractionCellIndex.nearest`,
 *  `nearestHarvestableFor`): undefined for an unlimited settler, else the allowsNode membership test. */
export function cellGateOf(limit: NavigationLimit | null): ((cell: NodeId) => boolean) | undefined {
  return limit === null ? undefined : (cell) => limit.allowsNode(cell);
}

/**
 * The navigation limit confining settler `e`, or `null` when it is UNLIMITED: signpost navigation off
 * (the default — every pre-signpost world), a mapless sim, a non-settler/unowned target, or an exempt
 * job — the scout and every fighter roam globally (source basis: observed original behaviour; the
 * user-specified rule set).
 */
export function navigationLimitFor(world: World, terrain: TerrainGraph, e: Entity): NavigationLimit | null {
  if (!signpostNavigationEnabled(world)) return null;
  const settler = world.tryGet(e, Settler);
  const owner = world.tryGet(e, Owner);
  const p = world.tryGet(e, Position);
  if (settler === undefined || owner === undefined || p === undefined) return null;
  if (settler.jobType === SCOUT_JOB || isFighterJob(settler.jobType)) return null;
  const here = nodeOfPosition(p.x, p.y);
  const posts = signpostNetwork(world).get(owner.player) ?? [];
  // Reachable groups: a group counts iff some member's nav circle intersects the local circle.
  const reachable = new Set<number>();
  for (const s of posts) {
    if (withinNodeRadius(here.hx, here.hy, s.hx, s.hy, s.navRadius + LOCAL_NAV_RADIUS_NODES)) {
      reachable.add(s.group);
    }
  }
  const inRange = posts.filter((s) => reachable.has(s.group));
  const bounds = nodeBoxOfCircles([
    { x: here.hx, y: here.hy, r: LOCAL_NAV_RADIUS_NODES },
    ...inRange.map((s) => ({ x: s.hx, y: s.hy, r: s.navRadius })),
  ]);
  return {
    bounds,
    allowsNode(node: NodeId): boolean {
      const c = terrain.coordsOf(node);
      if (withinNodeRadius(here.hx, here.hy, c.x, c.y, LOCAL_NAV_RADIUS_NODES)) return true;
      for (const s of inRange) {
        if (withinNodeRadius(s.hx, s.hy, c.x, c.y, s.navRadius)) return true;
      }
      return false;
    },
  };
}
