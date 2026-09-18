import type { VehicleType } from '@open-northland/data';
import {
  Building,
  CargoRun,
  Rider,
  sameSideAs,
  Vehicle,
  VehicleStock,
  type VehicleStockLine,
  vehicleStockEntries,
} from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { DeepReadonly, Entity } from '../../../../ecs/world.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { manhattan } from '../../../spatial/metric.js';
import { isCarrierJob, isLoosePile } from '../../../stores/index.js';
import { abandonCargoRun } from '../../../vehicles/cargo.js';
import { boardingNode, isShipAtSea } from '../../../vehicles/crew.js';
import {
  modifyVehicleReserved,
  vehicleIsFull,
  vehicleIsFullSoon,
  vehicleStockGood,
} from '../../../vehicles/stock.js';
import {
  atOrWalk,
  PICKUP_ATOMIC_ID,
  PILEUP_ATOMIC_ID,
  startAtomic,
  startPickup,
} from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import { interactionCell, QUALIFIES } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';

/**
 * How far from the vehicle's door the original's carrier looks for loose goods and houses before it asks
 * the guide network (`FindGoodsDemandedForVehicle`, `SearchOverMap` radius 0x28), in nodes.
 */
export const VEHICLE_CARGO_SEARCH_RADIUS = 40;

/** One unit per trip: the original's carrier fetches, brings and flushes a single unit at a time. */
const CARGO_UNIT = 1;

/**
 * VEHICLE CARGO - a carrier attached to a cart or moored ship serves its hold (docs/formats/VEHICLES.md
 * "Cargo", which also names the approximations): while a good's wanted amount exceeds its booking it
 * fetches a unit, loose goods within {@link VEHICLE_CARGO_SEARCH_RADIUS} of the door first, then a house
 * within it, then whatever its signpost area reaches, every source on the door's continent; with a unit
 * on its back it books it and sets it into the hold at the door; while a good's booking exceeds its
 * wanted amount it walks the booking down a unit a trip, lifting a unit out when one is aboard. A rider
 * the vehicle asked aboard, one standing on another continent than the door, and a load the hold will
 * not take fall through to the other rungs, any booking they hold given back first.
 */
export function planVehicleCargo(
  plan: PlannerContext,
  load: { goodType: number; amount: number } | undefined,
): boolean {
  const { world, entity: e } = plan;
  const rider = world.tryGet(e, Rider);
  if (rider === undefined) return false;
  const vehicle = rider.vehicle;
  const loaded = load !== undefined && load.amount > 0;
  // A booking that no longer matches the carrier's hands or vehicle, or that the rung will not finish
  // this turn, is given back before anything else decides for the rider.
  const run = world.tryGet(e, CargoRun);
  if (run !== undefined && (run.vehicle !== vehicle || (run.direction === 'load') !== loaded)) {
    abandonCargoRun(world, e);
  }
  const served = servedHold(plan, rider.boarding, vehicle);
  if (served === null) {
    abandonCargoRun(world, e);
    return false;
  }
  if (loaded) return bringLoad(plan, vehicle, served.type, served.door, load);
  return fetchShortfall(plan, vehicle, served.type, served.door) || flushSurplus(plan, vehicle, served.door);
}

/** The hold this carrier serves right now: its type and boarding node, or null while the vehicle asks
 *  the rider aboard, lies at sea, has no door, or stands on another continent than the carrier. */
function servedHold(
  plan: PlannerContext,
  boarding: boolean,
  vehicle: Entity,
): { readonly type: VehicleType; readonly door: NodeId } | null {
  const { world, ctx, terrain, here } = plan;
  if (boarding || !isCarrierJob(ctx, plan.jobType)) return null;
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined || !world.has(vehicle, VehicleStock) || isShipAtSea(ctx, state)) return null;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return null;
  const door = boardingNode(world, ctx, terrain, vehicle);
  if (door === null || terrain.componentOf(door) !== terrain.componentOf(here)) return null;
  return { type, door };
}

/** The carrier holds a unit: set it into the hold under its booking, booking it first when the hold
 *  still wants it. False for a unit the hold will not take, which the delivery rung then places. */
function bringLoad(
  plan: PlannerContext,
  vehicle: Entity,
  type: VehicleType,
  door: NodeId,
  load: { goodType: number; amount: number },
): boolean {
  const { world, ctx, entity: e, here } = plan;
  const good = vehicleStockGood(ctx.content, type, load.goodType);
  if (good === null) return false;
  const run = world.tryGet(e, CargoRun);
  if (run !== undefined && run.goodType !== good) abandonCargoRun(world, e);
  if (world.tryGet(e, CargoRun) === undefined) {
    const stock = world.get(vehicle, VehicleStock);
    const line = stock.lines.get(good);
    if (line === undefined || line.wanted <= line.reserved || vehicleIsFullSoon(type, stock)) return false;
    if (modifyVehicleReserved(world, vehicle, ctx.content, good, CARGO_UNIT) !== CARGO_UNIT) return false;
    world.add(e, CargoRun, { vehicle, goodType: good, direction: 'load' });
  }
  atOrWalk(world, e, here, door, () =>
    startAtomic(
      world,
      e,
      PILEUP_ATOMIC_ID,
      { kind: 'vehicleLoad', vehicle },
      atomicDuration(ctx.content, plan, PILEUP_ATOMIC_ID),
      vehicle,
    ),
  );
  return true;
}

/** One `vehicleStockEntries` pair: the canonical good and its line. */
type HoldLine = readonly [number, DeepReadonly<VehicleStockLine>];

/** The goods the hold asks more of than it has booked, ascending by good. */
function shortfallGoods(stock: DeepReadonly<{ lines: Map<number, VehicleStockLine> }>): number[] {
  return vehicleStockEntries(stock).flatMap(([good, line]: HoldLine) =>
    line.wanted > line.reserved ? [good] : [],
  );
}

/**
 * Fetch one unit of a good the hold is short of, from the nearest source the three-phase search finds.
 * Nothing is booked yet: the booking is made when the unit is on the carrier's back, as the original's
 * carrier does.
 */
function fetchShortfall(plan: PlannerContext, vehicle: Entity, type: VehicleType, door: NodeId): boolean {
  const { world, ctx, entity: e, here } = plan;
  const stock = world.get(vehicle, VehicleStock);
  if (vehicleIsFull(type, stock)) return false;
  const goods = shortfallGoods(stock);
  if (goods.length === 0) return false;
  const source = nearestCargoSource(plan, goods, door);
  if (source === null) return false;
  atOrWalk(world, e, here, interactionCell(world, ctx, plan.terrain, source.entity, here), () =>
    startPickup(world, ctx, e, plan, source.entity, source.goodType, CARGO_UNIT),
  );
  return true;
}

interface CargoSource {
  readonly entity: Entity;
  readonly goodType: number;
}

/**
 * The nearest store holding any of `goods`: a loose pile within the search radius of the door, else a
 * house within it, both ranked from the door, else any store within the carrier's signpost area ranked
 * from where it stands. Ties fall to the lower good id.
 */
function nearestCargoSource(
  plan: PlannerContext,
  goods: readonly number[],
  door: NodeId,
): CargoSource | null {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const avoid = unreachableGoalVeto(world, ctx, e);
  const gate = plan.limit ?? undefined;
  const onSide = sameSideAs(world, plan.owner);
  // The original's search is a pathfinder flood from the door, so only the door's continent yields.
  const continent = terrain.componentOf(door);
  const reachable = (e2: Entity): boolean =>
    terrain.componentOf(interactionCell(world, ctx, terrain, e2, door)) === continent;
  const nearDoor = (e2: Entity): boolean =>
    manhattan(terrain, door, interactionCell(world, ctx, terrain, e2, door)) <= VEHICLE_CARGO_SEARCH_RADIUS;
  const phases: ReadonlyArray<{ origin: NodeId; accept: (e2: Entity) => boolean }> = [
    { origin: door, accept: (e2) => isLoosePile(world, e2) && reachable(e2) && nearDoor(e2) },
    { origin: door, accept: (e2) => world.has(e2, Building) && reachable(e2) && nearDoor(e2) },
    { origin: here, accept: reachable },
  ];
  for (const phase of phases) {
    let best: (CargoSource & { readonly distance: number }) | null = null;
    for (const goodType of goods) {
      const hit = targets.bands
        .holding(goodType)
        .nearest(phase.origin, (e2) => (phase.accept(e2) ? QUALIFIES : null), gate, avoid, onSide);
      if (hit !== null && (best === null || hit.distance < best.distance)) {
        best = { entity: hit.entity, goodType, distance: hit.distance };
      }
    }
    if (best !== null) return { entity: best.entity, goodType: best.goodType };
  }
  return null;
}

/** Walk the first good booked beyond its wanted amount down by a unit: the booking drops as the carrier
 *  sets out (`l_StartTask_ExecuteJob_Carrier_FlushVehicle`) and the door lifts a unit out when one is
 *  aboard, so a stale booking heals a trip at a time even with nothing to carry. */
function flushSurplus(plan: PlannerContext, vehicle: Entity, door: NodeId): boolean {
  const { world, ctx, entity: e, here } = plan;
  const stock = world.get(vehicle, VehicleStock);
  let run = world.tryGet(e, CargoRun);
  if (run === undefined) {
    const surplus = vehicleStockEntries(stock).find(([, line]: HoldLine) => line.wanted < line.reserved);
    if (surplus === undefined) return false;
    const goodType = surplus[0];
    if (modifyVehicleReserved(world, vehicle, ctx.content, goodType, -CARGO_UNIT) !== -CARGO_UNIT)
      return false;
    world.add(e, CargoRun, { vehicle, goodType, direction: 'unload' });
    run = world.get(e, CargoRun);
  }
  const goodType = run.goodType;
  atOrWalk(world, e, here, door, () =>
    startAtomic(
      world,
      e,
      PICKUP_ATOMIC_ID,
      { kind: 'vehicleUnload', vehicle, goodType },
      atomicDuration(ctx.content, plan, PICKUP_ATOMIC_ID),
      vehicle,
    ),
  );
  return true;
}
