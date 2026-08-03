import type { ContentSet } from '@open-northland/data';
import { Building, Owner, PathFollow, PathRequest, Position, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
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
 * Per-world calm-zone memo keyed on the `Building` and `Owner` membership generations plus terrain identity.
 * Positions are immutable once placed and ownership only changes by add or remove, so the key covers every
 * input, conservatively: `Owner` rides settlers too, so settler churn also bumps it.
 */
const zonesMemo = new WeakMap<
  World,
  { version: string; terrain: TerrainGraph; zones: Map<number, Set<NodeId>> }
>();

function zonesVersion(world: World): string {
  return `${world.componentGeneration(Building)}.${world.componentGeneration(Owner)}`;
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

/** The `verifyCaches` tripwire for a zone input {@link zonesVersion} fails to see. */
function verifyZonesMemo(world: World, terrain: TerrainGraph): string[] {
  const hit = zonesMemo.get(world);
  if (hit === undefined || hit.terrain !== terrain) return [];
  if (hit.version !== zonesVersion(world)) return []; // stale key - the next read rebuilds
  if (sameZones(hit.zones, deriveCalmZones(world, terrain))) return [];
  return [
    'calmZonesByPlayer memo diverges from a fresh derive - a building or owner changed without a generation bump',
  ];
}

/**
 * Every player's calm-zone node set: a Manhattan diamond of {@link CALM_ZONE_RADIUS_NODES} around each of
 * its buildings' anchor nodes. Membership-only, so iteration order cannot change an answer, and never hashed.
 */
export function calmZonesByPlayer(world: World, terrain: TerrainGraph): Map<number, Set<NodeId>> {
  const version = zonesVersion(world);
  const hit = zonesMemo.get(world);
  if (hit !== undefined && hit.version === version && hit.terrain === terrain) return hit.zones;
  const zones = deriveCalmZones(world, terrain);
  zonesMemo.set(world, { version, terrain, zones });
  world.registerCacheVerifier('calmZonesByPlayer', () => verifyZonesMemo(world, terrain));
  return zones;
}

/**
 * The nodes standing colliders block for routing, split by who is asking: `field` posts, outside their
 * owner's calm zone, block every collider requester, while `townByPlayer` posts block only other players'
 * requesters, so a player routes through its own garrison and an enemy is steered around it. Membership-only
 * and never hashed.
 */
export interface UnitWalkBlocks {
  readonly field: ReadonlySet<NodeId>;
  readonly townByPlayer: ReadonlyMap<number, ReadonlySet<NodeId>>;
}

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
 * The nodes standing colliders occupy regardless of calm zones: an approach cell someone already stands on
 * is a taken melee slot even inside a town garrison.
 */
export function standingFighterNodes(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  const nodes = new Set<NodeId>();
  eachStandingFighter(world, content, terrain, (_e, node) => nodes.add(node));
  return nodes;
}

export function unitWalkBlocks(world: World, content: ContentSet, terrain: TerrainGraph): UnitWalkBlocks {
  const zones = calmZonesByPlayer(world, terrain);
  const field = new Set<NodeId>();
  const townByPlayer = new Map<number, Set<NodeId>>();
  eachStandingFighter(world, content, terrain, (_e, node, player) => {
    if (zones.get(player)?.has(node)) {
      let town = townByPlayer.get(player);
      if (town === undefined) {
        town = new Set();
        townByPlayer.set(player, town);
      }
      town.add(node);
    } else {
      field.add(node);
    }
  });
  return { field, townByPlayer };
}
