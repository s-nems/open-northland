import { Building, Position } from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { forEachRingNode, nodeOfPosition } from '../../nav/halfcell.js';
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
import {
  clearTraffic,
  clearTrafficAround,
  deferTraffic,
  type HotTraffic,
  hottestTraffic,
  TRAFFIC_HALF_LIFE_TICKS,
} from './traffic.js';
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

/** Every how many decisions one is the traffic turn (authored): the others link buildings, and a traffic
 *  turn with no bucket busy enough links one too, so neither kind of road waits long for the other. */
const ROAD_TURNS = 2;
const TRAFFIC_TURN = 1;

/** Off-road walks a bucket counts, after the halving of {@link TRAFFIC_HALF_LIFE_TICKS}, before the seat
 *  paves from it (authored): a way a few men walk to work and back for minutes, not a passing errand. */
export const TRAFFIC_ROAD_WALKS = 32;

/** How far from a bucket's average entry node its route may start, in map points (authored): half a
 *  bucket, so the start stays on the ground the walks crossed. */
const TRAFFIC_START_RADIUS = 4;

/** Map points around the start within which a road or pending road site already serves the walks
 *  (authored): a walk that close to a road joins it, so no second road is laid beside it. */
const TRAFFIC_SERVED_RADIUS = 2;

/** How long a bucket no route could serve waits before the seat tries it again (authored): one
 *  half-life, by when a new signpost or a moved building may have opened the way. */
const TRAFFIC_RETRY_TICKS = TRAFFIC_HALF_LIFE_TICKS;

type PlaceRoadSite = Extract<PlayerCommand, { kind: 'placeRoadSite' }>;

/** What a road decision was for, and the road sites it places. */
export interface RoadBuildPlan {
  readonly source: 'building' | 'traffic';
  readonly commands: PlayerCommand[];
}

/**
 * The RoadBuild module: link every built building of the seat to its base by road, and pave where its
 * settlers walk most. A building decision takes one building in turn (the decision count, so no state is
 * kept) and routes its door to the base's door over the nodes a road paints across ({@link roadRoute}). A
 * traffic decision takes the seat's busiest bucket of off-road walking ({@link hottestTraffic}) and
 * routes from where its walks crossed to the base's door the same way. Roads and the seat's road sites
 * cost less to cross than open ground, so a later route runs into the network and it grows as one tree
 * toward the base, and a route cut by a new building is re-laid around it when the building's turn comes
 * again. The route's nodes that are no road yet and pass the road probe become road sites, base end
 * first, up to {@link MAX_PENDING_ROAD_SITES} pending, so a route cut short still hangs off the network.
 * Project rule; the road crew that lays them is the workforce's (`workforce/road-crew.ts`).
 */
export function roadBuildPlan(world: World, ctx: SystemContext, player: number): RoadBuildPlan {
  const none: RoadBuildPlan = { source: 'building', commands: [] };
  const terrain = ctx.terrain;
  if (terrain === undefined || ctx.tick < ROADS_FROM_TICKS) return none;
  const room = Math.min(
    MAX_PENDING_ROAD_SITES - ownedRoadSites(world, terrain, player).size,
    ROAD_SITES_PER_DECISION,
  );
  if (room <= 0) return none;
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return none;
  const decision = Math.floor(ctx.tick / AI_DECISION_INTERVAL_TICKS);
  const trafficTurn = decision % ROAD_TURNS === TRAFFIC_TURN;
  const hot = trafficTurn ? hottestTraffic(world, player, ctx.tick, TRAFFIC_ROAD_WALKS) : null;
  const linked = ownedBuildings(world, player).filter((e) => e !== base && isBuilt(world, e));
  // A traffic turn with nothing hot links the building half the roster on from the one before it.
  const turn = Math.floor(decision / ROAD_TURNS) + (trafficTurn ? Math.ceil(linked.length / ROAD_TURNS) : 0);
  const building = linked[turn % linked.length];
  if (hot === null && building === undefined) return none;
  const roads = roadPlanner(world, ctx, terrain, player, base, room);
  if (roads === null) return none;
  if (hot !== null) return { source: 'traffic', commands: trafficRoad(world, ctx.tick, roads, hot) };
  if (building === undefined) return none;
  const from = entranceOf(world, ctx, terrain, roads.blocked, building);
  return { source: 'building', commands: from === null ? [] : (roads.route(from)?.commands ?? []) };
}

/** The road sites that pave from `hot`'s bucket to the network, deferring the bucket when no route can
 *  serve it and clearing it once a road does. */
function trafficRoad(world: World, tick: number, roads: RoadPlanner, hot: HotTraffic): PlayerCommand[] {
  const start = walkSeedNear(roads.terrain, roads.blocked, hot.centre, TRAFFIC_START_RADIUS);
  if (start !== null && roads.servedNear(start, TRAFFIC_SERVED_RADIUS)) {
    clearTraffic(world, hot.entity, tick);
    return [];
  }
  if (start === null || !roads.pavable(start)) {
    deferTraffic(world, hot.entity, tick + TRAFFIC_RETRY_TICKS);
    return [];
  }
  const placed = roads.route(start);
  if (placed === null || placed.commands.length === 0) {
    deferTraffic(world, hot.entity, tick + TRAFFIC_RETRY_TICKS);
    return [];
  }
  // A route cut short by the site cap keeps its own count, so the next traffic turn carries it on.
  if (placed.whole) clearTraffic(world, hot.entity, tick);
  const nodes = placed.commands.map((c) => roads.terrain.nodeAt(c.x, c.y));
  clearTrafficAround(world, roads.terrain, roads.player, nodes, tick, hot.entity);
  return placed.commands;
}

/** One decision's view of where the seat's roads may go, and its routes from a node to the base. */
interface RoadPlanner {
  readonly terrain: TerrainGraph;
  readonly player: number;
  readonly blocked: BlockOverlay;
  pavable(node: NodeId): boolean;
  /** Whether a road or one of the seat's road sites lies within `radius` map points of `node`. */
  servedNear(node: NodeId, radius: number): boolean;
  /** The road sites of a route from `from` to the base's entrance, and whether they are all the route
   *  needs; null when no route is found. */
  route(from: NodeId): { commands: PlaceRoadSite[]; whole: boolean } | null;
}

function roadPlanner(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  base: Entity,
  room: number,
): RoadPlanner | null {
  const blocked = structureBlockOverlay(world, ctx, terrain);
  const to = entranceOf(world, ctx, terrain, blocked, base);
  if (to === null) return null;
  const baseNode = nodeOfPosition(world.get(base, Position).x, world.get(base, Position).y);
  const limit = networkLimitAt(world, terrain, player, baseNode.hx, baseNode.hy);
  const probe = roadSitePlacementProbe(world, ctx.content, terrain);
  const sites = roadSitesByNode(world, terrain);
  const own = ownedRoadSites(world, terrain, player);
  const laid = (node: NodeId): boolean => {
    if (terrain.isRoad(node)) return true;
    const site = sites.get(node);
    return site !== undefined && own.has(site);
  };
  const pavable = (node: NodeId): boolean =>
    (limit === null || limit.allowsNode(node)) && probe.canPlace(terrain.xOf(node), terrain.yOf(node));
  const stepCost: RoadStepCost = (node) => {
    if (!terrain.isWalkable(node) || blocked.has(node)) return null;
    if (laid(node)) return ROAD_STEP_LAID;
    return pavable(node) ? ROAD_STEP_NEW : ROAD_STEP_UNPAVABLE;
  };
  const tribe = world.get(base, Building).tribe;
  return {
    terrain,
    player,
    blocked,
    pavable,
    servedNear(node, radius) {
      const centre = { hx: terrain.xOf(node), hy: terrain.yOf(node) };
      const open = (x: number, y: number): boolean => !laid(terrain.nodeAt(x, y));
      for (let ring = 0; ring <= radius; ring++) {
        if (!forEachRingNode(centre, ring, terrain.width, terrain.height, open)) return true;
      }
      return false;
    },
    route(from) {
      const route = roadRoute(terrain, from, to, stepCost, ROAD_STEP_LAID, ROAD_ROUTE_MAX_EXPLORED);
      if (route === null) return null;
      const commands: PlaceRoadSite[] = [];
      for (let i = route.length - 1; i >= 0; i--) {
        const node = route[i];
        if (node === undefined || terrain.isRoad(node) || !pavable(node)) continue;
        if (commands.length === room) return { commands, whole: false };
        commands.push({
          kind: 'placeRoadSite',
          x: terrain.xOf(node),
          y: terrain.yOf(node),
          tribe,
          owner: player,
        });
      }
      return { commands, whole: true };
    },
  };
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

export const roadBuildModule: AiPlayerModule = {
  id: 'roadBuild',
  run: (world, ctx, player) => roadBuildPlan(world, ctx, player).commands,
};
