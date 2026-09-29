import { Building, Position } from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { structureBlockOverlay } from '../footprint/blocked.js';
import { buildingFootprintOf, doorNodeOf } from '../footprint/geometry.js';
import { ownedRoadSites, roadSitesByNode } from '../roads/site-index.js';
import { roadSitePlacementProbe } from '../roads/sites.js';
import { networkLimitAt } from '../signposts/network.js';
import { seatBaseOf } from './base.js';
import { AI_DECISION_INTERVAL_TICKS } from './cadence.js';
import { ROADS_FROM_TICKS } from './game-phase.js';
import type { AiPlayerModule } from './index.js';
import { type RoadStepCost, roadRoute } from './road-route.js';
import { isBuilt, ownedBuildings } from './seat-roster.js';
import { walkSeedNear } from './walk-distance.js';

/** The most road sites the seat keeps pending at once (authored): each takes a stone and a builder's
 *  walk, so a bounded backlog leaves the building sites their stone and hands. */
export const MAX_PENDING_ROAD_SITES = 24;

/** The most road sites one decision places (authored). */
export const ROAD_SITES_PER_DECISION = 12;

/** The settle budget of one decision's door-to-base route search (authored): a settlement-scale route,
 *  far under a map flood. A route past it waits for the roads nearer the base, which cost less to cross. */
export const ROAD_ROUTE_MAX_EXPLORED = 4096;

/** What a route step onto a node costs (authored): a road or one of the seat's road sites costs half of
 *  open ground, as a road halves a walker's step cost, so a route joins the network rather than running
 *  beside it. Ground no road site may take costs far more, crossed only where no pavable way exists. */
const ROAD_STEP_LAID = 1;
const ROAD_STEP_NEW = 2;
const ROAD_STEP_UNPAVABLE = 16;

/** How far from a doorless building's anchor its route starts, in Manhattan nodes (authored). */
const DOORLESS_ENTRANCE_RADIUS = 4;

/**
 * The RoadBuild module: link every built building of the seat to its base by road. Each decision takes
 * one building in turn (the decision count modulo the roster, so no state is kept) and routes its door to
 * the base's door over the nodes a road paints across ({@link roadRoute}). Roads and the seat's road sites
 * cost less to cross than open ground, so a later route runs into the network and it grows as a tree
 * toward the base, and a route cut by a new building is re-laid around it when the building's turn comes
 * again. The route's nodes that are no road yet and pass the road probe become road sites, base end
 * first, up to {@link MAX_PENDING_ROAD_SITES} pending. Project rule; the road crew that lays them is the
 * workforce's (`workforce/road-crew.ts`).
 */
function runRoadBuild(world: World, ctx: SystemContext, player: number): PlayerCommand[] {
  const terrain = ctx.terrain;
  if (terrain === undefined || ctx.tick < ROADS_FROM_TICKS) return [];
  const room = Math.min(
    MAX_PENDING_ROAD_SITES - ownedRoadSites(world, terrain, player).size,
    ROAD_SITES_PER_DECISION,
  );
  if (room <= 0) return [];
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return [];
  const linked = ownedBuildings(world, player).filter((e) => e !== base && isBuilt(world, e));
  const building = linked[Math.floor(ctx.tick / AI_DECISION_INTERVAL_TICKS) % linked.length];
  if (building === undefined) return [];

  const blocked = structureBlockOverlay(world, ctx, terrain);
  const from = entranceOf(world, ctx, terrain, blocked, building);
  const to = entranceOf(world, ctx, terrain, blocked, base);
  if (from === null || to === null) return [];
  const baseNode = nodeOfPosition(world.get(base, Position).x, world.get(base, Position).y);
  const limit = networkLimitAt(world, terrain, player, baseNode.hx, baseNode.hy);
  const probe = roadSitePlacementProbe(world, ctx.content, terrain);
  const sites = roadSitesByNode(world, terrain);
  const own = ownedRoadSites(world, terrain, player);
  const pavable = (node: NodeId): boolean =>
    (limit === null || limit.allowsNode(node)) && probe.canPlace(terrain.xOf(node), terrain.yOf(node));
  const stepCost: RoadStepCost = (node) => {
    if (!terrain.isWalkable(node) || blocked.has(node)) return null;
    if (terrain.isRoad(node)) return ROAD_STEP_LAID;
    const site = sites.get(node);
    if (site !== undefined && own.has(site)) return ROAD_STEP_LAID;
    return pavable(node) ? ROAD_STEP_NEW : ROAD_STEP_UNPAVABLE;
  };
  const route = roadRoute(terrain, from, to, stepCost, ROAD_STEP_LAID, ROAD_ROUTE_MAX_EXPLORED);
  if (route === null) return [];

  const tribe = world.get(base, Building).tribe;
  const commands: PlayerCommand[] = [];
  for (let i = route.length - 1; i >= 0 && commands.length < room; i--) {
    const node = route[i];
    if (node === undefined || terrain.isRoad(node) || !pavable(node)) continue;
    commands.push({
      kind: 'placeRoadSite',
      x: terrain.xOf(node),
      y: terrain.yOf(node),
      tribe,
      owner: player,
    });
  }
  return commands;
}

/** Where a building's road starts: its door, or for a doorless one the open node nearest its anchor. */
function entranceOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  building: Entity,
): NodeId | null {
  const { buildingType, tribe } = world.get(building, Building);
  const at = world.tryGet(building, Position);
  if (at === undefined) return null;
  const anchor = nodeOfPosition(at.x, at.y);
  const door = doorNodeOf(
    terrain,
    buildingFootprintOf(ctx.content, buildingType, tribe),
    anchor.hx,
    anchor.hy,
  );
  if (door !== null && terrain.isWalkable(door) && !blocked.has(door)) return door;
  return walkSeedNear(terrain, blocked, anchor, DOORLESS_ENTRANCE_RADIUS);
}

export const roadBuildModule: AiPlayerModule = { id: 'roadBuild', run: runRoadBuild };
