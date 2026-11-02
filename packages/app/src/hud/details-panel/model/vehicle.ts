import type { VehicleType } from '@open-northland/data';
import { components, entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { settlerName } from '../../../game/character-names/index.js';
import {
  healthOf,
  isFemale,
  isVehicle,
  num,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerJobType,
  type VehicleSeatSnapshot,
  vehicleCommanderOf,
  vehicleSeatsOf,
} from '../../../game/snapshot/index.js';
import { ownedByAnotherSeat, pickableSeat } from '../../../game/viewer-seat.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { goodCategoryTab } from '../../good-categories.js';
import {
  type Comp,
  foreignOwnerLine,
  goodDef,
  goodLabel,
  isCarrierJob,
  jobDisplayName,
  type UnitPanelModelContext,
  vehicleTitle,
} from './context.js';
import type { SeatControl } from './settler-household.js';
import { type TradePanelModel, type TraderSubject, tradePanelModel } from './trade.js';

/** What the kicker names a vehicle by, and the peers its browse steps through. */
export type VehicleClass = 'cart' | 'ship' | 'siege';

/** The order buttons beside the portrait. A ship moors where a land vehicle boards or leaves one; a
 *  siege engine adds the attack row. */
export type VehicleOrder =
  | 'goTo'
  | 'stop'
  | 'dock'
  | 'boardShip'
  | 'leaveShip'
  | 'attackSettler'
  | 'attackBuilding'
  | 'attackVehicle'
  | 'attackPosition';

export type VehicleTask = components.VehicleTask;
export type VehicleStance = components.VehicleStance;

export interface VehicleOrderModel {
  readonly order: VehicleOrder;
  /** True when the sim would take it, else the reason it would refuse. */
  readonly control: SeatControl;
}

/** The status strip: the state in words, and the carrying ship as a link while the vehicle rides one. */
export interface VehicleStatusModel {
  readonly label: string;
  readonly tone: 'ok' | 'trouble' | 'neutral';
  readonly carrier: { readonly id: number; readonly label: string } | null;
}

/** How a seat well draws its rider. */
export type RiderLook = 'man' | 'woman' | 'soldier';

export interface VehicleRiderModel {
  readonly entity: number;
  readonly name: string;
  readonly job: string;
  /** Aboard, rather than still walking to the door. */
  readonly inside: boolean;
  readonly look: RiderLook;
}

export interface VehicleDeckModel {
  readonly entity: number;
  readonly label: string;
}

/**
 * Crew: the commander on its own row, a ship's ordinary seats as wells, and a ship's deck. The
 * controls are null on another seat's vehicle.
 */
export interface VehicleCrewModel {
  readonly commander: VehicleRiderModel | null;
  /** The ordinary seats in slot order, null where free; empty for a cart or a siege engine. */
  readonly seats: readonly (VehicleRiderModel | null)[];
  /** Taken seats and all seats, the commander's included. */
  readonly count: number;
  readonly capacity: number;
  /** The carried vehicles and the deck's slot count; null for a type without one. */
  readonly deck: { readonly capacity: number; readonly vehicles: readonly VehicleDeckModel[] } | null;
  /** The pick that seats a person: the commander's seat first, then a free ordinary one. */
  readonly assign: SeatControl | null;
  /** One rider stepping out. */
  readonly leave: SeatControl | null;
  /** "Unload everyone"; null while nobody rides. */
  readonly unload: SeatControl | null;
  /** The pick that drives an own land vehicle onto the deck; null without a deck or on a foreign ship. */
  readonly load: SeatControl | null;
  /** A carried vehicle driving off the deck. */
  readonly unloadVehicle: SeatControl | null;
}

/** One good in the hold, with its live counts. */
export interface VehicleCargoRow {
  readonly goodType: number;
  readonly goodId?: string;
  readonly label: string;
  readonly current: number;
  readonly wanted: number;
  /** Aboard plus booked to come; below `current` while units are booked to leave. */
  readonly reserved: number;
}

/** A good the hold may carry, for the add-a-good picker. */
export interface VehicleCargoGood {
  readonly goodType: number;
  readonly goodId?: string;
  readonly label: string;
  readonly category: number;
}

export interface VehicleHoldModel {
  /** The units the hold takes: the type's slots, never above a line's byte. */
  readonly slots: number;
  /** The lines with anything aboard, asked for or booked, ascending by good. */
  readonly rows: readonly VehicleCargoRow[];
  /** Everything the type may carry, in its list order. */
  readonly goods: readonly VehicleCargoGood[];
  /** A trader rides or pulls it, or has it pinned: the route writes the wanted amounts, so the hold is
   *  read-only. */
  readonly routed: boolean;
  /** Someone works the hold: the commander, a loader in any seat (`hasCargoHand`), or the carrier
   *  pulling it. */
  readonly cargoHand: boolean;
  /** A carrier has the cart in hand: its lifts fill the hold, so the hold is read-only. */
  readonly hauled: boolean;
}

/** Where a hauling cart is with its puller: in its hands off the map, set down for a lift, a stop or a
 *  break and taken up again after, or still standing where the order found it while the puller walks
 *  over. */
export type HaulingCartHold = 'pulled' | 'parked' | 'fetched';

/** The carrier or trader whose hauling cart this is (`Vehicle.hauler`, `HaulingCart` on the puller). */
export interface VehicleHaulerModel {
  readonly entity: number;
  readonly name: string;
  readonly hold: HaulingCartHold;
}

/** The trader a ship is pinned to (`Vehicle.hauler`, `TradeShip` on the trader). */
export interface VehicleTradePinModel {
  readonly entity: number;
  readonly name: string;
}

/** The status words naming the puller, with `{porter}` where its name goes. */
export function haulerStatusWords(hold: HaulingCartHold): string {
  const copy = messages().hud.vehiclePanel.status;
  switch (hold) {
    case 'pulled':
      return copy.pulledBy;
    case 'parked':
      return copy.parkedBy;
    case 'fetched':
      return copy.fetchedBy;
  }
}

/** The Trade section of the trader riding the vehicle; its controls act on that trader. */
export interface VehicleTradeModel extends TraderSubject {
  readonly trade: TradePanelModel;
}

export interface VehiclePanelModel {
  readonly kind: 'vehicle';
  readonly entityId: number;
  readonly typeId: number;
  readonly vehicleClass: VehicleClass;
  readonly title: string;
  /** Another seat's vehicle: the owner line; null for the viewer's own. */
  readonly meta: string | null;
  readonly foreign: boolean;
  readonly status: VehicleStatusModel;
  /** The carrier pulling the cart; null for a vehicle no carrier holds. */
  readonly hauler: VehicleHaulerModel | null;
  /** The trader an own ship is pinned to; null for every other vehicle. */
  readonly tradePin: VehicleTradePinModel | null;
  readonly health: { readonly hitpoints: number; readonly max: number } | null;
  /** The movement orders, then a siege engine's attack orders; empty for another seat's vehicle. */
  readonly orders: readonly VehicleOrderModel[];
  readonly attackOrders: readonly VehicleOrderModel[];
  /** An own siege engine's stance; null for every other vehicle. */
  readonly stance: VehicleStance | null;
  readonly crew: VehicleCrewModel;
  readonly trade: VehicleTradeModel | null;
  /** Null for a vehicle without a hold (a siege engine) and for another seat's. */
  readonly hold: VehicleHoldModel | null;
}

interface StockLineSnapshot {
  readonly good: number;
  readonly current: number;
  readonly wanted: number;
  readonly reserved: number;
}

/** `VehicleStock.lines` as the snapshot clones the map: `[goodType, { current, wanted, reserved }]`. */
export function readStockLines(value: unknown): Map<number, StockLineSnapshot> {
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

function vehicleTypeOf(ctx: UnitPanelModelContext, typeId: number | undefined): VehicleType | undefined {
  return typeId === undefined ? undefined : ctx.vehicles.find((v) => v.typeId === typeId);
}

export function vehicleClassOf(type: VehicleType | undefined): VehicleClass {
  if (type === undefined) return 'cart';
  if (systems.isShipVehicle(type)) return 'ship';
  return systems.isSiegeVehicle(type) ? 'siege' : 'cart';
}

const vehicleComp = (e: SnapshotEntity): Comp => (e.components.Vehicle ?? {}) as Comp;

function taskOf(value: unknown): VehicleTask {
  return typeof value === 'string' && (components.VEHICLE_TASKS as readonly string[]).includes(value)
    ? (value as VehicleTask)
    : 'none';
}

function stanceOf(value: unknown): VehicleStance {
  return typeof value === 'string' && (components.VEHICLE_STANCES as readonly string[]).includes(value)
    ? (value as VehicleStance)
    : 'hold';
}

/** Whether any line is short of or past what it asks for: a cargo hand has a trip to make. */
function cargoMoving(lines: ReadonlyMap<number, StockLineSnapshot>): 'load' | 'unload' | null {
  let loading = false;
  for (const line of lines.values()) {
    if (line.wanted < line.reserved || line.reserved < line.current) return 'unload';
    if (line.wanted > line.reserved || line.reserved > line.current) loading = true;
  }
  return loading ? 'load' : null;
}

interface StatusInputs {
  readonly vehicleClass: VehicleClass;
  readonly task: VehicleTask;
  readonly carrier: { readonly id: number; readonly label: string } | null;
  /** The carrier or trader whose cart this is and where the cart is with it. */
  readonly hauler: { readonly name: string; readonly hold: HaulingCartHold } | null;
  readonly commanded: boolean;
  readonly foreign: boolean;
  /** Pinned to a trader, whose route empties the commander's seat at every shore. */
  readonly pinned: boolean;
  readonly driving: boolean;
  readonly moored: boolean;
  readonly cargo: 'load' | 'unload' | null;
}

/**
 * The status strip's words, the first that holds: riding a ship, pulled, parked or fetched by a carrier,
 * boarding a ship, fighting, under way, waiting for the animal, the commander or the crew, loading,
 * moored, then stopped or standing. A standing vehicle of the viewer's without its commander is in
 * trouble, unless a trader's route holds it: it neither moves nor loads.
 */
export function vehicleStatus(inputs: StatusInputs): VehicleStatusModel {
  const copy = messages().hud.vehiclePanel.status;
  const status = (label: string, tone: VehicleStatusModel['tone']): VehicleStatusModel => ({
    label,
    tone,
    carrier: null,
  });
  if (inputs.carrier !== null) return { label: copy.aboard, tone: 'neutral', carrier: inputs.carrier };
  if (inputs.hauler !== null) {
    return status(formatMessage(haulerStatusWords(inputs.hauler.hold), { porter: inputs.hauler.name }), 'ok');
  }
  if (inputs.task === 'boardsShip') return status(copy.boardsShip, 'ok');
  if (inputs.task === 'attacks') return status(copy.attacks, 'ok');
  if (inputs.task === 'docks') return status(copy.docks, 'ok');
  if (inputs.driving) return status(inputs.vehicleClass === 'ship' ? copy.sails : copy.drives, 'ok');
  if (inputs.task === 'waitsForAnimal') return status(copy.waitsForAnimal, 'trouble');
  if (!inputs.commanded && !inputs.foreign && !inputs.pinned)
    return status(copy.noCommander[inputs.vehicleClass], 'trouble');
  if (inputs.task === 'waitsForHuman') return status(copy.waitsForCrew, 'neutral');
  if (inputs.cargo !== null) return status(inputs.cargo === 'load' ? copy.loads : copy.unloads, 'ok');
  if (inputs.moored) return status(copy.moored, 'neutral');
  return status(inputs.task === 'interrupted' ? copy.stopped : copy.stands, 'neutral');
}

interface OrderInputs {
  readonly vehicleClass: VehicleClass;
  /** A seated commander, or a pinned trader who answers from ashore. */
  readonly commanded: boolean;
  readonly carried: boolean;
  /** The carrying ship lies moored, so a carried vehicle may drive off it. */
  readonly carrierMoored: boolean;
  readonly animalMissing: boolean;
  /** A carrier holds the cart: it moves only with the carrier. */
  readonly hauled: boolean;
}

/**
 * The order buttons and why each would be refused: nobody drives an uncommanded vehicle, a carried one
 * only leaves its ship and only while the ship is moored, a cart waiting for its draught animal does not
 * move, and a hauling cart goes where its puller takes it. A ship moors where a land vehicle boards a
 * ship; a siege engine adds the attacks.
 */
export function vehicleOrders(inputs: OrderInputs): {
  orders: VehicleOrderModel[];
  attackOrders: VehicleOrderModel[];
} {
  const copy = messages().hud.vehiclePanel.refusals;
  const moves: SeatControl = inputs.carried
    ? copy.carried
    : inputs.hauled
      ? copy.hauled
      : !inputs.commanded
        ? copy.noCommander[inputs.vehicleClass]
        : inputs.animalMissing
          ? copy.noAnimal
          : true;
  const stop: SeatControl = inputs.carried ? copy.carried : inputs.hauled ? copy.hauled : true;
  const orders: VehicleOrderModel[] = [
    { order: 'goTo', control: moves },
    { order: 'stop', control: stop },
  ];
  if (inputs.vehicleClass === 'ship') orders.push({ order: 'dock', control: moves });
  else if (inputs.carried) {
    const leaves = inputs.hauled ? copy.hauled : inputs.carrierMoored ? true : copy.carrierAtSea;
    orders.push({ order: 'leaveShip', control: leaves });
  } else orders.push({ order: 'boardShip', control: moves });
  const attackOrders: VehicleOrderModel[] =
    inputs.vehicleClass === 'siege'
      ? (['attackSettler', 'attackBuilding', 'attackVehicle', 'attackPosition'] as const).map((order) => ({
          order,
          control: moves,
        }))
      : [];
  return { orders, attackOrders };
}

function riderModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  seat: VehicleSeatSnapshot,
): VehicleRiderModel {
  const e = entityById(snapshot, seat.entity);
  if (e === undefined) {
    return { entity: seat.entity, name: `#${seat.entity}`, job: '', inside: seat.inside, look: 'man' };
  }
  const jobType = settlerJobType(e);
  const job = ctx.jobs.find((row) => row.typeId === jobType);
  const look: RiderLook =
    job !== undefined && systems.isFighterJobRow(job) ? 'soldier' : isFemale(e) ? 'woman' : 'man';
  return {
    entity: seat.entity,
    name: settlerName(ctx, e),
    job: jobDisplayName(ctx, jobType),
    inside: seat.inside,
    look,
  };
}

/** The slot-ordered ordinary seats of a `passengers` list, the commander's last slot left out. */
function ordinarySeats(slots: unknown): (VehicleSeatSnapshot | null)[] {
  if (!Array.isArray(slots)) return [];
  return slots.slice(0, -1).map((slot) => {
    const [seat] = vehicleSeatsOf([slot]);
    return seat ?? null;
  });
}

interface CrewInputs {
  readonly entityId: number;
  readonly vehicleClass: VehicleClass;
  readonly foreign: boolean;
  readonly carried: boolean;
  /** The carrier or trader whose cart this is, which refuses crew meanwhile; null for any other vehicle. */
  readonly hauler: VehicleHaulerModel | null;
  /** The trader whose route holds the ship: its seats and deck are the route's. */
  readonly tradePin: VehicleTradePinModel | null;
  /** A ship lying at sea: nobody steps in or out. */
  readonly atSea: boolean;
  readonly moored: boolean;
}

function crewModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  v: Comp,
  commanderId: number | undefined,
  inputs: CrewInputs,
): VehicleCrewModel {
  const copy = messages().hud.vehiclePanel.refusals;
  const passengers = vehicleSeatsOf(v.passengers);
  const lead = passengers.find((seat) => seat.entity === commanderId);
  const hauled = inputs.hauler !== null;
  const pinned = inputs.tradePin !== null;
  // The puller who holds an own cart stands in the commander's seat without taking a passenger slot;
  // he never sits in it, so he counts as at his post rather than walking to the door. A pinned trader
  // commands its ship from ashore too, and reads as outside there.
  const commander =
    lead !== undefined
      ? riderModel(ctx, snapshot, lead)
      : hauled && !inputs.foreign
        ? riderModel(ctx, snapshot, { entity: inputs.hauler.entity, inside: true })
        : pinned
          ? riderModel(ctx, snapshot, { entity: inputs.tradePin.entity, inside: false })
          : null;
  const seats = ordinarySeats(v.passengers).map((seat) =>
    seat === null ? null : riderModel(ctx, snapshot, seat),
  );
  const capacity = Array.isArray(v.passengers) ? v.passengers.length : 0;
  const carriedSeats = vehicleSeatsOf(v.vehicles);
  const deckCapacity = Array.isArray(v.vehicles) ? v.vehicles.length : 0;
  const deck =
    deckCapacity === 0
      ? null
      : {
          capacity: deckCapacity,
          vehicles: carriedSeats.map((seat) => {
            const e = entityById(snapshot, seat.entity);
            const typeId = e === undefined ? undefined : num(vehicleComp(e).vehicleType);
            return { entity: seat.entity, label: vehicleTitle(ctx, typeId) };
          }),
        };
  const own = !inputs.foreign;
  const atSea: SeatControl = copy.atSea;
  const carried: SeatControl = copy.carried;
  const doorless = inputs.atSea ? atSea : inputs.carried ? carried : true;
  const full = passengers.length >= capacity;
  return {
    commander,
    seats,
    count: passengers.length,
    capacity,
    deck,
    assign: own ? (hauled ? copy.hauled : pinned ? copy.pinned : full ? copy.noSeat : doorless) : null,
    leave: own ? (hauled ? copy.hauled : pinned ? copy.pinned : doorless) : null,
    unload: own && passengers.length > 0 ? doorless : null,
    load:
      own && deck !== null
        ? pinned
          ? copy.pinned
          : !inputs.moored
            ? copy.notMoored
            : carriedSeats.length >= deckCapacity
              ? copy.deckFull
              : true
        : null,
    unloadVehicle: own && deck !== null ? (pinned ? copy.pinned : inputs.moored ? true : atSea) : null,
  };
}

function holdModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  type: VehicleType,
  lines: ReadonlyMap<number, StockLineSnapshot>,
  passengers: readonly VehicleSeatSnapshot[],
  commanderId: number | undefined,
  routed: boolean,
  hauler: VehicleHaulerModel | null,
): VehicleHoldModel {
  const slots = Math.min(type.stockSlots, components.VEHICLE_STOCK_BYTE_MAX);
  const cargoGood = (goodType: number): Omit<VehicleCargoGood, 'category'> => {
    const id = goodDef(ctx, goodType)?.id;
    return { goodType, ...(id === undefined ? {} : { goodId: id }), label: goodLabel(ctx, goodType) };
  };
  const rows = [...lines.values()]
    .filter((line) => line.current > 0 || line.wanted > 0 || line.reserved > 0)
    .sort((a, b) => a.good - b.good)
    .map((line) => ({
      ...cargoGood(line.good),
      current: line.current,
      wanted: line.wanted,
      reserved: line.reserved,
    }));
  const goods = type.cargoGoods
    .filter((goodType) => ctx.livestockTribeOfGood?.(goodType) == null)
    .map((goodType) => ({ ...cargoGood(goodType), category: goodCategoryTab(goodDef(ctx, goodType)?.id) }));
  const seatedHand = passengers.some((seat) => {
    if (seat.entity === commanderId) return true;
    const e = entityById(snapshot, seat.entity);
    const jobType = e === undefined ? undefined : settlerJobType(e);
    return jobType !== undefined && isCarrierJob(ctx, jobType);
  });
  return {
    slots,
    rows,
    goods,
    routed,
    cargoHand: seatedHand || hauler !== null,
    hauled: hauler !== null,
  };
}

/**
 * Original behavior: every vehicle but a ship shows the Trade tab of the first passenger, aboard or
 * walking to the door, that holds the trader job, so the route can be edited with only the cart selected.
 * Here the trader pulling the cart as its hauling cart answers too, after the passengers. The trader
 * read seam is the job check: it answers for traders alone.
 */
function vehicleTrade(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  vehicleClass: VehicleClass,
  passengers: readonly VehicleSeatSnapshot[],
  hauler: number | undefined,
): VehicleTradeModel | null {
  if (vehicleClass === 'ship') return null;
  const candidates = passengers.map((seat) => seat.entity);
  if (hauler !== undefined) candidates.push(hauler);
  for (const id of candidates) {
    const trade = tradePanelModel(ctx, snapshot, id);
    const trader = entityById(snapshot, id);
    if (trade !== null && trader !== undefined) {
      return { entityId: id, name: settlerName(ctx, trader), trade };
    }
  }
  return null;
}

function haulerOf(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  vehicle: SnapshotEntity,
): { model: VehicleHaulerModel; carrier: SnapshotEntity } | null {
  const id = num(vehicleComp(vehicle).hauler);
  const carrier = id === undefined ? undefined : entityById(snapshot, id);
  const cart = carrier?.components.HaulingCart as
    | { vehicle?: unknown; taken?: unknown; parked?: unknown }
    | undefined;
  if (carrier === undefined || cart === undefined || num(cart.vehicle) !== vehicle.id) return null;
  const hold: HaulingCartHold = cart.taken === true ? 'pulled' : cart.parked === true ? 'parked' : 'fetched';
  return { model: { entity: carrier.id, name: settlerName(ctx, carrier), hold }, carrier };
}

function tradePinOf(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  ship: SnapshotEntity,
): VehicleTradePinModel | null {
  const id = num(vehicleComp(ship).hauler);
  const trader = id === undefined ? undefined : entityById(snapshot, id);
  const pin = trader?.components.TradeShip as { vehicle?: unknown } | undefined;
  if (trader === undefined || num(pin?.vehicle) !== ship.id) return null;
  return { entity: trader.id, name: settlerName(ctx, trader) };
}

/** A taken cart's load: its own hold plus what its carrier has in hand, which rides in the cart. */
export function withCarriedLoad(
  lines: ReadonlyMap<number, StockLineSnapshot>,
  carrier: SnapshotEntity,
): Map<number, StockLineSnapshot> {
  const merged = new Map(lines);
  const carrying = carrier.components.Carrying as { goodType?: unknown; amount?: unknown } | undefined;
  const good = num(carrying?.goodType);
  const amount = num(carrying?.amount) ?? 0;
  if (good === undefined || amount <= 0) return merged;
  const line = merged.get(good) ?? { good, current: 0, wanted: 0, reserved: 0 };
  merged.set(good, {
    good,
    current: line.current + amount,
    wanted: line.wanted + amount,
    reserved: line.reserved + amount,
  });
  return merged;
}

/** The entity the portrait shows and the centre button jumps to: a taken cart travels with its carrier. */
export function vehicleSubjectEntity(model: Pick<VehiclePanelModel, 'entityId' | 'hauler'>): number {
  return model.hauler?.hold === 'pulled' ? model.hauler.entity : model.entityId;
}

export function vehiclePanelModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
): VehiclePanelModel {
  const v = vehicleComp(ent);
  const typeId = num(v.vehicleType);
  const type = vehicleTypeOf(ctx, typeId);
  const vehicleClass = vehicleClassOf(type);
  const seat = ctx.viewer === undefined ? null : pickableSeat(ctx.viewer);
  const owner = ownerPlayerOf(ent);
  const foreign = ownedByAnotherSeat(owner, seat);
  const passengers = vehicleSeatsOf(v.passengers);
  const commanderId = vehicleCommanderOf(ent);
  const commanded = commanderId !== undefined;
  const task = taskOf(v.task);
  const moored = v.moored === true;
  const carrierId = num(v.carrier);
  const carrierEntity = carrierId === undefined ? undefined : entityById(snapshot, carrierId);
  const carrier =
    carrierEntity === undefined || !isVehicle(carrierEntity)
      ? null
      : { id: carrierEntity.id, label: vehicleTitle(ctx, num(vehicleComp(carrierEntity).vehicleType)) };
  const carried = carrierId !== undefined;
  const hauling = haulerOf(ctx, snapshot, ent);
  const hauler = hauling?.model ?? null;
  const hauled = hauler !== null;
  const tradePin = foreign ? null : tradePinOf(ctx, snapshot, ent);
  const pinned = tradePin !== null;
  // The snapshot cannot tell continents apart: the sim still refuses a trader across the sea.
  const traderAnswers =
    tradePin !== null && moored && entityById(snapshot, tradePin.entity)?.components.Rider === undefined;
  const ownLines = readStockLines(ent.components.VehicleStock);
  const lines = hauling?.model.hold === 'pulled' ? withCarriedLoad(ownLines, hauling.carrier) : ownLines;
  const trade = foreign ? null : vehicleTrade(ctx, snapshot, vehicleClass, passengers, hauling?.carrier.id);
  const hold =
    foreign || type === undefined || type.stockSlots === 0
      ? null
      : holdModel(ctx, snapshot, type, lines, passengers, commanderId, trade !== null || pinned, hauler);
  const health = healthOf(ent);
  const animalMissing =
    type !== undefined && systems.awaitsDraughtAnimal(type, { harnessed: v.harnessed === true });
  const { orders, attackOrders } = foreign
    ? { orders: [], attackOrders: [] }
    : vehicleOrders({
        vehicleClass,
        commanded: commanded || traderAnswers,
        carried,
        carrierMoored: carrierEntity !== undefined && vehicleComp(carrierEntity).moored === true,
        animalMissing,
        hauled,
      });
  return {
    kind: 'vehicle',
    entityId: ent.id,
    typeId: typeId ?? -1,
    vehicleClass,
    title: vehicleTitle(ctx, typeId),
    meta: foreign ? foreignOwnerLine(ctx, ownerPlayerOf(ent), num(v.tribe)) : null,
    foreign,
    status: vehicleStatus({
      vehicleClass,
      task,
      carrier,
      hauler: hauler === null ? null : { name: hauler.name, hold: hauler.hold },
      commanded,
      foreign,
      pinned,
      driving: ent.components.VehicleDrive !== undefined,
      moored,
      cargo: hold === null || !hold.cargoHand ? null : cargoMoving(lines),
    }),
    hauler,
    tradePin,
    health: health === undefined || health.max <= 0 ? null : health,
    orders,
    attackOrders,
    stance: !foreign && vehicleClass === 'siege' ? stanceOf(v.stance) : null,
    crew: crewModel(ctx, snapshot, v, commanderId, {
      entityId: ent.id,
      vehicleClass,
      foreign,
      carried,
      hauler,
      tradePin,
      atSea: vehicleClass === 'ship' && !moored,
      moored,
    }),
    trade,
    hold,
  };
}
