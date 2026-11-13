import { colonyHeldShips } from '../ai-shared/home-roster.js';
import {
  CurrentAtomic,
  FerryPassenger,
  FerryVoyage,
  FerryWaiting,
  type FerryVoyageState,
  MoveGoal,
  PlayerOrder,
  PathRequest,
  TradeShip,
  type VehicleStateView,
  VehicleDrive,
  hasFreeSeat,
  ownerOf,
  Position,
  Rider,
  Settler,
  Vehicle,
  vehicleCommander,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type DeepReadonly, type Entity, type World } from '../../ecs/world.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { stopAtNextNode } from '../movement/nav-state.js';
import { isFerrymanJob } from '../readviews/jobs.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { markLostWay } from '../settlers/lost-way.js';
import { breaksForMeal, suspendWalkForMeal } from '../orders/meal-break.js';
import { entityNode } from '../spatial/nodes.js';
import {
  attachToVehicle,
  boardVehicle,
  detachFromVehicle,
  doorReachable,
  landingOf,
} from './crew.js';
import { dockRoute, dockVehicle, mooringSpotsOf } from './dock.js';
import { nodeOf } from './movement.js';
import { vehicleIndex } from './registry.js';

// The ferryman: a move order whose goal lies across open water is no walk, so with the owner's idle
// ship lying at a shore of this island with a ferryman aboard, the settler sails instead. It walks to the
// door, boards, and the ship docks at a shore of the target island nearest the clicked spot, where the
// riders step off and walk on to their spots; the empty ship then sails back to the mooring the
// crossing booked it at. A dispatched booking's passenger walks toward the water while the ship sails:
// the shore the crossing holds for it, so they stand at the coast when the ship arrives. When no ship
// takes a booking at all, the order stands as a hold: the settler walks to the berth an away ship of
// theirs comes back to moor at on this island and stands there for its return, or keeps their spot
// when none will come home. A route that dies under the hull - a step another ship blocked, say - or
// a berth that went out from under the ship ends no leg: the watcher runs the leg's berth choice
// again, the nearest shore the water still takes, so the crossing always moors where the coast lets
// it and nobody is left ashore or adrift. The pieces are the crew's attach and board, the dock order's
// sail and moor, and the rider rung's held leaving; this file only books the crossing, flips it from
// boarding to sailing, sails it home, and reads it over.

/**
 * Book `e`, standing on its island, the crossing to `goal` on another one: the nearest idle ship of
 * `e`'s owner moored at a shore of this island with a ferryman aboard takes the booking, `e` walks to its
 * door and boards, and the ship sails once every passenger is inside. When this island keeps no such
 * ship, the nearest one of another island whose sea reaches this shore is dispatched instead: it sails
 * here first (the phase `pickup`), and while it sails, the passenger walks toward the water and holds
 * at the shore the crossing booked for it, riding nothing; it takes its seat and the walk to the door
 * only once the ship has moored. When no ship takes the booking at all, the order stands as a hold:
 * while one of the owner's ships is away and comes back to moor on this island, the settler walks to
 * that berth and stands there for the ship's return; otherwise they stay where they are. False,
 * leaving the order to the caller's ordinary refusal, when the goal is no island away or no ship
 * qualifies.
 */
export function tryFerryPassage(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  goal: NodeId,
): boolean {
  const start = entityNode(world, terrain, e);
  const home = terrain.componentOf(start);
  const target = terrain.componentOf(goal);
  // Any fresh booking attempt ends an older hold: the settler is being aimed anew, at this goal or
  // at another one. The hold is re-armed below when no ship is free for this goal either, and its
  // old wait walk, if the re-arm books no berth, stands down against the spot it walked to.
  const previousWait = world.tryGet(e, FerryWaiting)?.wait ?? null;
  world.remove(e, FerryWaiting);
  if (home === NO_COMPONENT || target === NO_COMPONENT || home === target) return false;
  const owner = ownerOf(world, e);
  if (owner === undefined) return false;
  // A re-click while a crossing stands keeps its ship when it aims at the same island: only the walk on
  // from the far shore re-aims. An order to a rider detaches it first (the command pass), so the seat is
  // taken again and the walk to the door resumes where the detach left it. A dispatch booking waits for
  // its ship standing where it is: the re-click only re-aims.
  const booked = world.tryGet(e, FerryPassenger);
  if (booked !== undefined) {
    const voyage = world.tryGet(booked.ship, FerryVoyage);
    if (voyage !== undefined && terrain.componentOf(booked.goal) === target) {
      world.mut(e, FerryPassenger).goal = goal;
      retargetLeaving(world, terrain, e, goal);
      if (voyage.phase === 'pickup' || world.tryGet(e, Rider)?.vehicle === booked.ship) return true;
      if (attachToVehicle(world, ctx, { kind: 'attachToVehicle', entity: e, vehicle: booked.ship })) {
        boardVehicle(world, ctx, { kind: 'boardVehicle', entity: e });
        return true;
      }
    }
    world.remove(e, FerryPassenger); // its voyage is gone, or the re-click aims at another island
  }
  let ship = nearestFerry(world, ctx, terrain, e, owner, start, target);
  let dispatched = false;
  if (ship === null) {
    ship = nearestFerryAcross(world, ctx, terrain, e, owner, start, target);
    dispatched = ship !== null;
  }
  if (ship === null) {
    // No free ship anywhere: the order stands as a hold instead of refusing lost. When one of the
    // owner's ships is away and comes back to moor on this island, the settler walks to that berth
    // and stands there, so they board the moment the ship lies at it again; with no ship coming home
    // they stay where they are. The ferry system retries this booking until a ship comes free - one
    // coming back from a crossing, newly crewed or newly built - or until their own new order ends
    // the hold.
    const berth = returnBerthOf(world, ctx, terrain, owner, start);
    world.add(e, FerryWaiting, { goal, since: ctx.tick, wait: berth });
    if (berth !== null) holdAtShore(world, terrain, e, berth);
    else if (previousWait !== null) endHoldWalk(world, e, previousWait);
    return true;
  }
  if (!dispatched) {
    // The ship lies at this shore: the seat is taken now and the walk to the door goes out.
    if (!attachToVehicle(world, ctx, { kind: 'attachToVehicle', entity: e, vehicle: ship })) return false;
    boardVehicle(world, ctx, { kind: 'boardVehicle', entity: e }); // step in on reaching the door
  }
  const voyage = world.tryGet(ship, FerryVoyage);
  if (voyage === undefined) {
    const mooring = world.tryGet(ship, Vehicle)?.mooring ?? null;
    world.add(ship, FerryVoyage, {
      passengers: [e],
      shore: null,
      phase: dispatched ? 'pickup' : 'board',
      since: ctx.tick,
      home: mooring === null ? null : { hx: mooring.hx, hy: mooring.hy },
    });
  } else if (!voyage.passengers.includes(e)) {
    world.mut(ship, FerryVoyage).passengers.push(e); // boarding or dispatch continues: one more seat booked
  }
  // A dispatched booking's passenger walks toward the water while the ship sails: the shore the
  // crossing holds for them - the booked berth of a crossing joined under way, else the spot the
  // shore choice will take on their own island - is where they wait, at the coast when the ship
  // arrives. A booking on a ship already lying at their island walks the door instead, so it holds
  // no wait spot.
  const held = voyage?.shore ?? null;
  const wait =
    held !== null
      ? terrain.nodeAt(held.hx, held.hy)
      : dispatched
        ? predictedShore(world, ctx, terrain, ship, start, home)
        : null;
  world.add(e, FerryPassenger, { ship, goal, wait });
  if (wait !== null) holdAtShore(world, terrain, e, wait);
  return true;
}

/**
 * The landing place on the settler's own island that a crossing to `goal` would walk them over: the
 * door of the idle ship that would take the booking now, the coast spot a dispatched crossing holds
 * its passenger at while it sails, the berth an away ship comes back to moor at for a hold, or the
 * settler's own node when a hold would keep them standing where they are. Null when `goal` is no
 * crossing away - the settler's own land, or off it - leaving the goal to the caller's ordinary
 * confinement. This is the signpost question a cross-island order asks: the posts must lead the
 * settler to the landing place, and whether they could walk the far island themselves is the
 * ferryman's business - the ferryman at the helm knows it.
 */
export function ferryLandingOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  goal: NodeId,
): NodeId | null {
  const start = entityNode(world, terrain, e);
  const home = terrain.componentOf(start);
  const target = terrain.componentOf(goal);
  if (home === NO_COMPONENT || target === NO_COMPONENT || home === target) return null;
  const owner = ownerOf(world, e);
  if (owner === undefined) return null;
  const idle = nearestFerry(world, ctx, terrain, e, owner, start, target);
  if (idle !== null) {
    const door = landingOf(world, ctx, idle);
    return door === null ? null : terrain.nodeAt(door.hx, door.hy);
  }
  const dispatched = nearestFerryAcross(world, ctx, terrain, e, owner, start, target);
  if (dispatched !== null) return predictedShore(world, ctx, terrain, dispatched, start, home) ?? start;
  return returnBerthOf(world, ctx, terrain, owner, start) ?? start;
}

/**
 * The berth a held booking waits at: the shore point the nearest of the owner's ships that is away
 * comes back to moor at on the settler's island - a crossing's booked home mooring, which its return
 * leg sails it to, or the point of a dock order still sailing in. Null when no ship will come back
 * here - none is out, or the one under way moors at another island's shore - so the settler stands
 * where they are. Ships pinned to a trader or carried by another are out of service and no berth.
 * Nearest by the hex distance from the settler, ties broken by the ascending entity id the vehicle
 * index lists.
 */
function returnBerthOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owner: number,
  start: NodeId,
): NodeId | null {
  const home = terrain.componentOf(start);
  if (home === NO_COMPONENT) return null;
  const from = terrain.coordsOf(start);
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const ship of vehicleIndex(world).ownedBy(owner)) {
    const state = world.get(ship, Vehicle);
    const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
    if (type === undefined || !isShipVehicle(type)) continue;
    if (state.carrier !== null || state.hauler !== null) continue; // riding or pinned out of service
    if (world.has(ship, TradeShip)) continue;
    const voyage = world.tryGet(ship, FerryVoyage);
    const point =
      voyage !== undefined ? voyage.home : state.task === 'docks' ? state.mooring : null;
    if (point === null) continue; // no trip that ends at a mooring of its own
    const berth = terrain.nodeAtClamped(point.hx, point.hy);
    if (terrain.componentOf(berth) !== home) continue; // it comes back to another island, not this one
    const distance = hexDistanceBetween(terrain.xOf(berth), terrain.yOf(berth), from.x, from.y);
    if (distance < bestDistance) {
      best = berth;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * End a hold's own walk that the re-armed hold no longer books a berth for: the ship it waited for
 * will come back elsewhere or not at all, so the walk to its old berth stands down. Only the walk
 * aimed at the old spot ends - the settler's own business keeps going.
 */
function endHoldWalk(world: World, e: Entity, previous: NodeId): void {
  const walk = world.tryGet(e, MoveGoal);
  if (walk === undefined || walk.cell !== previous) return;
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
}

/**
 * The mooring spot of the land `target` that the ship's water reaches, nearest `ref`: the berth the
 * shore choice will take unless the route to it is dead, and the spot a dispatched booking's waiting
 * passenger holds at while the ship sails. Null when the ship keeps no spot set for that shore.
 */
function predictedShore(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  ship: Entity,
  ref: NodeId,
  target: number,
): NodeId | null {
  const spots = mooringSpotsOf(world, ctx, terrain, ship);
  if (spots === null) return null;
  const goal = terrain.coordsOf(ref);
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const spot of spots.spots) {
    if (terrain.componentOf(spot) !== target) continue;
    const distance = hexDistanceBetween(terrain.xOf(spot), terrain.yOf(spot), goal.x, goal.y);
    if (distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Hold a waiting booking's walker at `node`: a dispatched passenger at the water, a held settler at
 * the berth their away ship comes back to. A bare move goal - no player order, so the watcher's
 * stray-route prune reads it against the marker's `wait` and lets it stand. A walker standing on the
 * spot already is left alone; an in-flight route to a previous wait is dropped, so the new goal
 * replans from scratch instead of racing the prune.
 */
function holdAtShore(world: World, terrain: TerrainGraph, e: Entity, node: NodeId): void {
  const walk = world.tryGet(e, MoveGoal);
  if (walk !== undefined && walk.cell === node) return;
  if (entityNode(world, terrain, e) === node) {
    world.remove(e, MoveGoal);
    return;
  }
  world.remove(e, PathRequest);
  world.add(e, MoveGoal, { cell: node });
}

/**
 * Re-point the waiting passengers at the shore the crossing now holds for them: the berth the booking
 * predicted can differ once the route a dock order would take is judged, and a re-pick after a dead
 * berth moves it again. Riders are aboard or already walking the door and keep their own walk.
 */
function syncWaitShore(
  world: World,
  terrain: TerrainGraph,
  ship: Entity,
  passengers: readonly Entity[],
): void {
  const shore = world.get(ship, FerryVoyage).shore;
  if (shore === null) return;
  const node = terrain.nodeAt(shore.hx, shore.hy);
  for (const passenger of passengers) {
    const marker = world.tryGet(passenger, FerryPassenger);
    if (marker === undefined || world.has(passenger, Rider)) continue;
    if (marker.wait !== node) world.mut(passenger, FerryPassenger).wait = node;
    holdAtShore(world, terrain, passenger, node);
  }
}

/**
 * The nearest ship that takes the booking: owned, a ship, lying moored at a shore of the settler's
 * island under no order and no pin, held by no colony's plan or trade route, commanded, with a free
 * seat and a ferryman aboard, its door on this island's ground. One already booked takes another
 * passenger only while it still boards at this shore for the same target island. Nearest by the
 * door's hex distance, ties broken by the ascending entity id the vehicle index lists.
 */
function nearestFerry(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  owner: number,
  start: NodeId,
  target: number,
): Entity | null {
  const held = colonyHeldShips(world, owner);
  const heldSet = held.length === 0 ? null : new Set(held);
  const from = terrain.coordsOf(start);
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const ship of vehicleIndex(world).ownedBy(owner)) {
    const state = world.get(ship, Vehicle);
    const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
    if (type === undefined || !isShipVehicle(type)) continue;
    if (!state.moored || state.mooring === null) continue; // under way or adrift: nobody boards it
    if (state.task !== 'none') continue; // no held goto or dock: the crossing waits for no one else's
    if (state.carrier !== null || state.hauler !== null) continue; // riding or pinned out of service
    if (world.has(ship, TradeShip)) continue;
    const voyage = world.tryGet(ship, FerryVoyage);
    if (voyage !== undefined) {
      if (voyage.phase !== 'board') continue; // a sailing crossing takes no more bookings
      const first = world.tryGet(voyage.passengers[0] as Entity, FerryPassenger);
      if (first === undefined || terrain.componentOf(first.goal) !== target) continue;
    }
    if (heldSet?.has(ship) === true) continue;
    if (vehicleCommander(state) === null) continue; // a sail needs somebody at the helm
    if (!hasFreeSeat(state)) continue;
    if (!hasFerrymanAboard(world, ctx, state)) continue;
    if (!doorReachable(world, ctx, e, ship)) continue;
    const door = landingOf(world, ctx, ship);
    if (door === null) continue;
    const distance = hexDistanceBetween(from.x, from.y, door.hx, door.hy);
    if (distance < bestDistance) {
      best = ship;
      bestDistance = distance;
    }
  }
  return best;
}

/** Whether a living ferryman's seat is booked on `state`: the trade that crews the crossing. */
function hasFerrymanAboard(world: World, ctx: SystemContext, state: VehicleStateView): boolean {
  for (const seat of state.passengers) {
    if (seat === null || !world.isAlive(seat.entity)) continue;
    if (isFerrymanJob(ctx.content, world.tryGet(seat.entity, Settler)?.jobType ?? null)) return true;
  }
  return false;
}

/**
 * The nearest ship for a dispatch, for the island that keeps no ferry of its own: the same trade as
 * {@link nearestFerry}, but the ship may lie on any shore whose sea reaches the passenger's island,
 * judged by its mooring spots — a ship that cannot leave its berth for that shore takes nobody. A ship
 * already under a crossing takes none. Nearest by the hex distance from the passenger to the ship's
 * mooring, ties broken by the ascending entity id the vehicle index lists.
 */
function nearestFerryAcross(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  owner: number,
  start: NodeId,
  target: number,
): Entity | null {
  const held = colonyHeldShips(world, owner);
  const heldSet = held.length === 0 ? null : new Set(held);
  const from = terrain.coordsOf(start);
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const ship of vehicleIndex(world).ownedBy(owner)) {
    const state = world.get(ship, Vehicle);
    const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
    if (type === undefined || !isShipVehicle(type)) continue;
    if (!state.moored || state.mooring === null) continue; // under way or adrift: nobody boards it
    if (state.task !== 'none') continue; // no held goto or dock: the crossing waits for no one else's
    if (state.carrier !== null || state.hauler !== null) continue; // riding or pinned out of service
    if (world.has(ship, TradeShip)) continue;
    const voyage = world.tryGet(ship, FerryVoyage);
    if (voyage !== undefined) {
      if (voyage.phase !== 'pickup') continue; // a sailing or boarding crossing takes no dispatch on top
      const first = world.tryGet(voyage.passengers[0] as Entity, FerryPassenger);
      if (first === undefined || terrain.componentOf(first.goal) !== target) continue;
    }
    if (heldSet?.has(ship) === true) continue;
    if (vehicleCommander(state) === null) continue; // a sail needs somebody at the helm
    if (!hasFreeSeat(state)) continue;
    if (!hasFerrymanAboard(world, ctx, state)) continue;
    const spots = mooringSpotsOf(world, ctx, terrain, ship);
    if (spots === null) continue;
    let reaches = false;
    for (const spot of spots.spots) {
      if (terrain.componentOf(spot) === target) {
        reaches = true;
        break;
      }
    }
    if (!reaches) continue; // its sea never touches the passenger's island
    const mooring = state.mooring;
    const distance = hexDistanceBetween(from.x, from.y, mooring.hx, mooring.hy);
    if (distance < bestDistance) {
      best = ship;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Advance every booked crossing one tick. Boarding ends, and the dock order goes out, the tick every
 * passenger is inside; the sail re-aims each rider's held leaving at its spot and the next rider pass
 * walks it on from the shore the ship moors at. A delivered crossing sails the empty ship back to the
 * mooring the crossing booked it at before the watcher ends. A ship the player sailed off, a dock no
 * shore took or a sail that lost its way lapses the booking, the passengers left where the ship last
 * lay moored.
 */
export const ferrySystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no crossings were bookable
  for (const ship of world.canonicalQuery(FerryVoyage)) {
    advanceVoyage(world, ctx, terrain, ship);
  }
  retryHolds(world, ctx, terrain);
};

/**
 * Advance every held booking: a settler whose move order found no free ship stands by it and takes
 * the first ship that comes free. Each retry runs the same search a click runs, so the held settler
 * joins a crossing still boarding, rides the ship that just moored home or takes a newly crewed one
 * the moment the search lets it. Between retries they walk the berth the hold booked them - the spot
 * an away ship comes back to moor at - and stand there for its return; a route anywhere but that
 * spot ends the hold, so their own new order takes them off it. A hold standing free (no berth to
 * walk) ends on whatever the settler takes up where they stand; a hold with a berth keeps its walk
 * through a pause put on them - hunger queues the move order for a meal break, and any other atomic
 * was never the planner's, so the booking reads neither as given up. The hold also ends when the
 * booking is made.
 */
function retryHolds(world: World, ctx: SystemContext, terrain: TerrainGraph): void {
  for (const e of world.canonicalQuery(FerryWaiting)) {
    const marker = world.get(e, FerryWaiting);
    if (
      !world.isAlive(e) ||
      !world.has(e, Settler) ||
      !world.has(e, Position) ||
      world.has(e, PlayerOrder)
    ) {
      world.remove(e, FerryWaiting); // gone, or a fresh command of their own is in the slot
      continue;
    }
    // Hunger takes the held booking off its walk the way it takes any long walk off: the meal break
    // queues the move order itself, so the settler eats and then sets out again - and the fresh order
    // re-arms the hold, berth walk included, once the break ends. Dropping the order here would leave
    // a hungry holder standing at the coast forever, for the planner never re-tasks them.
    if (breaksForMeal(world, ctx, e)) {
      const at = terrain.coordsOf(marker.goal);
      suspendWalkForMeal(world, terrain, e, { kind: 'moveUnit', entity: e, x: at.x, y: at.y });
      world.remove(e, FerryWaiting);
      continue;
    }
    const route = world.tryGet(e, PathRequest);
    if (route !== undefined && (marker.wait === null || route.goal !== marker.wait)) {
      world.remove(e, FerryWaiting); // they walk somewhere of their own instead
      continue;
    }
    // The planner never re-tasks a hold with a berth to walk to, and a chat claim refuses one, so an
    // atomic on such a holder came from elsewhere - a script's errand, say: a pause put on them, not
    // their own business, and the hold keeps its walk the way it keeps the pause. A hold standing
    // free is planner-visible; whatever it takes up there - work, a chat - ends it.
    if (marker.wait === null && world.has(e, CurrentAtomic)) {
      world.remove(e, FerryWaiting); // they took up something of their own where they stand
      continue;
    }
    if (!holdAttemptDue(world, e, ctx.tick)) continue;
    stampHoldTry(world, e, ctx.tick);
    tryFerryPassage(world, ctx, terrain, e, marker.goal);
    // The retry re-arms the hold when the search still finds no ship; a booking replaces it.
    if (world.has(e, FerryPassenger)) world.remove(e, FerryWaiting);
  }
}

/** Ticks between the hold's booking retries: the same rhythm the voyage watcher retries lapsed legs. */
const HOLD_RETRY_TICKS = 8;
/** The last try per held settler, so a crowd of holds does not search the whole roster every tick. */
const holdRetry = new WeakMap<World, Map<Entity, number>>();

/** Whether `e`'s hold may make its next booking try: the first one at once, then throttled. */
function holdAttemptDue(world: World, e: Entity, tick: number): boolean {
  const last = holdRetry.get(world)?.get(e);
  return last === undefined || tick - last >= HOLD_RETRY_TICKS;
}

/** Note `e`'s hold try as made now, so the next one waits its throttle. */
function stampHoldTry(world: World, e: Entity, tick: number): void {
  let held = holdRetry.get(world);
  if (held === undefined) {
    held = new Map();
    holdRetry.set(world, held);
  }
  held.set(e, tick);
}

/** One ship's voyage step: prune the passenger list, then run the leg the voyage stands in. */
function advanceVoyage(world: World, ctx: SystemContext, terrain: TerrainGraph, ship: Entity): void {
  const voyage = world.tryGet(ship, FerryVoyage);
  if (voyage === undefined) return;
  const state = world.tryGet(ship, Vehicle);
  if (state === undefined) {
    dropBooking(world, ship, voyage); // the ship is gone: whatever boarded it died with it
    return;
  }
  const remaining: Entity[] = [];
  for (const passenger of voyage.passengers) {
    const marker = world.tryGet(passenger, FerryPassenger);
    const rides = world.tryGet(passenger, Rider)?.vehicle === ship;
    const route = world.tryGet(passenger, PathRequest);
    if (
      marker === undefined ||
      marker.ship !== ship ||
      !world.isAlive(passenger) ||
      (!rides &&
        // A dispatch booking's passengers walk to the shore the crossing holds for them and stand
        // ashore, riding nothing, until the ship moors at their island; they stay booked only while
        // they wait - an order of their own takes them off the list, and so does a route anywhere but
        // the crossing's wait spot: the wait walk itself is the crossing's own bare move goal, whose
        // route goal reads `wait`.
        (voyage.phase !== 'pickup' ||
          world.has(passenger, PlayerOrder) ||
          world.has(passenger, CurrentAtomic) ||
          (route !== undefined && (marker.wait === null || route.goal !== marker.wait))))
    ) {
      if (marker?.ship === ship) world.remove(passenger, FerryPassenger);
      continue; // dead, released, re-attached elsewhere or walked off its dispatch: the crossing is over for it
    }
    remaining.push(passenger);
  }
  if (remaining.length !== voyage.passengers.length) {
    world.mut(ship, FerryVoyage).passengers = remaining;
  }
  if (remaining.length === 0) {
    // Delivered — or every passenger gone while a dispatch was under way: the taxi sails back to the
    // mooring the crossing booked it at, watched until it lies there again, so the next booking finds
    // it home. The watcher retries while the ship still lies at the far shore - a berth next to another
    // ship can leave its anchor without a mooring-spot set, and the water can open up later - and
    // while a lapsed route left it adrift, and ends when it is home or the player has moored it
    // elsewhere.
    if (
      voyage.phase === 'sail' ||
      voyage.phase === 'pickup' ||
      (voyage.phase === 'return' && (atMooring(state, voyage.shore) || !state.moored))
    ) {
      if (!world.has(ship, VehicleDrive) && watchAttemptDue(world, ship, ctx.tick)) {
        startReturnVoyage(world, ctx, terrain, ship, voyage);
      }
    }
    if (voyage.phase === 'return') {
      if (world.has(ship, VehicleDrive)) return; // the sail home is under way
      // It still lies at the far shore with the water choked, or lies nowhere at all - a route that
      // died under the hull left it adrift. Either way the try comes again next attempt: an unmoored
      // hull without its voyage would sit in the water forever, bookable by nobody.
      if (atMooring(state, voyage.shore) || !state.moored) return;
    }
    if (voyage.phase === 'pickup' && world.has(ship, VehicleDrive)) return; // the empty pickup runs on
    world.remove(ship, FerryVoyage);
    return;
  }
  if (voyage.phase === 'pickup') {
    if (world.has(ship, VehicleDrive)) return; // the sail to the passengers' island is under way
    if (voyage.shore === null) {
      // Not sailed yet: it must lie moored under no order — the player ordering it off instead lapses
      // the booking and leaves the waiting passengers where they stand.
      if (state.task !== 'none' || !state.moored) {
        cancelVoyage(world, ctx, ship, voyage, remaining, true);
        return;
      }
      const first = remaining[0] as Entity | undefined;
      if (first === undefined) return;
      const at = entityNode(world, terrain, first);
      if (sailToShore(world, ctx, terrain, ship, state, at, terrain.componentOf(at), 'pickup')) {
        syncWaitShore(world, terrain, ship, remaining);
      } else {
        cancelVoyage(world, ctx, ship, voyage, remaining, true); // no shore took the dock
      }
      return;
    }
    if (atMooring(state, voyage.shore)) {
      const door = landingOf(world, ctx, ship);
      if (door === null) {
        cancelVoyage(world, ctx, ship, voyage, remaining, true);
        return;
      }
      world.mut(ship, FerryVoyage).phase = 'board';
      // The ship lies at their shore at last: each waiting passenger takes the seat it booked and the
      // walk to the door goes out; one the ship can no longer seat is told the way is lost.
      let kept = remaining.length;
      for (const passenger of remaining) {
        if (!attachToVehicle(world, ctx, { kind: 'attachToVehicle', entity: passenger, vehicle: ship })) {
          const goal = world.tryGet(passenger, FerryPassenger)?.goal;
          world.remove(passenger, FerryPassenger);
          if (goal !== undefined) markLostWay(world, ctx, passenger, goal);
          kept--;
        } else {
          boardVehicle(world, ctx, { kind: 'boardVehicle', entity: passenger });
        }
      }
      if (kept !== remaining.length) {
        world.mut(ship, FerryVoyage).passengers = remaining.filter((passenger) =>
          world.has(passenger, FerryPassenger),
        );
      }
      return;
    }
    if (!state.moored) {
      // Adrift with the pickup under way: the route died under the hull, or the berth it booked went
      // out from under it. The berth choice runs again - the nearest shore the water still takes,
      // judged now, the waiting passenger the reference - so the taxi moors where the coast lets it
      // and the passenger walks that door, instead of the dead berth haunting the crossing.
      if (watchAttemptDue(world, ship, ctx.tick)) {
        const first = remaining[0] as Entity | undefined;
        const at = first === undefined ? null : entityNode(world, terrain, first);
        const booked =
          at !== null && sailToShore(world, ctx, terrain, ship, state, at, terrain.componentOf(at), 'pickup');
        if (booked) {
          watchRetry.get(world)?.delete(ship);
          syncWaitShore(world, terrain, ship, remaining);
        } else {
          stampWatchTry(world, ship, ctx.tick);
        }
      }
      return;
    }
    cancelVoyage(world, ctx, ship, voyage, remaining, true); // moored off the booked shore: the player's
    return;
  }
  if (voyage.phase === 'board') {
    // The player ordered the ship off mid-boarding: the booking lapses, its riders stay ordinary ones.
    if (state.task !== 'none' || !state.moored) {
      cancelVoyage(world, ctx, ship, voyage, remaining, false);
      return;
    }
    if (remaining.every((passenger) => !world.has(passenger, Position))) {
      // All aboard: pick the shore of the target island nearest the first booking's spot and sail.
      if (!sailVoyage(world, ctx, terrain, ship, state, remaining[0] as Entity)) {
        cancelVoyage(world, ctx, ship, voyage, remaining, true);
      }
    }
    return;
  }
  const arrived =
    state.moored &&
    state.mooring !== null &&
    voyage.shore !== null &&
    state.mooring.hx === voyage.shore.hx &&
    state.mooring.hy === voyage.shore.hy;
  if (arrived) {
    holdLeaving(world, terrain, remaining); // the next rider pass steps them ashore
    return;
  }
  if (state.moored) {
    // Moored off the booked shore: the dock lapsed or the player re-docked it. The way across is lost.
    cancelVoyage(world, ctx, ship, voyage, remaining, true);
    return;
  }
  if (!world.has(ship, VehicleDrive)) {
    // Adrift with the crossing under way: the sail's route died under the hull - a step another ship
    // blocked, say - or the berth it booked went out from under it; the player's own stop moors it at
    // the booked shore and reads as arrived above. A dead route keeps its booking: the berth choice
    // runs again - the nearest shore of the target island the water still takes, judged now, the first
    // booking's goal the reference - so the ship lands where the coast lets it and the riders walk on
    // from there, instead of the dead berth haunting the crossing or ship and passengers sitting
    // adrift with nobody watching.
    if (watchAttemptDue(world, ship, ctx.tick)) {
      const first = remaining[0] as Entity | undefined;
      const booked = first !== undefined && sailVoyage(world, ctx, terrain, ship, state, first);
      if (booked) watchRetry.get(world)?.delete(ship);
      else stampWatchTry(world, ship, ctx.tick);
    }
    return;
  }
  holdLeaving(world, terrain, remaining);
}

/**
 * Sail the boarding-complete voyage for its target island: the mooring spots the ship's sea reaches
 * that lie on the first booking's goal's land, the nearest that goal first, each judged by the route a
 * dock order would take. False when the ship's sea reaches no shore of that island; the booking is
 * then refused and the passengers put ashore where the ship lies.
 */
function sailVoyage(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  ship: Entity,
  state: VehicleStateView,
  passenger: Entity,
): boolean {
  const first = world.tryGet(passenger, FerryPassenger);
  if (first === undefined) return false;
  return sailToShore(world, ctx, terrain, ship, state, first.goal, terrain.componentOf(first.goal), 'sail');
}

/**
 * Sail `ship` to a shore of the land `target` nearest the node `ref`, and book the berth it takes in
 * the voyage's `shore` with the voyage left in `phase` — `'sail'` for a delivery, `'pickup'` for the
 * sail to a waiting passenger's island. False when no shore takes the dock.
 */
function sailToShore(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  ship: Entity,
  state: VehicleStateView,
  ref: NodeId,
  target: number,
  phase: 'sail' | 'pickup',
): boolean {
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return false;
  const goal = terrain.coordsOf(ref);
  const spots = mooringSpotsOf(world, ctx, terrain, ship);
  if (spots !== null) {
    const candidates: NodeId[] = [];
    for (const spot of spots.spots) {
      if (terrain.componentOf(spot) === target) candidates.push(spot);
    }
    // Nearest the reference first, ties in ascending node id: the passengers land as close to their
    // spots as the coast lets them.
    candidates.sort(
      (a, b) =>
        hexDistanceBetween(terrain.xOf(a), terrain.yOf(a), goal.x, goal.y) -
          hexDistanceBetween(terrain.xOf(b), terrain.yOf(b), goal.x, goal.y) ||
        a - b,
    );
    for (const spot of candidates) {
      const at = nodeOf(terrain, spot);
      if (dockRoute(world, ctx, terrain, ship, at) === null) continue;
      if (dockVehicle(world, ctx, { kind: 'dockVehicle', vehicle: ship, x: at.hx, y: at.hy })) {
        const live = world.mut(ship, FerryVoyage);
        live.phase = phase;
        live.shore = { hx: at.hx, hy: at.hy };
        return true;
      }
    }
  }
  // The spot set can come back empty (a tight berth leaves the anchor below its free-size class) or
  // miss a shore the route still reaches: the reference's own point is the last word.
  const direct = nodeOf(terrain, ref);
  if (
    dockRoute(world, ctx, terrain, ship, direct) !== null &&
    dockVehicle(world, ctx, { kind: 'dockVehicle', vehicle: ship, x: direct.hx, y: direct.hy })
  ) {
    const live = world.mut(ship, FerryVoyage);
    live.phase = phase;
    live.shore = { hx: direct.hx, hy: direct.hy };
    return true;
  }
  return false;
}

/**
 * Sail the delivered voyage back to the mooring the crossing booked it at. The booked home point
 * itself first, judged by the route a dock order would take - the berth next to another ship can
 * leave the ship's anchor with no mooring-spot set at all (the sea there is too tight for its free
 * size class), while the route back still runs, so the spots must not gate the way home. Then the
 * mooring spots the ship's sea reaches that lie on the home point's land, the nearest first, for a
 * home berth another ship has taken. False when neither takes: the phase flips to `return` all the
 * same, so the watcher keeps trying while the ship still lies at the far shore.
 */
function startReturnVoyage(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  ship: Entity,
  voyage: VehicleVoyageView,
): boolean {
  const home = voyage.home;
  const taken = takeReturnDock(world, ctx, terrain, ship, voyage, home === null || home === undefined ? null : { hx: home.hx, hy: home.hy });
  const live = world.mut(ship, FerryVoyage);
  live.phase = 'return';
  if (taken) watchRetry.get(world)?.delete(ship);
  else stampWatchTry(world, ship, ctx.tick);
  return taken;
}

/** Ticks between the watcher's tries to bring a lapsed leg back on the water. */
const WATCH_RETRY_TICKS = 8;
/** The last try per ship, so a wedged watcher does not search the whole shore every tick. */
const watchRetry = new WeakMap<World, Map<Entity, number>>();

/** Whether `ship`'s watcher may make its next try: the first one at once, then throttled. */
function watchAttemptDue(world: World, ship: Entity, tick: number): boolean {
  const last = watchRetry.get(world)?.get(ship);
  return last === undefined || tick - last >= WATCH_RETRY_TICKS;
}

/** Note `ship`'s watcher try as made now, so the next one waits its throttle. */
function stampWatchTry(world: World, ship: Entity, tick: number): void {
  let held = watchRetry.get(world);
  if (held === undefined) {
    held = new Map();
    watchRetry.set(world, held);
  }
  held.set(ship, tick);
}

/**
 * Issue the dock order that takes the ship from its berth to `point`, or, when `point` itself gives
 * no route, to the mooring spot on its land nearest the point. False when neither routes.
 */
function takeReturnDock(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  ship: Entity,
  voyage: VehicleVoyageView,
  point: { hx: number; hy: number } | null,
): boolean {
  if (point !== null) {
    if (
      dockRoute(world, ctx, terrain, ship, point) !== null &&
      dockVehicle(world, ctx, { kind: 'dockVehicle', vehicle: ship, x: point.hx, y: point.hy })
    )
      return true;
  }
  const home = voyage.home;
  if (home === null || home === undefined) return false;
  const spots = mooringSpotsOf(world, ctx, terrain, ship);
  if (spots === null) return false;
  const homeComponent = terrain.componentOf(terrain.nodeAtClamped(home.hx, home.hy));
  if (homeComponent === NO_COMPONENT) return false;
  const candidates: NodeId[] = [];
  for (const spot of spots.spots) {
    if (terrain.componentOf(spot) === homeComponent) candidates.push(spot);
  }
  // The shore nearest the booked point, ties in ascending node id: the taxi comes back to where it
  // started, or as close as the coast lets it.
  candidates.sort(
    (a, b) =>
      hexDistanceBetween(terrain.xOf(a), terrain.yOf(a), home.hx, home.hy) -
        hexDistanceBetween(terrain.xOf(b), terrain.yOf(b), home.hx, home.hy) ||
      a - b,
  );
  for (const spot of candidates) {
    const at = nodeOf(terrain, spot);
    if (dockRoute(world, ctx, terrain, ship, at) === null) continue;
    if (dockVehicle(world, ctx, { kind: 'dockVehicle', vehicle: ship, x: at.hx, y: at.hy })) return true;
  }
  return false;
}

/** Whether `state` lies moored at `point`: the watcher compares shores by node. */
function atMooring(state: VehicleStateView, point: { readonly hx: number; readonly hy: number } | null): boolean {
  return (
    state.moored &&
    state.mooring !== null &&
    point !== null &&
    state.mooring.hx === point.hx &&
    state.mooring.hy === point.hy
  );
}

/** Point every aboard passenger's held leaving at its walk-on spot, once each. */
function holdLeaving(world: World, terrain: TerrainGraph, passengers: readonly Entity[]): void {
  for (const passenger of passengers) {
    if (world.has(passenger, Position)) continue; // still walking to the door
    const rider = world.tryGet(passenger, Rider);
    if (rider === undefined || rider.leaving !== null) continue;
    const goal = world.tryGet(passenger, FerryPassenger)?.goal;
    if (goal === undefined) continue;
    world.mut(passenger, Rider).leaving = { to: nodeOf(terrain, goal) };
  }
}

/** A re-clicked spot replaces a aboard passenger's held leaving, so the walk on aims there. */
function retargetLeaving(world: World, terrain: TerrainGraph, e: Entity, goal: NodeId): void {
  if (world.has(e, Position)) return;
  const rider = world.tryGet(e, Rider);
  if (rider === undefined || rider.leaving === null) return;
  world.mut(e, Rider).leaving = { to: nodeOf(terrain, goal) };
}

/**
 * Lapse a voyage with a note: the passengers step ashore where the ship lies moored, each stamped
 * lost over the spot it never reached, and the booking is dropped. A passenger the ship cannot land
 * (it lies at sea) stays aboard, an ordinary rider now.
 */
function cancelVoyage(
  world: World,
  ctx: SystemContext,
  ship: Entity,
  voyage: VehicleVoyageView,
  passengers: readonly Entity[],
  note: boolean,
): void {
  for (const passenger of passengers) {
    const booked = world.tryGet(passenger, FerryPassenger);
    const goal = booked?.goal;
    if (booked !== undefined && booked.wait !== null) world.remove(passenger, MoveGoal);
    world.remove(passenger, FerryPassenger);
    if (world.tryGet(passenger, Rider)?.vehicle !== ship) {
      // A dispatch booking's waiting passenger rides nothing: the lapse still tells them the way is lost.
      if (note && goal !== undefined) markLostWay(world, ctx, passenger, goal);
      continue;
    }
    if (!detachFromVehicle(world, ctx, { kind: 'detachFromVehicle', entity: passenger })) continue;
    if (note && goal !== undefined) {
      markLostWay(world, ctx, passenger, goal);
      if (world.has(passenger, Position)) stopAtNextNode(world, passenger);
    }
  }
  world.remove(ship, FerryVoyage);
}

/** Drop a voyage nobody can carry out: the passengers keep their seats as ordinary riders. */
function dropBooking(world: World, ship: Entity, voyage: VehicleVoyageView): void {
  for (const passenger of voyage.passengers) world.remove(passenger, FerryPassenger);
  world.remove(ship, FerryVoyage);
}

/** The read view a voyage step works from. */
type VehicleVoyageView = DeepReadonly<FerryVoyageState>;
