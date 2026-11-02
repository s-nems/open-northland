import {
  Position,
  Rider,
  seatPassenger,
  TRADE_ROUTE_HOUSES,
  TradeRoute,
  TradeShip,
  Vehicle,
  VehicleDrive,
  VehicleOrderQueue,
} from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { wakeIdle } from '../settlers/planner/idle-replan.js';
import { boardRider, landingOf, landRider, releaseRider } from '../vehicles/crew.js';
import { startDock } from '../vehicles/dock.js';
import { releaseTradeShip, stowCartOnShip } from '../vehicles/hauling-cart.js';
import { mooringTargetOfStop, shipLiesOn, stopContinent, tradeShipHolds } from './ship.js';

/** How long a voyage whose dock found no route waits before it tries again. Approximation: a named
 *  addition, long enough that a sea closed for good costs a search now and then. */
export const TRADE_DOCK_RETRY_TICKS = 30 * TICKS_PER_SECOND;

/** The trader steps aboard its pinned ship at the door, its hauling cart into the vehicle slot, with none
 *  of the attach order's side effects: the route stays the trader's own work. */
export function boardTradeShip(world: World, trader: Entity, ship: Entity): void {
  if (!seatPassenger(world, ship, trader)) return;
  stowCartOnShip(world, trader, ship);
  boardRider(world, trader, ship);
}

/** The trader steps ashore on the ship's landing, its cart with it, and the planner takes it up. */
function landTrader(world: World, ctx: SystemContext, trader: Entity, ship: Entity): void {
  const landing = landingOf(world, ctx, ship);
  if (landing === null) return;
  landRider(world, ctx, trader, landing);
  releaseRider(world, trader, ship);
  wakeIdle(world, trader);
}

/** Whether the ship lies at `target`, its mooring point. */
function mooredAt(terrain: TerrainGraph, world: World, ship: Entity, target: NodeId): boolean {
  const state = world.get(ship, Vehicle);
  if (!state.moored || state.mooring === null) return false;
  return terrain.nodeAtClamped(state.mooring.hx, state.mooring.hy) === target;
}

/** Whether a dock to `target` failed on this trader's last try. */
function dockFailedTo(world: World, terrain: TerrainGraph, trader: Entity, target: NodeId): boolean {
  const failed = world.get(trader, TradeShip).failedDock;
  return failed !== null && terrain.nodeAtClamped(failed.hx, failed.hy) === target;
}

/** Whether the pinned ship lies away from the mooring of the stop on its own continent, with no failed
 *  dock there yet: the trader sails it round once, and a failure leaves it working from where it lies. */
export function shipLiesAwayFrom(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  trader: Entity,
  ship: Entity,
  target: NodeId | null,
): boolean {
  if (target === null || mooredAt(terrain, world, ship, target)) return false;
  if (ctx.tick < world.get(trader, TradeShip).dockRetryAt) return false;
  return !dockFailedTo(world, terrain, trader, target);
}

/** One voyage step of a trader aboard its pinned ship and the ship lying idle. */
function sail(world: World, ctx: SystemContext, terrain: TerrainGraph, trader: Entity, ship: Entity): void {
  const state = world.get(ship, Vehicle);
  const route = world.tryGet(trader, TradeRoute);
  // A route no plan has taken up yet starts at its first stop, as the planner starts it.
  const stop = route?.stops[Math.max(route.current, 0)];
  const target =
    route === undefined || route.stops.length !== TRADE_ROUTE_HOUSES || stop === undefined
      ? null
      : mooringTargetOfStop(world, ctx, terrain, ship, stop);
  if (stop === undefined || target === null) {
    if (state.moored) landTrader(world, ctx, trader, ship); // at sea the ship stays for the player
    return;
  }
  if (mooredAt(terrain, world, ship, target)) {
    if (world.get(trader, TradeShip).failedDock !== null) world.mut(trader, TradeShip).failedDock = null;
    landTrader(world, ctx, trader, ship);
    return;
  }
  const continent = stopContinent(world, ctx, terrain, stop);
  const failedHere =
    continent !== null &&
    dockFailedTo(world, terrain, trader, target) &&
    shipLiesOn(world, ctx, terrain, ship, continent);
  if (failedHere) {
    landTrader(world, ctx, trader, ship);
    return;
  }
  if (ctx.tick < world.get(trader, TradeShip).dockRetryAt) {
    if (state.moored) landTrader(world, ctx, trader, ship);
    return;
  }
  const { x, y } = terrain.coordsOf(target);
  if (startDock(world, ctx, terrain, ship, { hx: x, hy: y })) return;
  const pin = world.mut(trader, TradeShip);
  pin.dockRetryAt = ctx.tick + TRADE_DOCK_RETRY_TICKS;
  pin.failedDock = { hx: x, hy: y };
  if (state.moored) landTrader(world, ctx, trader, ship);
}

/**
 * Keeps every pin honest and sails a trader's pinned ship: an aboard trader's idle ship docks at the
 * current stop's mooring and lands it there. A ship under a player's order, driving, holding a goal,
 * stopped or with orders queued, carries on until the order is done. Named addition. Before the planner, so a landed
 * trader plans the tick it lands.
 */
export const tradeVoyageSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  for (const trader of world.canonicalQuery(TradeShip)) {
    if (!tradeShipHolds(world, ctx, trader)) {
      releaseTradeShip(world, trader);
      continue;
    }
    const ship = world.get(trader, TradeShip).vehicle;
    if (terrain === undefined || world.has(trader, Position)) continue;
    if (world.tryGet(trader, Rider)?.vehicle !== ship) continue;
    if (world.has(ship, VehicleDrive) || world.has(ship, VehicleOrderQueue)) continue;
    const { heldGoal, task, moored } = world.get(ship, Vehicle);
    // A player's stop holds the ship at sea until the next order; only a stop lying moored has no hold.
    if (heldGoal !== null || (task === 'interrupted' && !moored)) continue;
    sail(world, ctx, terrain, trader, ship);
  }
};
