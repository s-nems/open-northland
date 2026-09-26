import type { VehicleType } from '@open-northland/data';
import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { num, type SnapshotEntity, settlerJobType } from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { type Comp, goodLabel, isCarrierJob, type UnitPanelModelContext } from './context.js';
import type { SeatControl, SettlerRole } from './settler-household.js';
import { readStockLines, vehicleTitle } from './vehicle.js';

/** The vehicle a person rides or walks to board. */
export interface SettlerVehicleLink {
  readonly id: number;
  readonly label: string;
  /** The hold for the link's tooltip: "Wóz ręczny: 3 drewno, 2 żelazo", or the name alone without one. */
  readonly load: string;
}

/** The Pojazd row: the vehicle as a link, or the pick that assigns one. */
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

function holdLine(
  ctx: UnitPanelModelContext,
  ent: SnapshotEntity,
  type: VehicleType | undefined,
  title: string,
): string {
  if (type === undefined || type.stockSlots === 0) return title;
  const copy = messages().hud.settlerPanel;
  const goods: string[] = [];
  for (const line of readStockLines(ent.components.VehicleStock).values()) {
    if (line.current > 0) {
      goods.push(
        formatMessage(copy.vehicleLoadGood, { amount: line.current, good: goodLabel(ctx, line.good) }),
      );
    }
  }
  return formatMessage(copy.vehicleLoad, {
    vehicle: title,
    goods: goods.length === 0 ? copy.vehicleEmpty : goods.join(', '),
  });
}

/** The Pojazd row of an own grown person of a vehicle trade, else null. `Rider` names the vehicle from
 *  the attach on, while the person still walks to its door. */
export function vehicleRow(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
  role: SettlerRole,
  control: SeatControl,
): SettlerVehicleRow | null {
  const jobType = settlerJobType(ent);
  if (role === 'child' || jobType === undefined || !takesVehicle(ctx, jobType)) return null;
  const riding = num((ent.components.Rider as { vehicle?: unknown } | undefined)?.vehicle);
  const vehicle = riding === undefined ? undefined : entityById(snapshot, riding);
  const typeId = num((vehicle?.components.Vehicle as Comp | undefined)?.vehicleType);
  const type = typeId === undefined ? undefined : ctx.vehicles.find((v) => v.typeId === typeId);
  const label = vehicleTitle(ctx, typeId);
  return {
    target:
      vehicle === undefined ? null : { id: vehicle.id, label, load: holdLine(ctx, vehicle, type, label) },
    assign: control,
    remove: riding === undefined ? null : control,
  };
}
