import {
  Position,
  Rider,
  TRADE_ROUTE_HOUSES,
  TradeRoute,
  Vehicle,
  VehicleDrive,
  vehicleCommander,
} from '../../components/index.js';
import type { System } from '../context.js';
import { canonicalById } from '../spatial/nodes.js';
import { landingOf, setDownRider } from '../vehicles/crew.js';

/**
 * A trader riding inside the cart it commands steps out onto the door once the cart stands still with
 * no goal held, so the trade rung can work the stop on foot; one with fewer than two houses on its
 * route stays aboard where the player put it until its cart has cargo to move
 * (`cargoHandDisembarkSystem`), and then waits by the door. Before the planner, so the trader is planned the tick it
 * lands. Reading: the original's trader runs its task from inside the vehicle and walks out through the
 * door for every unit; here the whole stop is worked from outside (approximation).
 */
export const traderDisembarkSystem: System = (world, ctx) => {
  for (const e of canonicalById(world.query(Rider, TradeRoute))) {
    if (world.has(e, Position)) continue;
    if (world.get(e, TradeRoute).stops.length < TRADE_ROUTE_HOUSES) continue;
    const vehicle = world.get(e, Rider).vehicle;
    const state = world.tryGet(vehicle, Vehicle);
    if (state === undefined || vehicleCommander(state) !== e || state.carrier !== null) continue;
    if (world.has(vehicle, VehicleDrive) || state.heldGoal !== null) continue;
    const landing = landingOf(world, ctx, vehicle);
    if (landing !== null) setDownRider(world, e, landing);
  }
};
