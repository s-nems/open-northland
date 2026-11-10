import { type Fixed, fx, ULP, ZERO } from '../../core/fixed.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import {
  type CorridorEntry,
  corridorBoxGap,
  corridorIndexOf,
  followCorridor,
  joinCorridor,
  type NodeStops,
  type SearchStats,
} from '../../nav/pathfinding/index.js';
import { type NodeId, nodeLatticeDistance, type TerrainGraph } from '../../nav/terrain/index.js';
import { GroupLanes } from './group-lanes.js';

/**
 * How far (Manhattan half-cell nodes) a group member may start and end from the route it borrows.
 * Authored: wide enough that a hundred men, spread over the player's formation or an AI assault ring,
 * reach one route from its far corner.
 */
export const GROUP_AREA_RADIUS_NODES = 48;

/**
 * The shortest route, in nodes, another group member may borrow. Below it a member's own search costs
 * about what the hops on and off the corridor would, so it routes alone. Authored.
 */
export const SHARED_ROUTE_MIN_NODES = 96;

/** The settle cap of a met member's search off the shared route. Authored: a fraction of a cross-map
 *  search. */
const MEETING_EXIT_MAX_EXPLORED = 8192;

/**
 * The way off a shared route for a member whose own search met it: up to this many nodes however it
 * winds, since a slot among the bodies and walls by the goal lies a few nodes off the route in a straight
 * line and a fair way round them. Authored: twice the group's area.
 */
const MEETING_EXIT: CorridorEntry = {
  hopNodes: 2 * GROUP_AREA_RADIUS_NODES,
  legMaxExplored: MEETING_EXIT_MAX_EXPLORED,
};

/** The largest stop mark before the stamps wrap and are cleared. */
const MAX_STOP_MARK = 0x7fffffff;

/** One terrain's stop stamps for {@link GroupRoutes.meetingStops}, held while a member's search runs. */
class StopStamps {
  readonly stamps: Int32Array;
  private mark = 0;

  constructor(nodeCount: number) {
    this.stamps = new Int32Array(nodeCount);
  }

  next(): number {
    if (this.mark === MAX_STOP_MARK) {
      this.stamps.fill(0);
      this.mark = 0;
    }
    this.mark += 1;
    return this.mark;
  }
}

const stopStampsByTerrain = new WeakMap<TerrainGraph, StopStamps>();

interface GroupRoute {
  readonly blocked: BlockOverlay;
  readonly path: readonly NodeId[];
  readonly meanWeight: Fixed;
}

/**
 * One tick's group-move routes. The lowest-id member routes in full. Others prefer independently
 * checked straight lanes, then parallel obstacle detours, then short joins to that corridor. A member no
 * route serves searches on its own, ending on the first shared route its search settles a node of and
 * following that route from there, and offers the result, so a full search is run for the army's first
 * band alone and a search onto its route for every further one. Every member routes in the same tick. A
 * group has no id of its own: compatible terrain resistance and the walk overlay are what permit sharing.
 */
export class GroupRoutes {
  private readonly routes: GroupRoute[] = [];
  /** Routes band-mates already walked when the drain began, which a member's own search may end on. */
  private readonly live: GroupRoute[] = [];
  private readonly liveRead = new Set<BlockOverlay>();
  private readonly terrain: TerrainGraph;
  private readonly lanes: GroupLanes;
  private version = -1;
  constructor(terrain: TerrainGraph) {
    this.terrain = terrain;
    this.lanes = new GroupLanes(terrain);
  }

  /** Footprint membership can change during a drain. Never reuse a lane checked before that change. */
  refresh(version: number): void {
    if (version === this.version) return;
    this.version = version;
    this.routes.length = 0;
    this.live.length = 0;
    this.liveRead.clear();
    this.lanes.reset();
  }

  /** A clear lane or a route borrowing a nearby detour, or null to search independently. */
  borrow(blocked: BlockOverlay, start: NodeId, goal: NodeId, stats: SearchStats): NodeId[] | null {
    for (const route of this.routes) {
      if (route.blocked !== blocked) continue;
      const direct = this.lanes.direct(blocked, start, goal, route.meanWeight);
      if (direct !== null) return direct;
      const translated = this.lanes.translated(
        blocked,
        route.path,
        start,
        goal,
        route.meanWeight,
        GROUP_AREA_RADIUS_NODES,
      );
      if (translated !== null) return translated;
      const joined = joinCorridor(
        this.terrain,
        route.path,
        start,
        goal,
        blocked,
        stats,
        GROUP_AREA_RADIUS_NODES,
        'land',
        MEETING_EXIT,
      );
      if (joined !== null) return this.lanes.departEarly(blocked, joined, goal, route.meanWeight);
    }
    return null;
  }

  /**
   * The nodes of every route under `blocked` that passes within the group's area of `goal`, the live
   * ones with `live`, for a member no route served: its own search ends on the first of them it settles, and {@link followMeeting} takes
   * the route up from there. Null when no route qualifies. Valid until the next call.
   */
  meetingStops(blocked: BlockOverlay, goal: NodeId, live: boolean): NodeStops | null {
    let stops: StopStamps | undefined;
    let mark = 0;
    for (const route of this.passing(blocked, goal, live)) {
      if (stops === undefined) {
        stops = stopStampsByTerrain.get(this.terrain);
        if (stops === undefined) {
          stops = new StopStamps(this.terrain.nodeCount);
          stopStampsByTerrain.set(this.terrain, stops);
        }
        mark = stops.next();
      }
      for (const node of route.path) stops.stamps[node] = mark;
    }
    return stops === undefined ? null : { stamps: stops.stamps, mark };
  }

  /**
   * The route to `goal` that follows a shared route from where `onto` ends on it, `onto` being a search
   * {@link meetingStops} ended; the first offered route holding that node. Null when the way off the
   * route by the goal fails, and the member then searches alone.
   */
  followMeeting(
    blocked: BlockOverlay,
    onto: readonly NodeId[],
    goal: NodeId,
    stats: SearchStats,
    live: boolean,
  ): NodeId[] | null {
    const met = onto.at(-1);
    if (met === undefined) return null;
    for (const route of this.passing(blocked, goal, live)) {
      if (corridorIndexOf(this.terrain, route.path, met) === undefined) continue;
      const joined = followCorridor(
        this.terrain,
        route.path,
        onto,
        goal,
        blocked,
        stats,
        GROUP_AREA_RADIUS_NODES,
        MEETING_EXIT,
      );
      return joined === null ? null : this.lanes.departEarly(blocked, joined, goal, route.meanWeight);
    }
    return null;
  }

  /** The routes under `blocked` that pass within the group's area of `goal`: this drain's, then with
   *  `live` the ones band-mates still walk. */
  private passing(blocked: BlockOverlay, goal: NodeId, live: boolean): GroupRoute[] {
    const passesBy = (route: GroupRoute): boolean =>
      route.blocked === blocked && corridorBoxGap(this.terrain, route.path, goal) <= GROUP_AREA_RADIUS_NODES;
    const passing = this.routes.filter(passesBy);
    return live ? [...passing, ...this.live.filter(passesBy)] : passing;
  }

  /**
   * Take in the routes band-mates still walk under `blocked`, read by `read` once per drain and overlay,
   * for {@link meetingStops} alone: a member ordered after its band left ends its search on one of them.
   * The cheaper lanes and joins keep to this drain's routes, whose number the army's bands bound.
   */
  offerLive(blocked: BlockOverlay, read: () => readonly (readonly NodeId[])[]): void {
    if (this.liveRead.has(blocked)) return;
    this.liveRead.add(blocked);
    for (const path of read()) this.live.push(this.routeOf(blocked, path));
  }

  /** Offer a member's own full route to the rest of its group. */
  offer(blocked: BlockOverlay, path: readonly NodeId[]): void {
    if (path.length < SHARED_ROUTE_MIN_NODES) return;
    this.routes.push(this.routeOf(blocked, path));
  }

  private routeOf(blocked: BlockOverlay, path: readonly NodeId[]): GroupRoute {
    let length = ZERO,
      cost = ZERO;
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1],
        to = path[i];
      if (from === undefined || to === undefined) continue;
      const distance = nodeLatticeDistance(this.terrain, from, to);
      length = fx.add(length, distance);
      cost = fx.add(cost, fx.mul(distance, this.terrain.routeWeightAt(to, 'land')));
    }
    const meanWeight = length === 0 ? ZERO : meanResistance(cost, length);
    return { blocked, path, meanWeight };
  }
}

/** Compute cost/length without scaling the entire long-route cost by ONE. That intermediate can
 * exceed the exact-integer range even though each step, the total and the resulting mean are safe.
 * The 16 fractional bits use only doubled remainders below twice the route's geometric length. */
function meanResistance(cost: Fixed, length: Fixed): Fixed {
  let whole = Math.trunc(cost / length);
  while (whole * length > cost) whole--;
  while ((whole + 1) * length <= cost) whole++;
  let remainder = cost - whole * length;
  let fraction = 0;
  for (let bit = 0; bit < 16; bit++) {
    remainder *= 2;
    fraction *= 2;
    if (remainder >= length) {
      remainder -= length;
      fraction++;
    }
  }
  return fx.add(fx.fromInt(whole), fx.mulInt(ULP, fraction));
}
