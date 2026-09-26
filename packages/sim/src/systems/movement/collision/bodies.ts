import type { ContentSet } from '@open-northland/data';
import { Building, Owner, PathFollow, PathRequest, Position, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import { nodeHxOfPosition, nodeHyOfPosition, nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { isFighterJob } from '../../readviews/index.js';

/**
 * Unit body collision is an authored deviation: the original is observed letting walkers pass through each
 * other. Soft movers (any owned walking settler) nudge each other apart; firm movers (owned fighters) also
 * resolve against posts, a firm collider standing still, whose nodes enter the walk overlay. Everyone else
 * is a ghost that passes through, which keeps converging economy flows unjammable.
 */

/**
 * The Manhattan node radius of a player's calm zone around each of its buildings. Inside its own zone a firm
 * mover drops to the soft tier and its posts stay out of that player's walk overlay; enemies get no
 * exemption. Approximation: sized to cover a building footprint plus its door approaches.
 */
const CALM_ZONE_RADIUS_NODES = 8;

/** Whether `e` is a firm collider: an owned fighter. */
export function hasBodyCollision(world: World, content: ContentSet, e: Entity): boolean {
  if (!world.has(e, Owner)) return false;
  const settler = world.tryGet(e, Settler);
  return settler !== undefined && isFighterJob(content, settler.jobType);
}

/**
 * Whether `e` takes part in soft mover-vs-mover separation: any owned settler, fighter or civilian. The Owner
 * gate keeps unowned fixtures and goldens byte-identical.
 */
export function hasSoftCollision(world: World, e: Entity): boolean {
  return world.has(e, Owner) && world.has(e, Settler);
}

/** Whether `e` is standing for collision purposes: not walking and not waiting on a live route, since a
 *  pending request means it is about to leave the node. A failed request counts as standing. */
export function isStanding(world: World, e: Entity): boolean {
  if (world.has(e, PathFollow)) return false;
  const req = world.tryGet(e, PathRequest);
  return req === undefined || req.failed;
}

/**
 * Per-world calm-zone memo. The zones read each owned building's anchor and player, and positions are
 * immutable once placed. A building joining or leaving bumps the Building generation; an Owner stamped
 * on or dropped from a building shows in the Owner journal, which also carries every owned settler's
 * birth and death, so only its building entries rebuild. An in-place Owner write rebuilds too.
 */
interface ZonesMemo {
  readonly terrain: TerrainGraph;
  readonly buildingGeneration: number;
  readonly ownerValueGeneration: number;
  /** Advanced past Owner changes that touched no building. */
  ownerGeneration: number;
  readonly zones: Map<number, Set<NodeId>>;
}

const zonesMemo = new WeakMap<World, ZonesMemo>();

/** Whether `memo` still describes `world`'s buildings. Pure, so the verifier asks it too. */
function zonesCurrent(world: World, terrain: TerrainGraph, memo: ZonesMemo): boolean {
  if (
    memo.terrain !== terrain ||
    memo.buildingGeneration !== world.componentGeneration(Building) ||
    memo.ownerValueGeneration !== world.componentValueGeneration(Owner)
  ) {
    return false;
  }
  if (memo.ownerGeneration === world.componentGeneration(Owner)) return true;
  const changed = world.membershipDeltasSince(Owner, memo.ownerGeneration);
  if (changed === null) return false;
  for (const e of changed) if (world.has(e, Building)) return false;
  return true;
}

/** The single derivation path shared by the memo rebuild and its verifier. */
function deriveCalmZones(world: World, terrain: TerrainGraph): Map<number, Set<NodeId>> {
  const zones = new Map<number, Set<NodeId>>();
  for (const b of world.query(Building, Position)) {
    const owner = world.tryGet(b, Owner);
    if (owner === undefined) continue;
    let zone = zones.get(owner.player);
    if (zone === undefined) {
      zone = new Set();
      zones.set(owner.player, zone);
    }
    const p = world.get(b, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    for (let dx = -CALM_ZONE_RADIUS_NODES; dx <= CALM_ZONE_RADIUS_NODES; dx++) {
      const rem = CALM_ZONE_RADIUS_NODES - Math.abs(dx);
      for (let dy = -rem; dy <= rem; dy++) {
        if (terrain.inBounds(hx + dx, hy + dy)) zone.add(terrain.nodeAt(hx + dx, hy + dy));
      }
    }
  }
  return zones;
}

function sameZones(
  a: ReadonlyMap<number, ReadonlySet<NodeId>>,
  b: ReadonlyMap<number, ReadonlySet<NodeId>>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [player, zone] of a) {
    const other = b.get(player);
    if (other === undefined || other.size !== zone.size) return false;
    for (const node of zone) if (!other.has(node)) return false;
  }
  return true;
}

/** The `verifyCaches` tripwire for a zone input {@link zonesCurrent} fails to see. */
function verifyZonesMemo(world: World, terrain: TerrainGraph): string[] {
  const hit = zonesMemo.get(world);
  if (hit === undefined || !zonesCurrent(world, terrain, hit)) return []; // stale - the next read rebuilds
  if (sameZones(hit.zones, deriveCalmZones(world, terrain))) return [];
  return ['calmZonesByPlayer memo diverges from a fresh derive - a building or owner change went unseen'];
}

/**
 * Every player's calm-zone node set: a Manhattan diamond of {@link CALM_ZONE_RADIUS_NODES} around each of
 * its buildings' anchor nodes. Membership-only, so iteration order cannot change an answer, and never hashed.
 */
export function calmZonesByPlayer(world: World, terrain: TerrainGraph): Map<number, Set<NodeId>> {
  const hit = zonesMemo.get(world);
  if (hit !== undefined && zonesCurrent(world, terrain, hit)) {
    hit.ownerGeneration = world.componentGeneration(Owner);
    return hit.zones;
  }
  world.journalMembership(Owner);
  const memo: ZonesMemo = {
    terrain,
    buildingGeneration: world.componentGeneration(Building),
    ownerValueGeneration: world.componentValueGeneration(Owner),
    ownerGeneration: world.componentGeneration(Owner),
    zones: deriveCalmZones(world, terrain),
  };
  zonesMemo.set(world, memo);
  world.registerCacheVerifier('calmZonesByPlayer', () => verifyZonesMemo(world, terrain));
  return memo.zones;
}

/**
 * The nodes standing colliders block for routing, split by who is asking: every post blocks every collider
 * requester, except that a post inside its owner's calm zone is town garrison, which its own player routes
 * through while an enemy is steered around it. Membership-only and never hashed.
 *
 * `posts` is a per-graph scratch shared by every build, so a holder calls `release` before the next one.
 */
export interface UnitWalkBlocks {
  /** Row-major posts per node, field and town alike, zero off every post. */
  readonly posts: Uint16Array;
  /** How many posts {@link posts} counts in total. */
  readonly postTotal: number;
  /** Per player, its own town posts per node: the share of {@link posts} that never blocks that player. */
  readonly townByPlayer: ReadonlyMap<number, ReadonlyMap<NodeId, number>>;
  /** Zero the counted nodes again, invalidating this view. */
  release(): void;
}

const postScratch = new WeakMap<TerrainGraph, Uint16Array>();

/** Visit every post with its in-bounds node and owning player. */
function eachStandingFighter(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  visit: (e: Entity, node: NodeId, player: number) => void,
): void {
  for (const e of world.query(Settler, Position)) {
    if (!hasBodyCollision(world, content, e) || !isStanding(world, e)) continue;
    const p = world.get(e, Position);
    const hx = nodeHxOfPosition(p.x, p.y);
    const hy = nodeHyOfPosition(p.y);
    if (!terrain.inBounds(hx, hy)) continue;
    visit(e, terrain.nodeAt(hx, hy), world.get(e, Owner).player);
  }
}

/**
 * The nodes standing colliders occupy regardless of calm zones, each with the player standing there: an
 * approach cell someone already stands on is a taken melee slot even inside a town garrison. Two soft-
 * stacked bodies on one node keep the later one's player.
 */
export function standingFighterPosts(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): ReadonlyMap<NodeId, number> {
  const posts = new Map<NodeId, number>();
  eachStandingFighter(world, content, terrain, (_e, node, player) => posts.set(node, player));
  return posts;
}

export function unitWalkBlocks(world: World, content: ContentSet, terrain: TerrainGraph): UnitWalkBlocks {
  let posts = postScratch.get(terrain);
  if (posts === undefined) {
    posts = new Uint16Array(terrain.nodeCount);
    postScratch.set(terrain, posts);
  }
  const counts = posts;
  const stamped: NodeId[] = [];
  const zones = calmZonesByPlayer(world, terrain);
  const townByPlayer = new Map<number, Map<NodeId, number>>();
  eachStandingFighter(world, content, terrain, (_e, node, player) => {
    counts[node] = (counts[node] ?? 0) + 1;
    stamped.push(node);
    if (!zones.get(player)?.has(node)) return;
    let town = townByPlayer.get(player);
    if (town === undefined) {
      town = new Map();
      townByPlayer.set(player, town);
    }
    town.set(node, (town.get(node) ?? 0) + 1);
  });
  return {
    posts: counts,
    postTotal: stamped.length,
    townByPlayer,
    release: () => {
      for (const node of stamped) counts[node] = 0;
    },
  };
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
    let ownPosts = 0;
    for (const count of this.ownTown?.values() ?? []) ownPosts += count;
    // 0 exactly when nothing blocks this requester, which lets the search skip its pocket probe.
    this.size = dynamic.size + units.postTotal - ownPosts;
  }
  has(node: NodeId): boolean {
    if (this.dynamic.has(node)) return true;
    const posts = this.posts[node] ?? 0;
    return posts > 0 && posts > (this.ownTown?.get(node) ?? 0);
  }
}
