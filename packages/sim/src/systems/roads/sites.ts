import type { ContentSet } from '@open-northland/data';
import {
  ownerOf,
  Position,
  RoadSite,
  SiteAssignment,
  Stockpile,
  SupplyRun,
  stampOwner,
  UnderConstruction,
  Vehicle,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import { fx } from '../../core/fixed.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import { hexNeighboursOf, nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { scatterSpilledStock, spilledStockOf } from '../economy/goods-spill.js';
import { siteClaimHolder } from '../economy/site-claim.js';
import { placementBlockerGrid } from '../footprint/placement/blocker-grid.js';
import { OBSTACLE, vehicleBlockerCells } from '../footprint/placement/blockers.js';
import { type PlacementProbe, placementBlockerVersion } from '../footprint/placement/index.js';
import { vehicleAnchorRevision } from '../footprint/vehicle-anchors.js';
import { isRoad, layRoad, roadRevision } from './index.js';

/** The good a road is paved with, by catalog slug. Original behavior: a road site costs one stone. */
const ROAD_GOOD_SLUG = 'stone';
const ROAD_STONES_PER_SITE = 1;

/** A road site's bill, minted fresh per site. Empty when the content has no stone, as a wall's bill is
 *  when it has no wood. */
export function roadConstructionBill(content: ContentSet): { goodType: number; amount: number }[] {
  const stone = contentIndex(content).goodTypeBySlug.get(ROAD_GOOD_SLUG);
  return stone === undefined ? [] : [{ goodType: stone, amount: ROAD_STONES_PER_SITE }];
}

/**
 * Where a road may be ordered, shared by the UI ghost and the command: walkable land clear of every body
 * a wall segment would also refuse - a building, a resource, a signpost, a wall, a scripted blocker - and
 * not already a road or a road site. A road is flat, so settlers, animals and parked vehicles standing
 * there never block it. Project rule, after the wall's placement.
 */
export function roadSitePlacementProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): PlacementProbe {
  const grid = placementBlockerGrid(world, content, terrain);
  const sites = roadSitesByNode(world, terrain);
  const vehicles = vehicleObstacleCounts(world, content, terrain);
  return {
    canPlace: (x, y) => {
      if (!terrain.inBounds(x, y)) return false;
      const node = terrain.nodeAt(x, y);
      const slot = y * terrain.width + x;
      return (
        terrain.isWalkable(node) &&
        (grid.obstacle[slot] ?? 0) <= (vehicles.get(slot) ?? 0) &&
        (grid.palisadeBody[slot] ?? 0) === 0 &&
        !isRoad(world, node) &&
        !sites.has(node)
      );
    },
  };
}

/** A token that changes whenever {@link roadSitePlacementProbe} may answer differently. */
export function roadSitePlacementVersion(world: World): string {
  return `${placementBlockerVersion(world)}.${roadRevision(world)}.${world.componentGeneration(RoadSite)}`;
}

interface VehicleObstacles {
  readonly key: string;
  readonly counts: Map<number, number>;
}

const vehicleObstacles = new WeakMap<World, VehicleObstacles>();

/** How many parked vehicle discs stamp each node's obstacle count, by `y * width + x` slot, so the road
 *  probe can discount them. Rebuilt when a vehicle comes, goes or enters a node; derived read state. */
function vehicleObstacleCounts(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): ReadonlyMap<number, number> {
  const key = `${world.componentGeneration(Vehicle)}.${vehicleAnchorRevision(world)}`;
  const held = vehicleObstacles.get(world);
  if (held !== undefined && held.key === key) return held.counts;
  const counts = new Map<number, number>();
  for (const e of world.query(Vehicle, Position)) {
    vehicleBlockerCells(world, content, e, (x, y, channel) => {
      if (channel !== OBSTACLE || !terrain.inBounds(x, y)) return;
      const slot = y * terrain.width + x;
      counts.set(slot, (counts.get(slot) ?? 0) + 1);
    });
  }
  vehicleObstacles.set(world, { key, counts });
  return counts;
}

export function placeRoadSite(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'placeRoadSite' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined || !terrain.inBounds(command.x, command.y)) return;
  const node = terrain.nodeAt(command.x, command.y);
  if (command.force === true) {
    if (isRoad(world, node) || roadSitesByNode(world, terrain).has(node)) return;
  } else if (!roadSitePlacementProbe(world, ctx.content, terrain).canPlace(command.x, command.y)) {
    return;
  }
  const e = world.create();
  world.add(e, Position, positionOfNode(command.x, command.y));
  world.add(e, RoadSite, {
    tribe: command.tribe,
    construction: roadConstructionBill(ctx.content),
    reservation: null,
  });
  world.add(e, Stockpile, { amounts: new Map<number, number>() });
  world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  stampOwner(world, e, command.owner);
}

/** Withdraw a road site: its claim holder is let go and any delivered stone drops beside it. */
export function cancelRoadSite(world: World, ctx: SystemContext, site: Entity): void {
  if (!world.has(site, RoadSite)) return;
  const spill = spilledStockOf(world, site);
  removeRoadSite(world, site);
  scatterSpilledStock(world, ctx, spill);
}

/**
 * Lay a finished road site. Its stone paves its own node and every lattice neighbour holding a site of the
 * same owner that no builder has claimed and no stone has reached or is on its way to; those sites are
 * spent. A claimed or supplied neighbour keeps its own build. Original behavior.
 */
export function finishRoadSite(world: World, ctx: SystemContext, site: Entity): void {
  const terrain = ctx.terrain;
  const p = world.tryGet(site, Position);
  if (terrain === undefined || p === undefined) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const owner = ownerOf(world, site);
  const sites = roadSitesByNode(world, terrain);
  const absorbed: Entity[] = [];
  let supplied: Set<Entity> | undefined;
  const suppliedSites = (): ReadonlySet<Entity> => (supplied ??= sitesWithSupplyInbound(world));
  for (const n of hexNeighboursOf(hx, hy)) {
    if (!terrain.inBounds(n.hx, n.hy)) continue;
    const neighbour = sites.get(terrain.nodeAt(n.hx, n.hy));
    if (
      neighbour !== undefined &&
      neighbour !== site &&
      ownerOf(world, neighbour) === owner &&
      absorbable(world, neighbour, suppliedSites)
    ) {
      absorbed.push(neighbour);
    }
  }
  const nodes: NodeId[] = [terrain.nodeAt(hx, hy)];
  for (const e of absorbed) {
    const at = world.get(e, Position);
    const n = nodeOfPosition(at.x, at.y);
    nodes.push(terrain.nodeAt(n.hx, n.hy));
  }
  removeRoadSite(world, site);
  for (const e of absorbed) removeRoadSite(world, e);
  layRoad(world, terrain, nodes);
}

/** Every site a live supply errand is bringing material to; built only when a neighbour gets this far. */
function sitesWithSupplyInbound(world: World): Set<Entity> {
  const sites = new Set<Entity>();
  for (const e of world.query(SupplyRun)) sites.add(world.get(e, SupplyRun).site);
  return sites;
}

/** A neighbour the finishing stone may pave: unclaimed, holding nothing and awaiting no delivery. */
function absorbable(world: World, site: Entity, supplied: () => ReadonlySet<Entity>): boolean {
  if (siteClaimHolder(world, site) !== null) return false;
  for (const amount of world.get(site, Stockpile).amounts.values()) if (amount > 0) return false;
  return !supplied().has(site);
}

/** Destroy a road site, letting go of the builder whose assignment names it. */
function removeRoadSite(world: World, site: Entity): void {
  const builder = world.get(site, RoadSite).reservation?.builder;
  if (builder !== undefined && world.tryGet(builder, SiteAssignment)?.site === site) {
    world.remove(builder, SiteAssignment);
  }
  world.destroy(site);
}

interface RoadSiteIndex {
  readonly terrain: TerrainGraph;
  readonly feed: ChangeFeed;
  readonly byNode: Map<NodeId, Entity>;
  readonly nodeOf: Map<Entity, NodeId>;
}

const indexes = new WeakMap<World, RoadSiteIndex>();

/**
 * The road sites by node, kept per world from a change feed, so a placement probe or a finish costs the
 * sites that changed rather than a walk over every site. The feed watches RoadSite membership alone: a
 * site takes its Position first and never moves. One node holds at most one site. Derived read state,
 * never hashed.
 */
export function roadSitesByNode(world: World, terrain: TerrainGraph): ReadonlyMap<NodeId, Entity> {
  let index = indexes.get(world);
  if (index === undefined || index.terrain !== terrain) {
    index = {
      terrain,
      feed: world.watchChanges([RoadSite], []),
      byNode: new Map(),
      nodeOf: new Map(),
    };
    indexes.set(world, index);
    rebuildIndex(world, index);
    world.registerCacheVerifier('roadSitesByNode', () => verifyIndex(world));
    return index.byNode;
  }
  const current = index;
  const lost = current.feed.drain((e) => refreshEntry(world, current, e));
  if (lost) rebuildIndex(world, current);
  return current.byNode;
}

function refreshEntry(world: World, index: RoadSiteIndex, e: Entity): void {
  const held = index.nodeOf.get(e);
  if (held !== undefined) {
    index.nodeOf.delete(e);
    if (index.byNode.get(held) === e) index.byNode.delete(held);
  }
  const p = world.has(e, RoadSite) ? world.tryGet(e, Position) : undefined;
  if (p === undefined) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const node = index.terrain.nodeAtClamped(hx, hy);
  index.nodeOf.set(e, node);
  index.byNode.set(node, e);
}

function rebuildIndex(world: World, index: RoadSiteIndex): void {
  index.byNode.clear();
  index.nodeOf.clear();
  for (const e of world.canonicalQuery(RoadSite, Position)) refreshEntry(world, index, e);
}

function verifyIndex(world: World): string[] {
  const index = indexes.get(world);
  if (index === undefined || index.feed.pending) return [];
  const live = world.canonicalQuery(RoadSite, Position);
  if (live.length !== index.nodeOf.size || live.some((e) => !index.nodeOf.has(e))) {
    return ['roadSitesByNode diverges from the live road sites'];
  }
  return [];
}
