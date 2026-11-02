import {
  CargoRun,
  isForeignHouse,
  Rider,
  TradeRoute,
  type TradeStop,
  Vehicle,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { DeepReadonly, Entity } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import { roomFor } from '../missions/stock.js';
import { atomicDuration } from '../readviews/animations.js';
import { edibleGoodFormOf } from '../readviews/food.js';
import {
  atOrWalk,
  PICKUP_ATOMIC_ID,
  PILEUP_ATOMIC_ID,
  startAtomic,
  startPickup,
} from '../settlers/atomics/start.js';
import { placeRefusedLoad } from '../settlers/drives/economy/vehicle-cargo.js';
import type { PlannerContext } from '../settlers/planner/context.js';
import { interactionCell } from '../settlers/targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../settlers/unreachable-goals.js';
import { isCarrierJob } from '../stores/index.js';
import { abandonCargoRun } from '../vehicles/cargo.js';
import { boardingNode, pinnedTraderOf } from '../vehicles/crew.js';
import { modifyVehicleReserved, vehicleStockGood } from '../vehicles/stock.js';
import { decideForHelper, routeStandsFinished, storableFormAt } from './drive.js';
import { type FerryHold, ferryHoldOf, traderHoldOf } from './hold.js';
import { routeCrossesSea, shipLiesOn, stopContinent } from './ship.js';

/** A helper moves one unit a trip. */
const HELPER_UNIT = 1;

/** The stop a helper works: the trader's current one, and the route's other. */
interface HelperShift {
  readonly stop: DeepReadonly<TradeStop>;
  readonly other: DeepReadonly<TradeStop>;
}

/**
 * SHIP HELPER - a carrier seated on a pinned ship helps its trader by hand. Our own addition (owner's
 * choice), not original behavior: the original has no sea trader to help. It works only a crossing route
 * between the player's own houses, on the shore of the trader's current stop while the ship lies moored
 * there, one unit a trip: `load` carries a unit from the house the land rule names to the ship's door,
 * `unload` lifts a unit at the door and carries it to the stop's house. A trip books its unit on the
 * ship's line as it sets out (`CargoRun`), so the trader and the other helpers see it, and a booking is
 * re-decided at every plan. A unit in hand finishes its trip whatever became of the route, so nothing
 * rides aboard in the hands. Everyone else, and a helper with no work, is left to the rungs below, which
 * stand it by the door.
 */
export function planShipHelper(
  plan: PlannerContext,
  load: { goodType: number; amount: number } | undefined,
): boolean {
  const { world, ctx, entity: e } = plan;
  const ship = world.tryGet(e, Rider)?.vehicle;
  if (ship === undefined) return false;
  const trader = pinnedTraderOf(world, ship);
  if (trader === null || trader === e || !isCarrierJob(ctx, plan.jobType)) return false;
  if (load !== undefined && load.amount > 0) return finishTrip(plan, trader, ship, load);
  abandonCargoRun(world, e);
  const shift = helperShift(plan, trader, ship);
  return shift !== null && setOut(plan, trader, ship, shift);
}

/** The stop `trader` has its helpers work on the planned settler's shore, or null: the trader is aboard,
 *  the route is broken, foreign or does not cross the sea, or the ship or the stop lies elsewhere. */
function helperShift(plan: PlannerContext, trader: Entity, ship: Entity): HelperShift | null {
  const { world, ctx, terrain, here } = plan;
  if (world.has(trader, Rider) || !world.has(trader, TradeRoute)) return null;
  if (!routeStandsFinished(world, trader) || !routeCrossesSea(world, ctx, terrain, trader)) return null;
  const route = world.get(trader, TradeRoute);
  const stop = route.stops[route.current];
  const other = route.stops[1 - route.current];
  if (stop === undefined || other === undefined) return null;
  if (isForeignHouse(world, trader, stop.house) || isForeignHouse(world, trader, other.house)) return null;
  const continent = terrain.componentOf(here);
  if (stopContinent(world, ctx, terrain, stop) !== continent) return null;
  return shipLiesOn(world, ctx, terrain, ship, continent) ? { stop, other } : null;
}

/** Whether a walk to `cell` failed lately. */
function failedToReach(plan: PlannerContext, cell: NodeId): boolean {
  return isUnreachableGoal(unreachableGoals(plan.world, plan.ctx, plan.entity), cell);
}

/** Set out on the unit the land rule asks for, as the trader's hold reads with what is under way. Only
 *  goods aboard the ship count: what lies in the trader's cart is the trader's to move. */
function setOut(plan: PlannerContext, trader: Entity, ship: Entity, shift: HelperShift): boolean {
  const { world, ctx } = plan;
  const hold = ferryHoldOf(world, ctx, traderHoldOf(world, ctx, trader), ship);
  if (hold === null) return false;
  const entries = hold.entries.filter(([good]) => hold.liftable(good) > 0);
  const work = decideForHelper(plan, trader, { ...hold, entries }, shift.stop, shift.other);
  if (work.kind === 'next') return false;
  if (work.kind === 'load') return setOutToLoad(plan, hold, work.from, work.good);
  return setOutToUnload(plan, ship, work.good);
}

/** Book a unit into the ship and go lift it off `from`'s shelf. */
function setOutToLoad(plan: PlannerContext, hold: FerryHold, from: Entity, good: number): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const { ship } = hold;
  const cell = interactionCell(world, ctx, terrain, from, here);
  const type = contentIndex(ctx.content).vehicles.get(world.get(ship, Vehicle).vehicleType);
  const line = type && vehicleStockGood(ctx.content, type, edibleGoodFormOf(ctx.content, good));
  if (line === undefined || line === null || failedToReach(plan, cell)) return false;
  if (modifyVehicleReserved(world, ship, ctx.content, line, HELPER_UNIT) !== HELPER_UNIT) return false;
  world.add(e, CargoRun, { vehicle: ship, goodType: line, direction: 'load' });
  plan.supply.stampPickupClaim(e, { source: from, goodType: good, amount: HELPER_UNIT });
  atOrWalk(world, e, here, cell, () => startPickup(world, ctx, e, plan, from, good, HELPER_UNIT));
  return true;
}

/** Book a unit out of the ship and go lift it at the door. */
function setOutToUnload(plan: PlannerContext, ship: Entity, good: number): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const door = boardingNode(world, ctx, terrain, ship);
  if (door === null || failedToReach(plan, door)) return false;
  if (modifyVehicleReserved(world, ship, ctx.content, good, -HELPER_UNIT) !== -HELPER_UNIT) return false;
  world.add(e, CargoRun, { vehicle: ship, goodType: good, direction: 'unload' });
  atOrWalk(world, e, here, door, () =>
    startAtomic(
      world,
      e,
      PICKUP_ATOMIC_ID,
      { kind: 'tradeShipFetch', vehicle: ship, goodType: good },
      atomicDuration(ctx.content, plan, PICKUP_ATOMIC_ID),
      ship,
    ),
  );
  return true;
}

/**
 * The trip a unit in hand is on: a booked unit goes to the ship's door, any other to an own stop on this
 * shore, and one neither takes to the nearest storehouse or the ground, as a cargo hand places a refused
 * load. False with no moored ship to anchor that search: the delivery rung takes the unit.
 */
function finishTrip(
  plan: PlannerContext,
  trader: Entity,
  ship: Entity,
  load: { goodType: number; amount: number },
): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const moored = world.get(ship, Vehicle).moored;
  const door = moored ? boardingNode(world, ctx, terrain, ship) : null;
  const onShore = door !== null && terrain.componentOf(door) === terrain.componentOf(here);
  if (onShore && world.tryGet(e, CargoRun)?.direction === 'load' && !failedToReach(plan, door)) {
    atOrWalk(world, e, here, door, () =>
      startAtomic(
        world,
        e,
        PILEUP_ATOMIC_ID,
        { kind: 'tradeShipStow', vehicle: ship, goodType: load.goodType },
        atomicDuration(ctx.content, plan, PILEUP_ATOMIC_ID),
        ship,
      ),
    );
    return true;
  }
  abandonCargoRun(world, e);
  const store = stopTaking(plan, trader, load.goodType);
  if (store !== null) {
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, store, here), () =>
      startAtomic(
        world,
        e,
        PILEUP_ATOMIC_ID,
        { kind: 'pileup', store },
        atomicDuration(ctx.content, plan, PILEUP_ATOMIC_ID),
        store,
      ),
    );
    return true;
  }
  return onShore && placeRefusedLoad(plan, door, load);
}

/** The route's own house on the planned settler's shore that has room for `good` and can be reached. */
function stopTaking(plan: PlannerContext, trader: Entity, good: number): Entity | null {
  const { world, ctx, terrain, here } = plan;
  const continent = terrain.componentOf(here);
  for (const stop of world.tryGet(trader, TradeRoute)?.stops ?? []) {
    if (!world.isAlive(stop.house) || isForeignHouse(world, trader, stop.house)) continue;
    if (stopContinent(world, ctx, terrain, stop) !== continent) continue;
    const slot = storableFormAt(world, ctx, stop.house, good);
    if (slot === undefined || roomFor(world, ctx, stop.house, slot) <= 0) continue;
    if (!failedToReach(plan, interactionCell(world, ctx, terrain, stop.house, here))) return stop.house;
  }
  return null;
}
