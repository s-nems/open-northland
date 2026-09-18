import {
  Health,
  MissionObjectId,
  Owner,
  Vehicle,
  type VehicleAttackTarget,
  VehicleDrive,
  type VehicleSeat,
  type VehicleStance,
  VehicleStock,
  type VehicleTask,
  vehicleCommander,
  vehicleLoad,
  vehiclePassengers,
  vehicleStockEntries,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import type { MapContext } from '../context.js';
import { vehicleAnchor, vehicleDoorPoint } from '../footprint/index.js';
import { vehicleIndex } from './registry.js';

export interface VehicleStockView {
  readonly good: number;
  readonly current: number;
  readonly wanted: number;
  readonly reserved: number;
}

/** One vehicle as the selection window and the renderer read it: a detached copy. */
export interface VehicleView {
  readonly entity: Entity;
  readonly vehicleType: number;
  readonly tribe: number;
  readonly owner: number | null;
  readonly missionId: number | null;
  readonly task: VehicleTask;
  readonly facing: number;
  readonly hitpoints: number;
  readonly maxHitpoints: number;
  readonly moored: boolean;
  readonly mooring: HalfCellNode | null;
  readonly harnessed: boolean;
  readonly carrier: Entity | null;
  readonly at: HalfCellNode | null;
  readonly door: HalfCellNode | null;
  /** The node the drive is headed to; null while the vehicle stands. */
  readonly goal: HalfCellNode | null;
  /** The leg under way: the node it left and the progress toward `at` out of `NODE_PROGRESS_FULL`, the
   *  renderer's interpolation; null between legs and while standing. */
  readonly leg: { readonly from: HalfCellNode; readonly progress: number } | null;
  readonly commander: Entity | null;
  readonly stance: VehicleStance;
  /** What an armed vehicle is aimed at, ordered or auto-acquired; null while it has nothing. */
  readonly attackTarget: VehicleAttackTarget | null;
  /** Occupied seats in slot order, the commander last. */
  readonly passengers: readonly VehicleSeat[];
  /** Ordinary slots plus the commander's. */
  readonly passengerCapacity: number;
  readonly vehicles: readonly VehicleSeat[];
  readonly vehicleCapacity: number;
  /** Ascending by good, empty lines dropped. */
  readonly stock: readonly VehicleStockView[];
  readonly load: number;
  readonly stockSlots: number;
}

/** The vehicle `e`, or undefined for anything else. */
export function vehicleView(world: World, ctx: MapContext, e: Entity): VehicleView | undefined {
  const vehicle = world.tryGet(e, Vehicle);
  if (vehicle === undefined) return undefined;
  const type = contentIndex(ctx.content).vehicles.get(vehicle.vehicleType);
  const anchor = vehicleAnchor(world, e);
  const health = world.tryGet(e, Health);
  const stock = world.tryGet(e, VehicleStock);
  const lines = stock === undefined ? [] : vehicleStockEntries(stock);
  const drive = world.tryGet(e, VehicleDrive);
  return {
    entity: e,
    vehicleType: vehicle.vehicleType,
    tribe: vehicle.tribe,
    owner: world.tryGet(e, Owner)?.player ?? null,
    missionId: world.tryGet(e, MissionObjectId)?.id ?? null,
    task: vehicle.task,
    facing: vehicle.facing,
    hitpoints: health?.hitpoints ?? 0,
    maxHitpoints: health?.max ?? 0,
    moored: vehicle.moored,
    mooring: vehicle.mooring === null ? null : { hx: vehicle.mooring.hx, hy: vehicle.mooring.hy },
    harnessed: vehicle.harnessed,
    carrier: vehicle.carrier,
    at: anchor,
    door: type !== undefined && anchor !== null ? vehicleDoorPoint(vehicle, type, anchor, ctx.terrain) : null,
    goal: drive === undefined ? null : { hx: drive.goal.hx, hy: drive.goal.hy },
    leg:
      drive === undefined || drive.from === null
        ? null
        : { from: { hx: drive.from.hx, hy: drive.from.hy }, progress: drive.progress },
    commander: vehicleCommander(vehicle),
    stance: vehicle.stance,
    attackTarget: vehicle.attack === null ? null : { ...vehicle.attack.target },
    passengers: vehiclePassengers(vehicle).map((seat) => ({ entity: seat.entity, inside: seat.inside })),
    passengerCapacity: vehicle.passengers.length,
    vehicles: vehicle.vehicles.flatMap((seat) =>
      seat === null ? [] : [{ entity: seat.entity, inside: seat.inside }],
    ),
    vehicleCapacity: vehicle.vehicles.length,
    stock: lines.flatMap(([good, line]) =>
      line.current > 0 || line.wanted > 0 || line.reserved > 0
        ? [{ good, current: line.current, wanted: line.wanted, reserved: line.reserved }]
        : [],
    ),
    load: stock === undefined ? 0 : vehicleLoad(stock),
    stockSlots: type?.stockSlots ?? 0,
  };
}

/** The vehicles `player` owns, ascending by entity id. */
export function vehiclesOf(world: World, ctx: MapContext, player: number): VehicleView[] {
  return vehicleIndex(world)
    .ownedBy(player)
    .flatMap((e) => {
      const view = vehicleView(world, ctx, e);
      return view === undefined ? [] : [view];
    });
}
