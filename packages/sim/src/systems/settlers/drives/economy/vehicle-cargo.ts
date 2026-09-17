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
import { boardingNode } from '../../../vehicles/boarding.js';
import { abandonCargoRun } from '../../../vehicles/cargo.js';
import { isShipAtSea } from '../../../vehicles/crew.js';
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
 * "Cargo"): while a good's wanted amount exceeds its booking it fetches a unit, loose goods within
 * {@link VEHICLE_CARGO_SEARCH_RADIUS} of the door first, then a house within it, then whatever its signpost
 * area reaches; with a unit on its back it books it and sets it into the hold at the door; while a good's
 * booking exceeds its wanted amount it lifts a unit out. A rider the vehicle asked aboard, one standing on
 * another continent than the door, and a load the hold will not take fall through to the other rungs.
 *
 * Named approximations: the original picks at random among the sources it found, here the nearest wins
 * (ties by good id); the guide network is the carrier's signpost confinement; a lifted-out unit goes
 * wherever the delivery ladder sends an unbound settler's load, the ground at the door when nothing takes
 * it; a house source holds the hold's canonical good, never a dish it would alias; a flush waits for a
 * unit to be aboard, where the original walks over and finds none.
 */
export function planVehicleCargo(
  plan: PlannerContext,
  load: { goodType: number; amount: number } | undefined,
): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const rider = world.tryGet(e, Rider);
  if (rider === undefined || rider.boarding || !isCarrierJob(ctx, plan.jobType)) return false;
  const vehicle = rider.vehicle;
  const state = world.tryGet(vehicle, Vehicle);
  const stock = world.tryGet(vehicle, VehicleStock);
  if (state === undefined || stock === undefined || isShipAtSea(ctx, state)) return false;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return false;
  const door = boardingNode(world, ctx, terrain, vehicle);
  if (door === null || terrain.componentOf(door) !== terrain.componentOf(here)) return false;

  const loaded = load !== undefined && load.amount > 0;
  // A booking that no longer matches the carrier's hands or vehicle is spent before deciding afresh.
  const run = world.tryGet(e, CargoRun);
  if (run !== undefined && (run.vehicle !== vehicle || (run.direction === 'load') !== loaded)) {
    abandonCargoRun(world, e);
  }
  if (loaded) return bringLoad(plan, vehicle, type, door, load);
  return fetchShortfall(plan, vehicle, type, door) || flushSurplus(plan, vehicle, door);
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

/** A good's line and the unit budget it is judged against. */
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
 * carrier does, so two carriers may fetch for one slot and the second brings its unit elsewhere.
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
  const nearDoor = (e2: Entity): boolean =>
    manhattan(terrain, door, interactionCell(world, ctx, terrain, e2, door)) <= VEHICLE_CARGO_SEARCH_RADIUS;
  const phases: ReadonlyArray<{ origin: NodeId; accept: (e2: Entity) => boolean }> = [
    { origin: door, accept: (e2) => isLoosePile(world, e2) && nearDoor(e2) },
    { origin: door, accept: (e2) => world.has(e2, Building) && nearDoor(e2) },
    { origin: here, accept: () => true },
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

/** Lift one unit of the first good the hold has booked beyond its wanted amount, dropping the booking as
 *  the carrier sets out (`l_StartTask_ExecuteJob_Carrier_FlushVehicle`). */
function flushSurplus(plan: PlannerContext, vehicle: Entity, door: NodeId): boolean {
  const { world, ctx, entity: e, here } = plan;
  const stock = world.get(vehicle, VehicleStock);
  let run = world.tryGet(e, CargoRun);
  if (run === undefined) {
    const surplus = vehicleStockEntries(stock).find(
      ([, line]: HoldLine) => line.wanted < line.reserved && line.current > 0,
    );
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
