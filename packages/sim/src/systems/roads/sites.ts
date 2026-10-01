import type { ContentSet } from '@open-northland/data';
import {
  ownerOf,
  Palisade,
  Position,
  RoadSite,
  SiteAssignment,
  Stockpile,
  stampOwner,
  UnderConstruction,
  Vehicle,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexNeighboursOf, nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { scatterSpilledStock, spilledStockOf } from '../economy/goods-spill.js';
import { siteClaimHolder } from '../economy/site-claim.js';
import { placementBlockerGrid } from '../footprint/placement/blocker-grid.js';
import {
  type BlockerVisit,
  BUILDING_STORE,
  OBSTACLE,
  PALISADE_BODY,
  palisadeBodyCells,
  UPGRADE_RESERVE,
  vehicleBlockerCells,
} from '../footprint/placement/blockers.js';
import { type PlacementProbe, placementBlockerVersion } from '../footprint/placement/index.js';
import { vehicleAnchorRevision } from '../footprint/vehicle-anchors.js';
import { canonicalById } from '../spatial/nodes.js';
import { layRoad, liftRoad, roadRevision } from './index.js';
import { roadSitesByNode } from './site-index.js';

/** The good a road is paved with, by catalog slug. Original behavior: a road site costs one stone. */
const ROAD_GOOD_SLUG = 'stone';
const ROAD_STONES_PER_SITE = 1;

/** The good a road is paved with in this content, or undefined when it has no stone. */
export function roadPavingGood(content: ContentSet): number | undefined {
  return contentIndex(content).goodTypeBySlug.get(ROAD_GOOD_SLUG);
}

/** A road site's bill, minted fresh per site. Empty when the content has no stone, as a wall's bill is
 *  when it has no wood. */
export function roadConstructionBill(content: ContentSet): { goodType: number; amount: number }[] {
  const stone = roadPavingGood(content);
  return stone === undefined ? [] : [{ goodType: stone, amount: ROAD_STONES_PER_SITE }];
}

/**
 * Where a road may be ordered, shared by the UI ghost and the command: walkable land clear of every body
 * a wall segment would also refuse - a building, a resource, a signpost, a wall, a scripted blocker - and
 * not already a road or a road site. A road is flat, so settlers, animals and parked vehicles standing
 * there never block it. With `overUpgradeGround` it may run where a building only keeps room for its
 * upgrade, as a wall may. Project rule, after the wall's placement.
 */
export function roadSitePlacementProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  overUpgradeGround = false,
): PlacementProbe {
  const grid = placementBlockerGrid(world, content, terrain);
  const sites = roadSitesByNode(world, terrain);
  const vehicles = vehicleObstacleCounts(world, content, terrain);
  return {
    canPlace: (x, y) => {
      if (!terrain.inBounds(x, y)) return false;
      const node = terrain.nodeAt(x, y);
      const slot = y * terrain.width + x;
      const waived = (vehicles.get(slot) ?? 0) + (overUpgradeGround ? (grid.upgradeReserve[slot] ?? 0) : 0);
      return (
        terrain.isWalkable(node) &&
        (grid.obstacle[slot] ?? 0) <= waived &&
        (grid.palisadeBody[slot] ?? 0) === 0 &&
        !terrain.isRoad(node) &&
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
    if (terrain.isRoad(node) || roadSitesByNode(world, terrain).has(node)) return;
  } else if (
    !roadSitePlacementProbe(world, ctx.content, terrain, command.overUpgradeGround === true).canPlace(
      command.x,
      command.y,
    )
  ) {
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
 * Withdraw the road sites a building's or wall's body covers, each as its owner's cancel would: the cells
 * the road probe refuses for that body. With `spareGrowth`, as a building finishes, the sites on its own
 * upgrade ground stay, ordered there over it to wait for the upgrade. A laid road stays under it. Project
 * rule.
 */
export function cancelRoadSitesUnder(
  world: World,
  ctx: SystemContext,
  structure: Entity,
  spareGrowth = false,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const sites = roadSitesByNode(world, terrain);
  if (sites.size === 0) return;
  const body = new Set<Entity>();
  const growth = new Set<Entity>();
  const visit: BlockerVisit = (x, y, channel) => {
    if (!terrain.inBounds(x, y)) return;
    const site = sites.get(terrain.nodeAt(x, y));
    if (site === undefined) return;
    if (channel === OBSTACLE || channel === PALISADE_BODY) body.add(site);
    else if (spareGrowth && channel === UPGRADE_RESERVE) growth.add(site);
  };
  if (world.has(structure, Palisade)) palisadeBodyCells(world, structure, visit);
  else BUILDING_STORE.cells(world, ctx.content, structure, visit);
  for (const site of canonicalById([...body].filter((site) => !growth.has(site)))) {
    cancelRoadSite(world, ctx, site);
  }
}

/** Remove the road sites on `nodes` with any stone delivered to them, and lift the road laid there. */
export function clearRoadsOn(world: World, terrain: TerrainGraph, nodes: ReadonlySet<NodeId>): void {
  const sites = roadSitesByNode(world, terrain);
  const covered: Entity[] = [];
  for (const node of nodes) {
    const site = sites.get(node);
    if (site !== undefined) covered.push(site);
  }
  for (const site of canonicalById(covered)) removeRoadSite(world, site);
  liftRoad(world, terrain, nodes);
}

/**
 * Lay a finished road site. Its stone paves its own node and every lattice neighbour holding a site of the
 * same owner that no builder has claimed and no stone has reached; those sites are spent. Stone travels
 * only to a claimed site, so none is on its way to them. Original behavior.
 */
export function finishRoadSite(world: World, ctx: SystemContext, site: Entity): void {
  const terrain = ctx.terrain;
  const p = world.tryGet(site, Position);
  if (terrain === undefined || p === undefined) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const owner = ownerOf(world, site);
  const sites = roadSitesByNode(world, terrain);
  const absorbed: Entity[] = [];
  for (const n of hexNeighboursOf(hx, hy)) {
    if (!terrain.inBounds(n.hx, n.hy)) continue;
    const neighbour = sites.get(terrain.nodeAt(n.hx, n.hy));
    if (
      neighbour !== undefined &&
      neighbour !== site &&
      ownerOf(world, neighbour) === owner &&
      absorbable(world, neighbour)
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
  // A finish that spent no stone, such as a debug completion, leaves what was delivered beside the road.
  const spill = spilledStockOf(world, site);
  removeRoadSite(world, site);
  for (const e of absorbed) removeRoadSite(world, e);
  layRoad(world, terrain, nodes);
  scatterSpilledStock(world, ctx, spill);
}

/** A neighbour the finishing stone may pave: unclaimed and holding nothing. */
function absorbable(world: World, site: Entity): boolean {
  if (siteClaimHolder(world, site) !== null) return false;
  for (const amount of world.get(site, Stockpile).amounts.values()) if (amount > 0) return false;
  return true;
}

/** Destroy a road site, letting go of the builder whose assignment names it. */
function removeRoadSite(world: World, site: Entity): void {
  const builder = world.get(site, RoadSite).reservation?.builder;
  if (builder !== undefined && world.tryGet(builder, SiteAssignment)?.site === site) {
    world.remove(builder, SiteAssignment);
  }
  world.destroy(site);
}
