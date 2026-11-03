import {
  carriedVehicles,
  commanderSlotOf,
  ownerOf,
  Rider,
  Settler,
  TRADE_ROUTE_HOUSES,
  TradeRoute,
  TradeShip,
  type TradeStop,
  Vehicle,
  type VehicleStateView,
  VehicleStock,
  vehiclePassengers,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import { hexDistance } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, MapContext } from '../context.js';
import { interactionNode } from '../footprint/index.js';
import { isTrader } from '../readviews/jobs.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { isCarrierJob } from '../stores/index.js';
import { abandonCargoRun } from '../vehicles/cargo.js';
import { doorReachable, landingOf } from '../vehicles/crew.js';
import { mooringSpotsOf } from '../vehicles/dock.js';
import { releaseTradeShip } from '../vehicles/hauling-cart.js';

// The ship a player pins to a trader's route across the sea (owner's choice; the original's sea trader
// job is an empty stub): the pin, what the route reads of the sea, and where the ship lies for a stop.

/**
 * Whether the `setTradeShip` command would pin `ship` to `trader`: a trader on no vehicle, its own ship
 * with a vehicle slot, empty of vehicles and held by nobody, with no one aboard but carriers who fit its
 * ordinary seats (helpers left seated by an earlier pin), and its door on the trader's continent. The
 * ship pick lights ships by it.
 */
export function canPinTradeShip(world: World, ctx: MapContext, trader: Entity, ship: Entity): boolean {
  if (!isTrader(world, ctx.content, trader) || world.has(trader, Rider)) return false;
  const state = world.tryGet(ship, Vehicle);
  if (state === undefined || ownerOf(world, ship) !== ownerOf(world, trader)) return false;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined || !isShipVehicle(type) || state.vehicles.length === 0) return false;
  if (!onlyHelpersAboard(world, ctx, state) || carriedVehicles(state).length > 0) return false;
  if (state.hauler !== null || state.carrier !== null) return false;
  return doorReachable(world, ctx, trader, ship);
}

/** Whether everyone aboard is a carrier of the ship's owner and they all fit its ordinary seats, the
 *  commander's slot kept for the trader. */
function onlyHelpersAboard(world: World, ctx: ContentContext, state: VehicleStateView): boolean {
  const aboard = vehiclePassengers(state);
  if (aboard.length > state.passengers.length - 1) return false;
  return aboard.every((seat) => {
    const jobType = world.tryGet(seat.entity, Settler)?.jobType ?? null;
    return jobType !== null && isCarrierJob(ctx, jobType);
  });
}

/** Pin `ship` in place of any pinned before, or drop the pin with null. The route owns the hold from now
 *  on: what is aboard is what is wanted and booked, so no later cargo order flushes it. */
export function setTradeShip(world: World, ctx: MapContext, trader: Entity, ship: Entity | null): void {
  if (ship === null) {
    releaseTradeShip(world, trader);
    return;
  }
  if (!canPinTradeShip(world, ctx, trader, ship)) return;
  releaseTradeShip(world, trader);
  // A seated carrier's cargo run books on the lines; it ends before the pin takes the hold over.
  for (const seat of vehiclePassengers(world.get(ship, Vehicle))) abandonCargoRun(world, seat.entity);
  world.add(trader, TradeShip, { vehicle: ship, dockRetryAt: 0, failedDock: null, departure: null });
  world.mut(ship, Vehicle).hauler = trader;
  freeCommanderSeat(world, ship);
  if (!world.has(ship, VehicleStock)) return;
  for (const line of world.mut(ship, VehicleStock).lines.values()) {
    line.wanted = line.current;
    line.reserved = line.current;
  }
}

/** A helper the last pin's end promoted to commander steps back to an ordinary seat. */
function freeCommanderSeat(world: World, ship: Entity): void {
  const state = world.get(ship, Vehicle);
  const commander = commanderSlotOf(state.passengers.length - 1);
  const seat = state.passengers[commander];
  const free = state.passengers.findIndex((open, i) => i !== commander && open === null);
  if (seat === null || seat === undefined || free < 0) return;
  const live = world.mut(ship, Vehicle);
  live.passengers[free] = live.passengers[commander] ?? null;
  live.passengers[commander] = null;
}

/** Whether the pin still stands: the ship is there and names the trader back, and both are the same
 *  player's. A pin that fails is dropped by {@link releaseTradeShip}. */
export function tradeShipHolds(world: World, ctx: ContentContext, trader: Entity): boolean {
  const ship = world.get(trader, TradeShip).vehicle;
  const state = world.tryGet(ship, Vehicle);
  if (state === undefined || state.hauler !== trader) return false;
  return ownerOf(world, ship) === ownerOf(world, trader) && isTrader(world, ctx.content, trader);
}

/** The node of a stop's door, or null for a house with no door on the map. */
function stopDoor(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  stop: DeepReadonly<TradeStop>,
): NodeId | null {
  const door = interactionNode(world, ctx, stop.house);
  return door === null || !terrain.inBounds(door.x, door.y) ? null : terrain.nodeAt(door.x, door.y);
}

/** The continent of a stop's door, or null for a house with no door on the map. */
export function stopContinent(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  stop: DeepReadonly<TradeStop>,
): number | null {
  const door = stopDoor(world, ctx, terrain, stop);
  return door === null ? null : terrain.componentOf(door);
}

/** Whether the route's two stops lie on different continents, so no walk joins them. */
export function routeCrossesSea(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  trader: Entity,
): boolean {
  const stops = world.tryGet(trader, TradeRoute)?.stops;
  const [first, second] = stops ?? [];
  if (first === undefined || second === undefined || stops?.length !== TRADE_ROUTE_HOUSES) return false;
  const here = stopContinent(world, ctx, terrain, first);
  const there = stopContinent(world, ctx, terrain, second);
  return here !== null && there !== null && here !== there;
}

/** Whether the pinned ship lies moored with its door on `continent`. */
export function shipLiesOn(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  ship: Entity,
  continent: number,
): boolean {
  if (world.tryGet(ship, Vehicle)?.moored !== true) return false;
  const landing = landingOf(world, ctx, ship);
  return (
    landing !== null &&
    terrain.inBounds(landing.hx, landing.hy) &&
    terrain.componentOf(terrain.nodeAt(landing.hx, landing.hy)) === continent
  );
}

/** A world's answers, by sea labelling and door. Derived: the same inputs give the same node, so a
 *  restored world or an evicted entry changes no result. Never hashed. */
const targetMemo = new WeakMap<World, Map<string, NodeId | null>>();
/** The answers a world keeps; a handful of doors over a handful of seas. */
const TARGET_MEMO_ENTRIES = 64;

/**
 * Where `ship` moors to work `door`: the mooring spot on the door's continent nearest the door, ties by
 * node id; null when the ship's sea touches no such shore. The spot scan runs once per sea labelling and
 * door, never per plan.
 */
export function mooringTargetOf(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  ship: Entity,
  door: NodeId,
): NodeId | null {
  const spots = mooringSpotsOf(world, ctx, terrain, ship);
  if (spots === null) return null;
  const key = `${spots.key}:${door}`;
  let held = targetMemo.get(world);
  if (held === undefined) {
    held = new Map();
    targetMemo.set(world, held);
  }
  const cached = held.get(key);
  if (cached !== undefined) return cached;
  const continent = terrain.componentOf(door);
  const at = terrain.coordsOf(door);
  const from = { hx: at.x, hy: at.y };
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const spot of spots.spots) {
    if (terrain.componentOf(spot) !== continent) continue;
    const { x, y } = terrain.coordsOf(spot);
    const distance = hexDistance(from, { hx: x, hy: y });
    if (distance < bestDistance || (distance === bestDistance && best !== null && spot < best)) {
      best = spot;
      bestDistance = distance;
    }
  }
  if (held.size >= TARGET_MEMO_ENTRIES) held.clear();
  held.set(key, best);
  return best;
}

/** {@link mooringTargetOf} for the route's stop, or null for a house with no door. */
export function mooringTargetOfStop(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  ship: Entity,
  stop: DeepReadonly<TradeStop>,
): NodeId | null {
  const door = stopDoor(world, ctx, terrain, stop);
  return door === null ? null : mooringTargetOf(world, ctx, terrain, ship, door);
}
