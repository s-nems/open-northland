import {
  combatEnemyMask,
  Engagement,
  EVERY_PLAYER,
  Fleeing,
  hostileMaskOf,
  hostilePlayerMasks,
  MoveGoal,
  Obstructed,
  Owner,
  PathFollow,
  PathRequest,
  PathRoute,
  Person,
  PlayerOrder,
  Position,
  pathFollowRecord,
  pathLegTicks,
  StandIn,
  Stranded,
  WalkFacing,
  type Waypoint,
} from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { positionXOfNode, positionYOfNode } from '../../nav/halfcell.js';
import { nearestUnblockedNode } from '../../nav/nearest.js';
import {
  findPath,
  type NodeStops,
  POCKET_PROBE_MAX_EXPLORED,
  RACE_SLICE_EXPLORED,
  SealedPockets,
  type SearchStats,
  straightenColumnSteps,
} from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph, Traversal } from '../../nav/terrain/index.js';
import { ROW_STEP, worldDistance, worldX } from '../../nav/world-metric.js';
import type { System, SystemContext } from '../context.js';
import { buildingDoorwayNodes } from '../footprint/index.js';
import { ROUTE_REGION_POCKET_CAP, type RouteRegions, routeRegions } from '../footprint/route-regions.js';
import { type WalkBlockMask, walkBlockMask } from '../footprint/walk-block-mask.js';
import { routeFound } from '../settlers/lost-way.js';
import { isValidNodeId } from '../spatial/nodes.js';
import { attackMoveBlocks } from './attack-move-blocks.js';
import {
  ColliderWalkBlocks,
  hasBodyCollision,
  type UnitWalkBlocks,
  unitWalkBlocks,
} from './collision/index.js';
import { GroupReachability } from './group-reachability.js';
import { GroupRoutes, SHARED_ROUTE_MIN_NODES } from './group-routes.js';
import { liveBandRoutes } from './live-band-routes.js';
import { dropPath, liveStepEnd, restartLeg } from './nav-state.js';
import { routeBoundsOf } from './route-bounds.js';
import { grindStartCell, routeStartCell } from './route-start.js';
import { settlerTraversal } from './traversal.js';
import { beginWalkTurn } from './turning.js';

/**
 * The pathfinder's per-tick work budget, in A*-settled nodes: what search time is proportional to.
 * Autonomous walks share this budget. Player orders drain in their application tick, borrowing nearby
 * routes where possible. Approximation: a tick-time guard, not data-pinned.
 */
const PATHFINDING_NODE_BUDGET_PER_TICK = 16384;

/**
 * The goal side's race slice once the tick's budget is spent, when only player orders still route. Past
 * the budget a settle count cuts nobody, so these searches trade the cost of refuting a sealed goal
 * (the forward side floods four times the pocket's size) for a long open route's (a quarter of its
 * remainder in goal-side settles rather than all of it). Authored.
 */
const OVER_BUDGET_GOAL_SLICE_EXPLORED = RACE_SLICE_EXPLORED / 4;

// An open route region stands in for the search's pocket probe, which it must therefore outgrow.
if (ROUTE_REGION_POCKET_CAP < POCKET_PROBE_MAX_EXPLORED) {
  throw new Error('the route region cap must cover the pocket probe');
}

/**
 * Drains pending path requests into followable paths, lowest entity id first until the tick's node budget
 * is spent; player orders still route after it is spent. A route that cannot be found flags the request
 * for the planner rather than retrying silently.
 */
export const pathfindingSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: nothing to route over
  drainPathRequests(world, ctx, terrain, PATHFINDING_NODE_BUDGET_PER_TICK);
};

/**
 * One world's request-serving state, emptied at each drain so no view or claim is read past its tick
 * (the last context stays referenced until the next drain). Kept per world so a routing tick
 * reuses its maps instead of minting them; the group helpers are built fresh, and only by a drain that
 * serves a group order.
 */
class PathDrain {
  // Walk-block overlays, built lazily so only a tick that actually routes pays for them. The standing-unit
  // stamp applies only to a requester that itself collides: a ghost walks through bodies, and detouring it
  // would break the economy's exact node-coincidence walks. Only posts at war with the requester's player
  // block it; player -1 keys an unowned collider, which every post blocks.
  // `dynamic` is the mask's levelled view, which skips the per-read level check; each request levels it
  // once before reading it, since the previous request's writes may have moved the version.
  mask: WalkBlockMask | undefined;
  private dynamic: BlockOverlay | undefined;
  private units: UnitWalkBlocks | undefined;
  private regions: RouteRegions | undefined;
  private hostile: readonly number[] | undefined;
  private readonly bodiesByPlayer = new Map<number, ColliderWalkBlocks>();
  private readonly marchingBodiesByPlayer = new Map<number, ColliderWalkBlocks>();
  private readonly besideTargetsByPlayer = new Map<number, ColliderWalkBlocks>();
  private readonly occupiedViews = new Map<BlockOverlay, BlockOverlay>();
  /** Goal stand-ins already handed out this tick, so two walkers aimed at one crowded node fan out to
   *  different free nodes instead of both claiming the same one. */
  readonly claimedStandIns = new Set<NodeId>();
  private groupRoutes: GroupRoutes | undefined;
  private groupReachability: GroupReachability | undefined;
  readonly spent: SearchStats = { explored: 0 };
  /** The goal-side race slice of the request being served. */
  goalSlice = RACE_SLICE_EXPLORED;
  /** Each player's sealed goals, held across drains: a refusal is proved against the asking overlay. An
   *  attack-move plans for closed enemy gates, so its walls differ from an ordinary walk's. */
  private readonly pocketsByPlayer = new Map<number, SealedPockets>();
  private readonly marchingPocketsByPlayer = new Map<number, SealedPockets>();

  constructor(
    private readonly world: World,
    private ctx: SystemContext,
    private terrain: TerrainGraph,
  ) {}

  begin(ctx: SystemContext, terrain: TerrainGraph): void {
    this.ctx = ctx;
    if (terrain !== this.terrain) {
      this.pocketsByPlayer.clear();
      this.marchingPocketsByPlayer.clear();
    }
    this.terrain = terrain;
    this.reset();
  }

  /** The sealed goals `player`'s walkers found, -1 for an unowned walker's. */
  private pocketsOf(player: number, marching: boolean): SealedPockets {
    const byPlayer = marching ? this.marchingPocketsByPlayer : this.pocketsByPlayer;
    let pockets = byPlayer.get(player);
    if (pockets === undefined) {
      pockets = new SealedPockets(this.terrain);
      byPlayer.set(player, pockets);
    }
    return pockets;
  }

  /** Drops every view and claim the drain built, so the next drain starts as a fresh one would. */
  reset(): void {
    this.spent.explored = 0;
    this.goalSlice = RACE_SLICE_EXPLORED;
    this.mask = undefined;
    this.dynamic = undefined;
    this.units = undefined;
    this.regions = undefined;
    this.hostile = undefined;
    this.bodiesByPlayer.clear();
    this.marchingBodiesByPlayer.clear();
    this.besideTargetsByPlayer.clear();
    this.occupiedViews.clear();
    this.claimedStandIns.clear();
    this.groupRoutes = undefined;
    this.groupReachability = undefined;
  }

  dynamicOnly(): BlockOverlay {
    if (this.dynamic === undefined) {
      this.mask = walkBlockMask(this.world, this.ctx, this.terrain);
      this.dynamic = this.mask.levelled();
    }
    return this.dynamic;
  }

  /**
   * Whether the structures alone leave `goal` in a region too large for the search's pocket probe to
   * exhaust, which lets a search under exactly that overlay skip the probe. A label is a pure function
   * of terrain and overlay, so the settles the skip saves are the same on every client.
   */
  goalOutgrowsProbe(goal: NodeId): boolean {
    this.regions ??= routeRegions(this.world, this.ctx, this.terrain);
    return this.regions.outgrowsPocketCap(goal);
  }

  /**
   * Whether the structures alone prove `goal` out of reach from `start`: one of them sits in a sealed
   * pocket the other is outside. A proof under every overlay that only adds blocks to the structures,
   * such as a collider's standing bodies.
   */
  sealedApart(start: NodeId, goal: NodeId): boolean {
    this.regions ??= routeRegions(this.world, this.ctx, this.terrain);
    return this.regions.unroutable(start, goal);
  }

  private unitBlocks(): UnitWalkBlocks {
    this.units ??= unitWalkBlocks(this.world, this.ctx.content, this.terrain);
    return this.units;
  }

  private hostileMasks(): readonly number[] {
    this.hostile ??= hostilePlayerMasks(this.world);
    return this.hostile;
  }

  blockedFor(player: number, structures: BlockOverlay, marching: boolean): ColliderWalkBlocks {
    const views = marching ? this.marchingBodiesByPlayer : this.bodiesByPlayer;
    let view = views.get(player);
    if (view === undefined) {
      view = new ColliderWalkBlocks(
        structures,
        this.unitBlocks(),
        hostileMaskOf(this.hostileMasks(), player),
      );
      views.set(player, view);
    }
    return view;
  }

  /** The bodies an attack-move of `player` cannot fight its way through: the hostile ones it does not
   *  fight itself, as a side that holds it an enemy it holds a friend, or one a lobby peace binds it to. */
  besideTargetsFor(player: number, structures: BlockOverlay): ColliderWalkBlocks {
    let view = this.besideTargetsByPlayer.get(player);
    if (view === undefined) {
      const passable = hostileMaskOf(this.hostileMasks(), player) & ~combatEnemyMask(this.world, player);
      view = new ColliderWalkBlocks(structures, this.unitBlocks(), passable);
      this.besideTargetsByPlayer.set(player, view);
    }
    return view;
  }

  /** Every post, whoever stands there: a walker passes its own side and its allies but never stops on them. */
  occupied(structures: BlockOverlay): BlockOverlay {
    let view = this.occupiedViews.get(structures);
    if (view === undefined) {
      view = new ColliderWalkBlocks(structures, this.unitBlocks(), EVERY_PLAYER);
      this.occupiedViews.set(structures, view);
    }
    return view;
  }

  /** Readies the group route cache for a group request under the mask's current version. */
  refreshGroup(): void {
    if (this.mask === undefined) return;
    this.groupRoutes ??= new GroupRoutes(this.terrain);
    this.groupRoutes.refresh(this.mask.version);
  }

  /**
   * A route for `e` from `start` to `goal` under `overlay`. A group member's is refused at once by a region
   * the group already found sealed, borrowed from a neighbour, or searched, a searched answer kept for the
   * rest of the group. A land refusal is proved through the sealed goals of `player`'s march or walk.
   */
  routeUnder(
    overlay: BlockOverlay,
    start: NodeId,
    goal: NodeId,
    group: boolean,
    player: number,
    marching: boolean,
    traversal: Traversal,
    goalOpen: boolean,
    liveRoutes?: () => NodeId[][],
  ): NodeId[] | null {
    const { mask, spent } = this;
    if (group && mask !== undefined) {
      this.groupReachability ??= new GroupReachability(this.terrain);
      if (this.groupReachability.unreachable(mask, overlay, start, goal)) return null;
    }
    const groupRoutes = group ? this.groupRoutes : undefined;
    const borrowed = groupRoutes === undefined ? null : groupRoutes.borrow(overlay, start, goal, spent);
    if (borrowed !== null) return borrowed;
    // A member no route served still ends its own search on the first shared route it settles a node of,
    // on a walk long enough to share: a short one costs little alone and would only gain a detour.
    const meets = groupRoutes !== undefined && farApart(this.terrain, start, goal);
    if (meets && liveRoutes !== undefined) groupRoutes.offerLive(overlay, liveRoutes);
    const stops = meets ? (groupRoutes.meetingStops(overlay, goal) ?? undefined) : undefined;
    const pockets = this.pocketsOf(player, marching);
    let path = resolvePath(pockets, start, goal, overlay, spent, traversal, this.goalSlice, goalOpen, stops);
    if (path !== null && groupRoutes !== undefined && stops !== undefined && path.at(-1) !== goal) {
      const followed = groupRoutes.followMeeting(overlay, path, goal, spent);
      if (followed !== null) {
        // A band of its own leads there: its neighbours borrow from this route as from a searched one.
        groupRoutes.offer(overlay, followed);
        return followed;
      }
      path = resolvePath(pockets, start, goal, overlay, spent, traversal, this.goalSlice, goalOpen);
    }
    // Only a searched route is offered: offering borrowed ones grows the list each member tries.
    if (path !== null && groupRoutes !== undefined) groupRoutes.offer(overlay, path);
    if (path === null && group && mask !== undefined && !overlay.has(goal)) {
      this.groupReachability ??= new GroupReachability(this.terrain);
      this.groupReachability.rememberFailure(mask, overlay, start, goal);
    }
    return path;
  }
}

const drains = new WeakMap<World, PathDrain>();

function pathDrainOf(world: World, ctx: SystemContext, terrain: TerrainGraph): PathDrain {
  let drain = drains.get(world);
  if (drain === undefined) {
    drain = new PathDrain(world, ctx, terrain);
    drains.set(world, drain);
  } else {
    drain.begin(ctx, terrain);
  }
  return drain;
}

/**
 * The request-serving pass with an explicit `nodeBudget`, so a test can exercise the budget cut. The
 * budget is checked before each request and the overshooting one still completes, so a tick always
 * serves at least one pending request.
 */
export function drainPathRequests(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  nodeBudget: number,
): void {
  // Serve in ascending entity-id order so the per-tick budget cut is canonical, never insertion order.
  const requests = world.canonicalQuery(PathRequest);
  if (requests.length === 0) return;
  const drain = pathDrainOf(world, ctx, terrain);
  const { spent, claimedStandIns } = drain;
  for (const e of requests) {
    // A player order must not trickle into motion in entity-id order. Sharing cuts its search cost,
    // but a member too far from a corridor still receives its own route in this tick.
    const playerOrdered = world.has(e, PlayerOrder);
    const overBudget = spent.explored >= nodeBudget;
    if (overBudget && !playerOrdered) continue;
    drain.goalSlice = overBudget ? OVER_BUDGET_GOAL_SLICE_EXPLORED : RACE_SLICE_EXPLORED;
    const req = world.get(e, PathRequest);
    if (req.failed) continue;
    if (req.grind && movedSinceGrindAsk(world, terrain, e, req.start)) {
      // The walker moved on while the ask waited: it made progress, so it keeps its route.
      world.remove(e, PathRequest);
      continue;
    }
    drain.mask?.catchUp();

    const traversal = settlerTraversal(world, e);
    const collides = traversal === 'land' && hasBodyCollision(world, ctx.content, e);
    const player = world.tryGet(e, Owner)?.player;
    const marching =
      traversal === 'land' && player !== undefined && world.tryGet(e, PlayerOrder)?.attackMove !== undefined;
    const actual = drain.dynamicOnly();
    const structures = marching ? attackMoveBlocks(world, ctx, terrain, player).blocked : actual;
    const bodies = collides ? drain.blockedFor(player ?? -1, structures, marching) : null;
    const blocked = bodies ?? structures;
    // A grind reroute plans as if its live route were already dropped, which it is unless the answer matches.
    const stepEnd =
      req.retainRoute || req.grind || !finishesStepOnReroute(world, e)
        ? undefined
        : freeStepEnd(world, e, blocked);
    const asked = startBesideBlocks(world, terrain, e, req, traversal, structures);
    const start = stepEnd ?? asked;
    // A goal taken only by a standing unit, of any side, is recoverable: re-aim at the nearest free node so
    // a charge fans out around a crowded target. Collider-only, since a ghost's goal must stay exact.
    let goal = req.goal;
    let standIn = false;
    if (
      collides &&
      goal !== start && // a walker already standing there has arrived, however crowded
      isValidNodeId(terrain, goal) &&
      drain.occupied(structures).has(goal) &&
      !structures.has(goal)
    ) {
      const free = nearestUnblockedNode(terrain, goal, drain.occupied(structures), {
        claimed: claimedStandIns,
        walls: structures,
        avoid: buildingDoorwayNodes(world, ctx, terrain),
        sealedFallback: true,
      });
      if (free !== null) {
        goal = free;
        standIn = true;
      }
    }
    // Only a player's order moves a group; economy walks keep their own exact routes.
    const group =
      traversal === 'land' && playerOrdered && isValidNodeId(terrain, start) && isValidNodeId(terrain, goal);
    if (group) drain.refreshGroup();
    // The labels read the structures alone: an attack-move's walls and a hostile body are not in them.
    const labelled =
      traversal === 'land' && !marching && isValidNodeId(terrain, start) && isValidNodeId(terrain, goal);
    const sealed = labelled && drain.sealedApart(start, goal);
    const goalOpen =
      labelled && !sealed && (bodies === null || bodies.posts === 0) && drain.goalOutgrowsProbe(goal);
    // A member ordered after its band left takes up a route a band-mate still walks. A chase keeps its
    // own search: its goal is a contact node a few steps off, not the band's.
    const liveRoutes =
      group && player !== undefined && !world.has(e, Engagement)
        ? () => liveBandRoutes(world, ctx.content, terrain, e, player, marching, collides, blocked)
        : undefined;
    let path = sealed
      ? null
      : drain.routeUnder(
          blocked,
          start,
          goal,
          group,
          player ?? -1,
          marching,
          traversal,
          goalOpen,
          liveRoutes,
        );
    // An attack-move goes for what seals its goal off: the bodies it fights shape its route, never refuse it.
    if (path === null && bodies !== null && world.tryGet(e, PlayerOrder)?.attackMove !== undefined) {
      const through = drain.besideTargetsFor(player ?? -1, structures);
      if (through.posts < bodies.posts) {
        path = drain.routeUnder(through, start, goal, group, player ?? -1, marching, traversal, false);
      }
    }
    if (path !== null) {
      if (standIn) {
        claimedStandIns.add(goal);
        // Keep the intent in step with the delivered route, or the planner would re-route back at the
        // occupied original every tick; the drive learns where it was stood in from the marker.
        const goalIntent = world.tryMut(e, MoveGoal);
        if (goalIntent !== undefined) goalIntent.cell = goal;
        // Written only on a change: a stood-in walker re-routes to the same stand-in most ticks.
        const stood = world.tryGet(e, StandIn);
        if (stood?.goal !== req.goal || stood.at !== goal)
          world.add(e, StandIn, { goal: req.goal, at: goal });
      } else {
        world.remove(e, StandIn);
      }
    }
    // A person walks a column straight; a creature keeps every edge.
    let waypoints =
      path === null
        ? []
        : pathToWaypoints(terrain, world.has(e, Person) ? straightenColumnSteps(terrain, path) : path);
    // A grind reroute that found the route already walked keeps it; any other answer replaces it.
    if (req.grind) {
      if (path !== null && walksRoute(world, e, waypoints)) {
        holdGrindRoute(world, e);
        continue;
      }
      dropPath(world, e);
    }
    if (path === null) {
      const refused = world.mut(e, PathRequest);
      refused.failed = true;
      // A refusal's readers (a wall breach, the sealed-target check) search again from the start tried here.
      refused.start = asked;
      // A failed mid-walk reroute keeps the live path, so the walker plays its old route out and parks on a
      // cell centre rather than freezing mid-leg. A failed grind ask has already dropped it.
      continue;
    }

    // Keep a route's start when it is still ahead of an active step: skipping it would also skip its
    // terrain and node charge. A start behind the new heading is bypassed rather than backing up;
    // a blocked start only permits escape, never a return to its centre.
    const previous = world.tryGet(e, PathFollow);
    const previousStops = world.tryGet(e, PathRoute)?.waypoints;
    // A topology reroute starts at the end of the retained safe prefix. Finish that prefix
    // before the detour.
    if (req.retainRoute && previous !== undefined && previousStops?.at(-1)?.node === req.start) {
      const spliced = [...previousStops, ...waypoints.slice(1)];
      world.mut(e, PathRoute).waypoints = spliced;
      routeBoundsOf(terrain, spliced);
      endGrindHold(world, e);
      settleRoute(world, e, req.goal);
      continue;
    }
    const oldTarget = previous && previousStops?.[previous.index];
    const oldStart = previous && previousStops?.[previous.index - 1];
    const activeCost = previous?.legCost ?? 0;
    const position = world.tryGet(e, Position);
    const moved =
      oldStart !== undefined &&
      position !== undefined &&
      (position.x !== oldStart.x || position.y !== oldStart.y);
    const oldPace =
      activeCost > 0
        ? (previous?.legPace ??
          (moved && oldTarget !== undefined && oldStart !== undefined
            ? fx.divCeil(
                worldDistance(oldStart.x, oldStart.y, oldTarget.x, oldTarget.y),
                fx.fromInt(activeCost),
              )
            : undefined))
        : undefined;
    // A walker partway through a step finishes it along its edge before the new route, however sharply
    // that route then turns.
    const finishesStep = moved && stepEnd !== undefined && waypoints[0]?.node === stepEnd;
    let index =
      waypoints.length < 2 ||
      finishesStep ||
      (activeCost > 0 &&
        position !== undefined &&
        waypoints[0] !== undefined &&
        !blocked.has(waypoints[0].node) &&
        startIsAhead(position, waypoints))
        ? 0
        : 1;
    // Keep the departed leg in the route history when its new start is still ahead. A later
    // closure needs that history to turn back safely.
    if (index === 0 && oldStart !== undefined) {
      waypoints = [oldStart, ...waypoints];
      index = 1;
    }
    world.add(e, PathRoute, { waypoints });
    routeBoundsOf(terrain, waypoints);
    endGrindHold(world, e);
    world.add(
      e,
      PathFollow,
      pathFollowRecord({
        index,
        legElapsed: activeCost > 0 && previous !== undefined ? pathLegTicks(previous, ctx.tick - 1) : 0,
        legCost: activeCost,
        legPace: oldPace,
        departureCharged: previous?.departureCharged,
        bootsDegree: previous?.bootsDegree,
      }),
    );
    const firstTarget = waypoints[index];
    if (position !== undefined && firstTarget !== undefined && world.has(e, WalkFacing)) {
      beginWalkTurn(world, e, position, firstTarget);
    }
    settleRoute(world, e, req.goal);
  }
  drain.reset();
}

/** Whether a walk from `start` to `goal` is long enough for a shared route to serve it. */
function farApart(terrain: TerrainGraph, start: NodeId, goal: NodeId): boolean {
  const columns = Math.abs(terrain.xOf(start) - terrain.xOf(goal));
  const rows = Math.abs(terrain.yOf(start) - terrain.yOf(goal));
  return columns + rows >= SHARED_ROUTE_MIN_NODES;
}

/** A route installed answers its request and ends any stranded park; one to the work a lost settler
 *  waited on is its way found. */
function settleRoute(world: World, e: Entity, goal: NodeId): void {
  world.remove(e, PathRequest);
  world.remove(e, Stranded);
  routeFound(world, e, goal);
}

/** The request's start, or the nearest open bracket node when it asks from a blocked one beside the walker:
 *  a route from a wall node may leave it on the wall's far side. A start at a kept route's end stays. */
function startBesideBlocks(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  req: { readonly start: NodeId; readonly retainRoute?: true | undefined },
  traversal: Traversal,
  blocked: BlockOverlay,
): NodeId {
  const p = world.tryGet(e, Position);
  if (req.retainRoute || p === undefined || !blocked.has(req.start)) return req.start;
  return routeStartCell(terrain, p.x, p.y, traversal, blocked);
}

/** Whether `e` still walks a route but no longer stands nearest `start`, the node its grind ask is from. */
function movedSinceGrindAsk(world: World, terrain: TerrainGraph, e: Entity, start: NodeId): boolean {
  const p = world.tryGet(e, Position);
  if (p === undefined || !world.has(e, PathFollow)) return false;
  return grindStartCell(world, terrain, e, p.x, p.y, settlerTraversal(world, e)) !== start;
}

/** A hold covers only the route a grind ask kept: any route routing installs asks at its next stall. */
function endGrindHold(world: World, e: Entity): void {
  if ((world.tryGet(e, Obstructed)?.hold ?? 0) > 0) world.mut(e, Obstructed).hold = 0;
}

/** Whether `waypoints` is the tail of the route `e` walks from its live leg's start, so taking it would aim
 *  the walker at the target it already walks toward. */
function walksRoute(world: World, e: Entity, waypoints: readonly Waypoint[]): boolean {
  const follow = world.tryGet(e, PathFollow);
  const stops = world.tryGet(e, PathRoute)?.waypoints;
  if (follow === undefined || stops === undefined || waypoints.length < 2) return false;
  const offset = follow.index - 1;
  if (offset < 0 || stops.length - offset !== waypoints.length) return false;
  for (let i = 0; i < waypoints.length; i++) {
    const held = stops[offset + i];
    const found = waypoints[i];
    if (held === undefined || found === undefined) return false;
    if (held.node !== found.node || held.x !== found.x || held.y !== found.y) return false;
  }
  return true;
}

/** Keep the route a grind reroute found unchanged, restarting its leg as a fresh install would; the walker
 *  then waits out as many windows as it has ground through before asking again. */
function holdGrindRoute(world: World, e: Entity): void {
  restartLeg(world, e);
  world.remove(e, PathRequest);
  world.remove(e, Stranded);
  const obstruction = world.tryMut(e, Obstructed);
  if (obstruction !== undefined) obstruction.hold = obstruction.reroutes;
}

/** Whether `e` finishes its live step before taking a new route: a player's walk and a run from danger,
 *  whose re-aims a click or a threat can repeat every few ticks. A chase, an attack-move's included, keeps
 *  cutting toward its target, which lets a crowd settle round an enemy without walking each step out first. */
function finishesStepOnReroute(world: World, e: Entity): boolean {
  if (world.has(e, Engagement)) return false;
  return world.has(e, PlayerOrder) || world.has(e, Fleeing);
}

/**
 * The node ending the step `e` is partway through, when it is free to route from. Starting there keeps the
 * walker on the lattice: from the middle of an edge it would otherwise cut toward the new route's second
 * node, a heading its facing and walk clip cannot show. Undefined for a walker standing on a node.
 * Approximation of the original, whose walk is an atomic one-step action; whether an order can cut that
 * step short is unconfirmed.
 */
function freeStepEnd(world: World, e: Entity, blocked: BlockOverlay): NodeId | undefined {
  const follow = world.tryGet(e, PathFollow);
  const stops = world.tryGet(e, PathRoute)?.waypoints;
  const p = world.tryGet(e, Position);
  if (follow === undefined || stops === undefined || p === undefined) return undefined;
  const from = stops[follow.index - 1];
  if (from === undefined || (from.x === p.x && from.y === p.y)) return undefined;
  const end = liveStepEnd(follow.index, stops);
  const node = end === undefined ? undefined : stops[end]?.node;
  return node === undefined || blocked.has(node) ? undefined : node;
}

function startIsAhead(position: { x: Fixed; y: Fixed }, waypoints: readonly Waypoint[]): boolean {
  const start = waypoints[0];
  const next = waypoints[1];
  if (start === undefined || next === undefined) return false;
  const approachX = worldX(start.x, start.y) - worldX(position.x, position.y);
  const approachY = fx.mul(fx.sub(start.y, position.y), ROW_STEP);
  const outgoingX = worldX(next.x, next.y) - worldX(start.x, start.y);
  const outgoingY = fx.mul(fx.sub(next.y, start.y), ROW_STEP);
  // The outgoing vector spans one lattice step; the integer dot product needs no normalization.
  return approachX * outgoingX + approachY * outgoingY > 0;
}

/** Turn a node path into the stops a walker steps between, each on its node's centre with the lattice
 *  node whose roughness paces the step that leaves it. A column step is one leg. */
function pathToWaypoints(terrain: TerrainGraph, path: ReadonlyArray<NodeId>): Waypoint[] {
  return path.map((node) => {
    // `yOf` once and the column by subtraction: `xOf` exactly, one division fewer.
    const y = terrain.yOf(node);
    const x = node - y * terrain.width;
    return { x: positionXOfNode(x, y), y: positionYOfNode(y), node };
  });
}

/** Run A* for a request, a land refusal through the sealed pockets; an off-grid `start` or `goal` reads as
 *  no route. */
function resolvePath(
  pockets: SealedPockets,
  start: number,
  goal: number,
  blocked: BlockOverlay,
  stats: SearchStats,
  traversal: Traversal,
  goalSlice: number,
  goalOpen: boolean,
  stopOn?: NodeStops,
): NodeId[] | null {
  const { terrain } = pockets;
  if (!isValidNodeId(terrain, start) || !isValidNodeId(terrain, goal)) return null;
  return traversal === 'land'
    ? pockets.findPath(start, goal, blocked, stats, goalSlice, goalOpen, stopOn)
    : findPath(terrain, start, goal, blocked, stats, traversal, goalSlice);
}
