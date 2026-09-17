import type { VehicleType } from '@open-northland/data';
import { type components, entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { isVehicle, num, ownerPlayerOf, type SnapshotEntity } from '../../../game/snapshot.js';
import { vehicleLabel } from '../../../game/technology.js';
import { formatMessage, messages, tribeName } from '../../../i18n/index.js';
import { goodCategoryTab } from '../../good-categories.js';
import { healthBar, type PanelBar } from './bars.js';
import { type Comp, goodDef, goodLabel, type UnitPanelModelContext } from './context.js';
import { settlerDisplayName } from './settler-name.js';

/**
 * `vehiclewindow` string ids resolved at draw time from `content/gui/strings/<lang>.json`, the original
 * vehicle window's own table.
 */
export const VEHICLEWINDOW = {
  vehicle: 0, // 'Wehikuł'
  general: 1, // 'Ogólne'
  people: 3, // 'Mieszkańcy'
  cargo: 5, // 'Magazyn'
  unloadGoods: 19, // 'Rozładuj towary'
  moor: 21, // 'Zacumuj'
  assignToShip: 24, // 'Przydziel do statku'
  removeFromShip: 25, // 'Usuń ze statku'
} as const;

/** `misclogic` ids of the vehicle orders the original's ring names. */
export const VEHICLE_ORDER_STRING = {
  goTo: 142,
  unloadPeople: 143,
  dock: 144,
  attackInhabitants: 145,
  attackBuilding: 146,
  attackVehicle: 147,
  attackPosition: 148,
  attackMode: 149,
  defenceMode: 150,
} as const;

/** The orders the vehicle window's buttons issue. */
export type VehicleOrder =
  | 'goTo'
  | 'dock'
  | 'unloadPeople'
  | 'stop'
  | 'attackInhabitants'
  | 'attackBuilding'
  | 'attackVehicle'
  | 'attackPosition'
  | 'stanceAttack'
  | 'stanceDefence'
  | 'stanceHold'
  | 'loadIntoShip'
  | 'leaveShip'
  | 'unloadGoods';

export type VehicleTask = components.VehicleTask;
export type VehicleStance = components.VehicleStance;

export interface VehicleOrderModel {
  readonly order: VehicleOrder;
  readonly enabled: boolean;
  /** The stance the vehicle is already in draws lit, the way the soldier ring marks its mode. */
  readonly active: boolean;
}

export interface VehicleCrewRow {
  readonly entity: number;
  readonly label: string;
  readonly role: 'commander' | 'passenger' | 'vehicle';
  /** Aboard, rather than still walking to the door. */
  readonly inside: boolean;
}

/** One good the hold may carry: its live counts, or zeros for a good nobody asked for yet. */
export interface VehicleCargoRow {
  readonly goodType: number;
  readonly goodId?: string;
  readonly label: string;
  readonly category: number;
  readonly current: number;
  readonly wanted: number;
  readonly reserved: number;
  /** `visibleStockRows` sorts a category tab's rows by this: a line the player touched leads. */
  readonly amount: number;
}

export interface VehiclePanelModel {
  readonly kind: 'vehicle';
  readonly entityId: number;
  readonly typeId: number;
  readonly title: string;
  readonly meta: string;
  readonly task: VehicleTask;
  readonly taskLabel: string;
  readonly health: PanelBar | null;
  /** Null for a vehicle without a hold (the catapult). */
  readonly capacityLabel: string | null;
  readonly stance: VehicleStance | null;
  readonly stanceLabel: string | null;
  /** The ship carrying this vehicle, named; null while it stands on the map. */
  readonly carrierLabel: string | null;
  readonly crew: readonly VehicleCrewRow[];
  readonly crewCount: number;
  readonly crewCapacity: number;
  readonly orders: readonly VehicleOrderModel[];
  /** Every good the hold may carry, the live lines first; empty without a hold. The stock tabs
   *  filter it: "Wszystkie" lists the lines with anything aboard, wanted or booked. */
  readonly cargo: readonly VehicleCargoRow[];
}

interface SeatSnapshot {
  readonly entity: number;
  readonly inside: boolean;
}

/** A `Vehicle.passengers` / `vehicles` slot as the snapshot clones it: `{ entity, inside }` or null. */
function readSeats(value: unknown): SeatSnapshot[] {
  if (!Array.isArray(value)) return [];
  const seats: SeatSnapshot[] = [];
  for (const seat of value) {
    const entity = num((seat as { entity?: unknown } | null)?.entity);
    if (entity === undefined) continue;
    seats.push({ entity, inside: (seat as { inside?: unknown }).inside === true });
  }
  return seats;
}

interface StockLineSnapshot {
  readonly good: number;
  readonly current: number;
  readonly wanted: number;
  readonly reserved: number;
}

/** `VehicleStock.lines` as the snapshot clones the map: `[goodType, { current, wanted, reserved }]`. */
function readStockLines(value: unknown): Map<number, StockLineSnapshot> {
  const lines = new Map<number, StockLineSnapshot>();
  const raw = (value as { lines?: unknown } | undefined)?.lines;
  if (!Array.isArray(raw)) return lines;
  for (const pair of raw) {
    if (!Array.isArray(pair)) continue;
    const good = num(pair[0]);
    const line = pair[1] as { current?: unknown; wanted?: unknown; reserved?: unknown } | undefined;
    if (good === undefined || line === undefined) continue;
    lines.set(good, {
      good,
      current: num(line.current) ?? 0,
      wanted: num(line.wanted) ?? 0,
      reserved: num(line.reserved) ?? 0,
    });
  }
  return lines;
}

function taskOf(value: unknown): VehicleTask {
  const tasks: Readonly<Record<string, string | undefined>> = messages().hud.vehicleTasks;
  return typeof value === 'string' && tasks[value] !== undefined ? (value as VehicleTask) : 'none';
}

function stanceOf(value: unknown): VehicleStance {
  const stances: Readonly<Record<string, string | undefined>> = messages().hud.vehicleStances;
  return typeof value === 'string' && stances[value] !== undefined ? (value as VehicleStance) : 'hold';
}

function vehicleTypeOf(ctx: UnitPanelModelContext, typeId: number | undefined): VehicleType | undefined {
  return typeId === undefined ? undefined : ctx.vehicles.find((v) => v.typeId === typeId);
}

/** The type name the window titles a vehicle by, the content's own name when the catalog lacks one. */
export function vehicleTitle(ctx: UnitPanelModelContext, typeId: number | undefined): string {
  if (typeId === undefined) return messages().hud.vehicle;
  return vehicleLabel({ vehicles: ctx.vehicles }, typeId) ?? messages().hud.vehicle;
}

/**
 * Which orders the window offers: every vehicle drives and stops; a ship moors and lands its crew; a
 * siege engine takes the attack orders and stances; a hold-less vehicle has no goods to unload. The
 * carrier pair follows the vehicle's own state: only a land vehicle boards a ship, and only a carried
 * one leaves it. Named approximation: the original's window and ring are not read button by button.
 */
function orderRows(
  type: VehicleType | undefined,
  stance: VehicleStance,
  carried: boolean,
  crewed: boolean,
): VehicleOrderModel[] {
  const ship = type !== undefined && systems.isShipVehicle(type);
  const siege = type !== undefined && systems.isSiegeVehicle(type);
  const hold = type !== undefined && type.stockSlots > 0;
  const rows: VehicleOrderModel[] = [
    { order: 'goTo', enabled: crewed && !carried, active: false },
    { order: 'stop', enabled: !carried, active: false },
  ];
  if (ship) {
    rows.push({ order: 'dock', enabled: crewed, active: false });
    rows.push({ order: 'unloadPeople', enabled: true, active: false });
  } else {
    rows.push({ order: 'unloadPeople', enabled: !carried, active: false });
    rows.push({ order: carried ? 'leaveShip' : 'loadIntoShip', enabled: true, active: false });
  }
  if (siege) {
    rows.push(
      { order: 'attackInhabitants', enabled: crewed && !carried, active: false },
      { order: 'attackBuilding', enabled: crewed && !carried, active: false },
      { order: 'attackVehicle', enabled: crewed && !carried, active: false },
      { order: 'attackPosition', enabled: crewed && !carried, active: false },
      { order: 'stanceAttack', enabled: true, active: stance === 'attack' },
      { order: 'stanceDefence', enabled: true, active: stance === 'defence' },
      { order: 'stanceHold', enabled: true, active: stance === 'hold' },
    );
  }
  if (hold) rows.push({ order: 'unloadGoods', enabled: true, active: false });
  return rows;
}

function crewRows(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  passengers: readonly SeatSnapshot[],
  vehicles: readonly SeatSnapshot[],
  commander: number | undefined,
): VehicleCrewRow[] {
  const rows: VehicleCrewRow[] = [];
  const rider = (seat: SeatSnapshot, role: 'commander' | 'passenger'): void => {
    const e = entityById(snapshot, seat.entity);
    const label = e === undefined ? `#${seat.entity}` : settlerDisplayName(ctx, snapshot, e);
    rows.push({ entity: seat.entity, label, role, inside: seat.inside });
  };
  // The commander leads the list whatever slot it holds; the ordinary seats follow in slot order.
  const lead = passengers.find((seat) => seat.entity === commander);
  if (lead !== undefined) rider(lead, 'commander');
  for (const seat of passengers) if (seat.entity !== commander) rider(seat, 'passenger');
  for (const seat of vehicles) {
    const e = entityById(snapshot, seat.entity);
    const typeId = e === undefined ? undefined : num((e.components.Vehicle as Comp | undefined)?.vehicleType);
    rows.push({
      entity: seat.entity,
      label: vehicleTitle(ctx, typeId),
      role: 'vehicle',
      inside: seat.inside,
    });
  }
  return rows;
}

function cargoRows(
  ctx: UnitPanelModelContext,
  type: VehicleType | undefined,
  lines: ReadonlyMap<number, StockLineSnapshot>,
): VehicleCargoRow[] {
  if (type === undefined || type.stockSlots === 0) return [];
  const rows: VehicleCargoRow[] = [];
  const listed = new Set<number>();
  const push = (goodType: number, line: StockLineSnapshot | undefined): void => {
    if (listed.has(goodType) || ctx.livestockTribeOfGood?.(goodType) != null) return;
    listed.add(goodType);
    const def = goodDef(ctx, goodType);
    const current = line?.current ?? 0;
    const wanted = line?.wanted ?? 0;
    const reserved = line?.reserved ?? 0;
    rows.push({
      goodType,
      ...(def?.id !== undefined ? { goodId: def.id } : {}),
      label: goodLabel(ctx, goodType),
      category: goodCategoryTab(def?.id),
      current,
      wanted,
      reserved,
      amount: Math.max(current, wanted, reserved),
    });
  };
  // A hold's live lines may name a good outside the type's list (a scripted stow); they lead so the
  // window never hides cargo that is aboard.
  for (const line of [...lines.values()].sort((a, b) => a.good - b.good)) push(line.good, line);
  for (const goodType of type.cargoGoods) push(goodType, lines.get(goodType));
  return rows;
}

/** The commander's slot is the last passenger slot; a free slot there reads as no commander. */
function commanderOf(passengerSlots: unknown): number | undefined {
  if (!Array.isArray(passengerSlots) || passengerSlots.length === 0) return undefined;
  return num((passengerSlots[passengerSlots.length - 1] as { entity?: unknown } | null)?.entity);
}

export function vehiclePanelModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
): VehiclePanelModel {
  const hud = messages().hud;
  const v = (ent.components.Vehicle ?? {}) as Comp;
  const typeId = num(v.vehicleType);
  const type = vehicleTypeOf(ctx, typeId);
  const passengers = readSeats(v.passengers);
  const vehicles = readSeats(v.vehicles);
  const commander = commanderOf(v.passengers);
  const task = taskOf(v.task);
  const stance = stanceOf(v.stance);
  const siege = type !== undefined && systems.isSiegeVehicle(type);
  const carrier = num(v.carrier);
  const carrierEntity = carrier === undefined ? undefined : entityById(snapshot, carrier);
  const carrierType =
    carrierEntity === undefined || !isVehicle(carrierEntity)
      ? undefined
      : num((carrierEntity.components.Vehicle as Comp | undefined)?.vehicleType);
  const lines = readStockLines(ent.components.VehicleStock);
  let load = 0;
  for (const line of lines.values()) load += line.current;
  const tribe = num(v.tribe);
  const tribeRow = ctx.tribes.find((t) => t.typeId === tribe);
  const stanceLabel = siege ? hud.vehicleStances[stance] : null;
  const passengerCapacity = Array.isArray(v.passengers) ? v.passengers.length : 0;
  const vehicleCapacity = Array.isArray(v.vehicles) ? v.vehicles.length : 0;
  return {
    kind: 'vehicle',
    entityId: ent.id,
    typeId: typeId ?? -1,
    title: vehicleTitle(ctx, typeId),
    meta: formatMessage(hud.playerTribe, {
      player: ownerPlayerOf(ent) ?? '-',
      tribe: tribeName(tribe, tribeRow?.name ?? tribeRow?.id),
      stance: '',
    }),
    task,
    taskLabel: formatMessage(hud.vehicleTask, { task: hud.vehicleTasks[task] }),
    health: healthBar(ent),
    capacityLabel:
      type === undefined || type.stockSlots === 0
        ? null
        : formatMessage(hud.vehicleCapacity, { load, slots: type.stockSlots }),
    stance: siege ? stance : null,
    stanceLabel: stanceLabel === null ? null : formatMessage(hud.vehicleStance, { stance: stanceLabel }),
    carrierLabel:
      carrier === undefined
        ? null
        : formatMessage(hud.vehicleCarrier, { carrier: vehicleTitle(ctx, carrierType) }),
    crew: crewRows(ctx, snapshot, passengers, vehicles, commander),
    crewCount: passengers.length + vehicles.length,
    crewCapacity: passengerCapacity + vehicleCapacity,
    orders: orderRows(type, stance, carrier !== undefined, commander !== undefined),
    cargo: cargoRows(ctx, type, lines),
  };
}
