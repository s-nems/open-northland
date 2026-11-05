import type { VehicleType } from '@open-northland/data';
import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { num, ridesPinnedShip, type SnapshotEntity, settlerJobType } from '../../../game/snapshot/index.js';
import {
  type Comp,
  holdLoadLine,
  isCarrierJob,
  type UnitPanelModelContext,
  vehicleTitle,
} from './context.js';
import type { SeatControl, SettlerRole } from './settler-household.js';
import { readStockLines, withCarriedLoad } from './vehicle.js';

/** The vehicle a person rides or walks to board. */
export interface SettlerVehicleLink {
  readonly id: number;
  readonly label: string;
  /** The hold for the link's tooltip: "Handcart: 3 wood, 2 iron", or the name alone without one. */
  readonly load: string;
}

/** The Vehicle row: the vehicle as a link, or the pick that assigns one. */
export interface SettlerVehicleRow {
  /** Null offers the pick. */
  readonly target: SettlerVehicleLink | null;
  readonly assign: SeatControl;
  /** Null while the person holds no seat. */
  readonly remove: SeatControl | null;
}

/**
 * Owner's choice: only the carrier, the trader, the soldier and the hero get the row, although a vehicle
 * type's passenger list may admit other trades too. The pick still lights vehicles by the sim's attach
 * gate.
 */
function takesVehicle(ctx: UnitPanelModelContext, jobType: number): boolean {
  const job = ctx.jobs.find((j) => j.typeId === jobType);
  if (job === undefined) return false;
  return isCarrierJob(ctx, jobType) || systems.isFighterJobRow(job) || ctx.isTraderJob?.(jobType) === true;
}

/** `puller` is the person with the cart in hand: what it carries rides in the cart and counts as its load. */
function holdLine(
  ctx: UnitPanelModelContext,
  ent: SnapshotEntity,
  type: VehicleType | undefined,
  title: string,
  puller: SnapshotEntity | undefined,
): string {
  if (type === undefined || type.stockSlots === 0) return title;
  const own = readStockLines(ent.components.VehicleStock);
  const lines = puller === undefined ? own : withCarriedLoad(own, puller);
  const goods = [...lines.values()].flatMap((line) =>
    line.current > 0 ? [{ good: line.good, amount: line.current }] : [],
  );
  return holdLoadLine(ctx, title, goods);
}

/** The Vehicle row of an own grown person of a vehicle trade, else null. `Rider` names the vehicle from
 *  the attach on, while the person still walks to its door, and `HaulingCart` the cart a posted carrier
 *  or a trader pulls or walks to take. A trader aboard its pinned ship shows its cart, the ship having its
 *  own row in the Trade section, and no remove: the order would act on the ship. */
export function vehicleRow(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
  role: SettlerRole,
  control: SeatControl,
): SettlerVehicleRow | null {
  const jobType = settlerJobType(ent);
  if (role === 'child' || jobType === undefined || !takesVehicle(ctx, jobType)) return null;
  const held = ent.components.HaulingCart as { vehicle?: unknown; taken?: unknown } | undefined;
  const onRoute = ridesPinnedShip(ent.components);
  const rides = onRoute
    ? undefined
    : num((ent.components.Rider as { vehicle?: unknown } | undefined)?.vehicle);
  const riding = rides ?? num(held?.vehicle);
  const vehicle = riding === undefined ? undefined : entityById(snapshot, riding);
  const puller = held?.taken === true ? ent : undefined;
  const typeId = num((vehicle?.components.Vehicle as Comp | undefined)?.vehicleType);
  const type = typeId === undefined ? undefined : ctx.vehicles.find((v) => v.typeId === typeId);
  const label = vehicleTitle(ctx, typeId);
  return {
    target:
      vehicle === undefined
        ? null
        : { id: vehicle.id, label, load: holdLine(ctx, vehicle, type, label, puller) },
    assign: control,
    remove: riding === undefined || onRoute ? null : control,
  };
}
