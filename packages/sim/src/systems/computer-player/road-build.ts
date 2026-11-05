import { BUILDING_KIND } from '@open-northland/data';
import { Building, Position, playerPlacementTribes } from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { forEachRingNode, hexDistanceBetween, nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../ai-shared/cadence.js';
import { colonyBuildingsOn, homeBuildings, homeSettlers, liveColonyLands } from '../ai-shared/home-roster.js';
import { isBuilt } from '../ai-shared/seat-roster.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/blocked.js';
import { doorNodeOf, houseFootprintOf } from '../footprint/geometry.js';
import { ownedRoadSites, roadSitesByNode } from '../roads/site-index.js';
import { roadSitePlacementProbe } from '../roads/sites.js';
import { networkLimitAt } from '../signposts/network.js';
import { seatBaseOf } from './base.js';
import { plottedNodes } from './build-order/ground/plots.js';
import type { ComputerModule } from './index.js';
import { type RoadStepCost, roadRoute } from './road-route.js';
import {
  clearTraffic,
  clearTrafficAround,
  deferTraffic,
  type HotTraffic,
  hottestTraffic,
  TRAFFIC_HALF_LIFE_TICKS,
} from './traffic.js';
import { walkSeedNear } from './walk-distance.js';

/** The seat lays roads once it counts more settlers than this, children included (owner ruling): roads
 *  take much stone and builders' work, which the opening's buildings need first. */
export const ROADS_PAST_SETTLERS = 50;

/** Whether `player`'s seat has grown enough to lay roads ({@link ROADS_PAST_SETTLERS}). */
export function roadsDue(world: World, ctx: SystemContext, player: number): boolean {
  return homeSettlers(world, ctx, player).length > ROADS_PAST_SETTLERS;
}

/** The most road sites the seat keeps pending at once (authored): each takes a stone and a builder's
 *  walk, so a bounded backlog leaves the building sites their stone and hands. */
export const MAX_PENDING_ROAD_SITES = 24;

/** The most road sites one decision places (authored). */
export const ROAD_SITES_PER_DECISION = 12;

/** The least settle budget of one decision's route search (authored): a settlement-scale route, far
 *  under a map flood. */
export const ROAD_ROUTE_MAX_EXPLORED = 4096;

/** The most a long route's budget grows to (authored). Over open ground the search, priced at the laid
 *  road step, settles about the square of the hex distance, so the budget follows that square up to
 *  here; a route past it waits for the roads nearer the base, which cost less to cross. */
const ROAD_ROUTE_MAX_EXPLORED_FAR = 16384;

/** The settle budget of a road route between two nodes `hexDistance` apart. */
export function roadRouteBudget(hexDistance: number): number {
  return Math.min(ROAD_ROUTE_MAX_EXPLORED_FAR, Math.max(ROAD_ROUTE_MAX_EXPLORED, hexDistance * hexDistance));
}

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
export const TRAFFIC_ROAD_WALKS = 20;

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

/** A settlement the seat paves on its own: its hub, the land it stands on and the built buildings it links. */
interface RoadHub {
  readonly hub: Entity;
  readonly land: number;
  readonly linked: readonly Entity[];
}

/** The land node (hx, hy) lies on. */
function landAt(terrain: TerrainGraph, hx: number, hy: number): number {
  return terrain.componentOf(terrain.nodeAtClamped(hx, hy));
}

/** The seat's road hubs: home round its base, then each live colony round its first built store (owner
 *  ruling: once home lays roads, its colonies do too). */
function roadHubs(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  base: Entity,
): RoadHub[] {
  const builtAll = (list: readonly Entity[], hub: Entity): Entity[] =>
    list.filter((e) => e !== hub && isBuilt(world, e));
  const baseAt = nodeOfPosition(world.get(base, Position).x, world.get(base, Position).y);
  const hubs: RoadHub[] = [
    {
      hub: base,
      land: landAt(terrain, baseAt.hx, baseAt.hy),
      linked: builtAll(homeBuildings(world, ctx, player), base),
    },
  ];
  const buildings = contentIndex(ctx.content).buildings;
  for (const land of liveColonyLands(world, player)) {
    const on = colonyBuildingsOn(world, ctx, player, land);
    const store = on.find(
      (e) =>
        isBuilt(world, e) &&
        buildings.get(world.get(e, Building).buildingType)?.kind === BUILDING_KIND.storage,
    );
    if (store !== undefined) hubs.push({ hub: store, land, linked: builtAll(on, store) });
  }
  return hubs;
}

/**
 * The RoadBuild module: once the seat has grown ({@link roadsDue}), link every built building of the seat
 * to its hub by road, and pave where its settlers walk most. A hub is home's base or a colony's store
 * ({@link roadHubs}), each paved within its own signposts. A building decision takes one building in turn
 * (the decision count, so no state is kept) and routes its door to its hub's door over the nodes a road
 * paints across ({@link roadRoute}). A traffic decision takes the seat's busiest bucket of off-road walking
 * ({@link hottestTraffic}) and routes from where its walks crossed to the door of the hub on its land the
 * same way. Roads and the seat's road sites cost less to cross than open ground, so a later route runs into
 * the network and it grows as one tree toward the hub, and a route cut by a new building is re-laid around
 * it when the building's turn comes again. The route's nodes that are no road yet and pass the road probe
 * become road sites, hub end first, up to {@link MAX_PENDING_ROAD_SITES} pending on the hub's land, so a
 * route cut short still hangs off the network. Project rule; home's road crew is the workforce's
 * (`workforce/road-crew.ts`), a colony's builders pave once no building waits on them.
 */
export function roadBuildPlan(world: World, ctx: SystemContext, player: number): RoadBuildPlan {
  const none: RoadBuildPlan = { source: 'building', commands: [] };
  const terrain = ctx.terrain;
  if (terrain === undefined || !roadsDue(world, ctx, player)) return none;
  // A seat lays roads of its own nation, whatever nation its base house is: the map may hand it another's.
  const tribe = playerPlacementTribes(world, player)?.[0];
  if (tribe === undefined) return none;
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return none;
  const hubs = roadHubs(world, ctx, terrain, player, base);
  const pending = new Map<number, number>();
  for (const { node } of ownedRoadSites(world, terrain, player).values()) {
    const land = terrain.componentOf(node);
    pending.set(land, (pending.get(land) ?? 0) + 1);
  }
  const roomOn = (hub: RoadHub): number =>
    Math.min(MAX_PENDING_ROAD_SITES - (pending.get(hub.land) ?? 0), ROAD_SITES_PER_DECISION);
  if (hubs.every((hub) => roomOn(hub) <= 0)) return none;
  const decision = Math.floor(ctx.tick / COMPUTER_DECISION_INTERVAL_TICKS);
  const trafficTurn = decision % ROAD_TURNS === TRAFFIC_TURN;
  const hot = trafficTurn ? hottestTraffic(world, player, ctx.tick, TRAFFIC_ROAD_WALKS) : null;
  const linked = hubs.flatMap((hub) => hub.linked.map((building) => ({ hub, building })));
  // A traffic turn with nothing hot links the building half the roster on from the one before it.
  const turn = Math.floor(decision / ROAD_TURNS) + (trafficTurn ? Math.ceil(linked.length / ROAD_TURNS) : 0);
  const next = linked[turn % linked.length];
  if (hot === null && next === undefined) return none;
  const plannerOf = (hub: RoadHub): RoadPlanner | null => {
    const room = roomOn(hub);
    return room <= 0 ? null : roadPlanner(world, ctx, terrain, player, tribe, hub.hub, room);
  };
  if (hot !== null) {
    const hub = hubs.find((h) => h.land === landAt(terrain, hot.centre.hx, hot.centre.hy));
    const roads = hub === undefined ? null : plannerOf(hub);
    // A bucket on no hub's land waits like one no route serves.
    if (hub === undefined) deferTraffic(world, hot.entity, ctx.tick + TRAFFIC_RETRY_TICKS);
    const commands = roads === null ? [] : trafficRoad(world, ctx.tick, roads, hot);
    // A bucket already served or deferred leaves the turn to a building, as a turn with none hot does.
    if (commands.length > 0 || next === undefined) return { source: 'traffic', commands };
  }
  if (next === undefined) return none;
  const roads = plannerOf(next.hub);
  if (roads === null) return none;
  const from = entranceOf(world, ctx, terrain, roads.blocked, next.building);
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

/** One decision's view of where the seat's roads may go, and its routes from a node to its hub. */
interface RoadPlanner {
  readonly terrain: TerrainGraph;
  readonly player: number;
  readonly blocked: BlockOverlay;
  pavable(node: NodeId): boolean;
  /** Whether a road or one of the seat's road sites lies within `radius` map points of `node`. */
  servedNear(node: NodeId, radius: number): boolean;
  /** The road sites of a route from `from` to the hub's entrance, and whether they are all the route
   *  needs; null when no route is found. */
  route(from: NodeId): { commands: PlaceRoadSite[]; whole: boolean } | null;
}

function roadPlanner(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  tribe: number,
  hub: Entity,
  room: number,
): RoadPlanner | null {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const to = entranceOf(world, ctx, terrain, blocked, hub);
  if (to === null) return null;
  const hubNode = nodeOfPosition(world.get(hub, Position).x, world.get(hub, Position).y);
  const limit = networkLimitAt(world, terrain, player, hubNode.hx, hubNode.hy);
  const probe = roadSitePlacementProbe(world, ctx.content, terrain);
  const sites = roadSitesByNode(world, terrain);
  const own = ownedRoadSites(world, terrain, player);
  const laid = (node: NodeId): boolean => {
    if (terrain.isRoad(node)) return true;
    const site = sites.get(node);
    return site !== undefined && own.has(site);
  };
  const plotted = plottedNodes(world, ctx, terrain, player);
  const pavable = (node: NodeId): boolean =>
    (limit === null || limit.allowsNode(node)) &&
    plotted?.has(node) !== true &&
    probe.canPlace(terrain.xOf(node), terrain.yOf(node));
  const stepCost: RoadStepCost = (node) => {
    if (!terrain.isWalkable(node) || blocked.has(node)) return null;
    if (laid(node)) return ROAD_STEP_LAID;
    return pavable(node) ? ROAD_STEP_NEW : ROAD_STEP_UNPAVABLE;
  };
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
      const distance = hexDistanceBetween(
        terrain.xOf(from),
        terrain.yOf(from),
        terrain.xOf(to),
        terrain.yOf(to),
      );
      const route = roadRoute(terrain, from, to, stepCost, ROAD_STEP_LAID, roadRouteBudget(distance));
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
  const house = world.get(building, Building);
  const at = world.tryGet(building, Position);
  if (at === undefined) return null;
  const anchor = nodeOfPosition(at.x, at.y);
  const door = doorNodeOf(terrain, houseFootprintOf(ctx.content, house), anchor.hx, anchor.hy);
  if (door !== null && terrain.isWalkable(door) && !blocked.has(door)) return door;
  return walkSeedNear(terrain, blocked, anchor, DOORLESS_ENTRANCE_RADIUS);
}

export const roadBuildModule: ComputerModule = {
  id: 'roadBuild',
  run: (world, ctx, player) => roadBuildPlan(world, ctx, player).commands,
};
