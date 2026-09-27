import { type DeepReadonly, defineComponent, type Entity, type World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import { Building } from './economy/infrastructure.js';
import { Position } from './movement.js';
import { MAX_PLAYERS, ownerOf } from './ownership.js';

/** A trader's route holds two houses (reading: the original's merchant data has two house slots). */
export const TRADE_ROUTE_HOUSES = 2;

/** The most agreements one map registers (reading: the merchant array holds 60). */
export const TRADE_AGREEMENT_LIMIT = 60;

/** The limit value that sets no limit: a mark whose `upTo` holds it fills the destination without a
 *  ceiling, one whose `keep` holds it leaves nothing behind. */
export const TRADE_LIMIT_NONE = 0;

/** One good the player marked for import into a stop, with its two per-good limits in units. */
export interface TradeImportMark {
  readonly good: number;
  /** Units the destination stop is filled up to; {@link TRADE_LIMIT_NONE} means no ceiling. */
  readonly upTo: number;
  /** Units left untouched in the other stop when loading this good; {@link TRADE_LIMIT_NONE} keeps none. */
  readonly keep: number;
}

/** One stop of a trader's route. */
export interface TradeStop {
  /** Which of the route's {@link TRADE_ROUTE_HOUSES} slots the stop fills, from 0. */
  readonly slot: number;
  readonly house: Entity;
  /** The goods the player marked for import into this house, ascending by good. */
  imports: TradeImportMark[];
}

/** Whether `house` belongs to another player than `trader`: the stop the exchange happens at. Read off
 *  the live owners, since a map script can hand either to another player mid-route; a house that is gone
 *  belongs to nobody. */
export function isForeignHouse(world: World, trader: Entity, house: Entity): boolean {
  return world.isAlive(house) && ownerOf(world, house) !== ownerOf(world, trader);
}

/** The route's stop at another player's house, or undefined for a route between the trader's own houses. */
export function foreignStopOf(
  world: World,
  trader: Entity,
  route: DeepReadonly<{ stops: TradeStop[] }>,
): DeepReadonly<TradeStop> | undefined {
  return route.stops.find((stop) => isForeignHouse(world, trader, stop.house));
}

/**
 * A trader's route: the two houses it plies between, the stop it is at, the agreement it trades on at
 * a foreign stop, and how far the current exchange has come. `given`/`received` count the units of the
 * agreement's goods handed over and taken at the foreign house since the last completed exchange
 * (reading of the merchant counters). The goods ride in the hold of the cart the trader commands
 * (`VehicleStock`), never on the route itself.
 */
export const TradeRoute = defineComponent<{
  stops: TradeStop[];
  /** Index into `stops` of the house the trader serves now, or -1 before the first stop. */
  current: number;
  /** Index into the agreement table, or -1 while none is chosen. */
  agreement: number;
  given: number;
  received: number;
}>('TradeRoute', 'settlers');

export type TradeRouteState = NonNullable<(typeof TradeRoute)['__value']>;
export type TradeRouteView = DeepReadonly<TradeRouteState>;

export function tradeRouteOf(world: World, e: Entity): TradeRouteView | undefined {
  return world.tryGet(e, TradeRoute);
}

/** Ensure the trader carries a route record; a fresh one has no stops. */
export function ensureTradeRoute(world: World, e: Entity): void {
  if (world.has(e, TradeRoute)) return;
  world.add(e, TradeRoute, {
    stops: [],
    current: -1,
    agreement: -1,
    given: 0,
    received: 0,
  });
}

/**
 * Add a stop; refused for a house already on the route. The house takes the first free slot; on a full
 * route it takes the first slot's place (the original refuses a full route; this build replaces, owner's
 * choice), and the trader starts over from the first stop. A route trades with one foreign house at most:
 * another player's house takes the place of the foreign stop already on it. `stops` stays in slot order, so a full route
 * reads as `[first, second]`. The import flags of every stop are cleared, as the original does on any
 * route change.
 */
export function addTradeStop(world: World, e: Entity, house: Entity): boolean {
  ensureTradeRoute(world, e);
  dropFallenTradeStops(world, e);
  const route = world.get(e, TradeRoute);
  if (route.stops.some((s) => s.house === house)) return false;
  const foreignStop = isForeignHouse(world, e, house) ? foreignStopOf(world, e, route) : undefined;
  const live = world.mut(e, TradeRoute);
  let slot = 0;
  while (slot < TRADE_ROUTE_HOUSES && live.stops.some((s) => s.slot === slot)) slot++;
  if (foreignStop !== undefined) slot = foreignStop.slot;
  else if (slot === TRADE_ROUTE_HOUSES) slot = 0;
  const dropped = live.stops.find((s) => s.slot === slot);
  if (dropped !== undefined) {
    live.stops = live.stops.filter((s) => s !== dropped);
    if (isForeignHouse(world, e, dropped.house)) live.agreement = -1;
  }
  live.stops.push({ slot, house, imports: [] });
  live.stops.sort((a, b) => a.slot - b.slot);
  for (const stop of live.stops) stop.imports = [];
  live.current = -1;
  live.given = 0;
  live.received = 0;
  return true;
}

/** Whether a stop's house still stands on the map, finished or a site. */
function houseStands(world: World, house: Entity): boolean {
  return world.isAlive(house) && world.has(house, Position) && world.has(house, Building);
}

/**
 * Drop every stop whose house fell, starting the route over; a route left with no foreign stop drops its
 * agreement. A house being upgraded stands and stays, as its workers keep their bindings.
 */
export function dropFallenTradeStops(world: World, e: Entity): void {
  const route = world.tryGet(e, TradeRoute);
  if (route === undefined || route.stops.every((stop) => houseStands(world, stop.house))) return;
  const live = world.mut(e, TradeRoute);
  live.stops = live.stops.filter((stop) => houseStands(world, stop.house));
  live.current = -1;
  live.given = 0;
  live.received = 0;
  if (foreignStopOf(world, e, live) === undefined) live.agreement = -1;
}

/** Remove `house` from the route; the stop index rewinds so the next plan starts from the first stop. */
export function removeTradeStop(world: World, e: Entity, house: Entity): boolean {
  const route = world.tryGet(e, TradeRoute);
  if (route === undefined || !route.stops.some((s) => s.house === house)) return false;
  const live = world.mut(e, TradeRoute);
  live.stops = live.stops.filter((s) => s.house !== house);
  for (const stop of live.stops) stop.imports = [];
  live.current = -1;
  if (foreignStopOf(world, e, live) === undefined) live.agreement = -1;
  live.given = 0;
  live.received = 0;
  return true;
}

/** Mark or clear one import; refused on a route with a foreign stop, where the agreement alone decides
 *  what moves. A new mark sets no limit. */
export function setTradeImport(world: World, e: Entity, house: Entity, good: number, on: boolean): boolean {
  const index = domesticStopIndex(world, e, house);
  if (index < 0) return false;
  const has = world.get(e, TradeRoute).stops[index]?.imports.some((mark) => mark.good === good) ?? false;
  if (has === on) return true;
  const stop = world.mut(e, TradeRoute).stops[index];
  if (stop === undefined) return false;
  stop.imports = on
    ? [...stop.imports, { good, upTo: TRADE_LIMIT_NONE, keep: TRADE_LIMIT_NONE }].sort(
        (a, b) => a.good - b.good,
      )
    : stop.imports.filter((mark) => mark.good !== good);
  return true;
}

/** Set the two limits of an existing import mark; refused without that mark or for a limit that is no
 *  non-negative whole number of units. */
export function setTradeImportLimits(
  world: World,
  e: Entity,
  house: Entity,
  good: number,
  upTo: number,
  keep: number,
): boolean {
  if (!isUnitCount(upTo) || !isUnitCount(keep)) return false;
  const index = domesticStopIndex(world, e, house);
  if (index < 0) return false;
  const marks = world.get(e, TradeRoute).stops[index]?.imports ?? [];
  const at = marks.findIndex((mark) => mark.good === good);
  const current = marks[at];
  if (current === undefined) return false;
  if (current.upTo === upTo && current.keep === keep) return true;
  const stop = world.mut(e, TradeRoute).stops[index];
  if (stop === undefined) return false;
  stop.imports = stop.imports.map((mark, i) => (i === at ? { good, upTo, keep } : mark));
  return true;
}

function isUnitCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** The index of `house` among the route's stops, or -1 when it is none or the route has a foreign stop. */
function domesticStopIndex(world: World, e: Entity, house: Entity): number {
  const route = world.tryGet(e, TradeRoute);
  if (route === undefined || foreignStopOf(world, e, route) !== undefined) return -1;
  return route.stops.findIndex((s) => s.house === house);
}

export function clearTradeImports(world: World, e: Entity): void {
  const route = world.tryGet(e, TradeRoute);
  if (route === undefined || route.stops.every((s) => s.imports.length === 0)) return;
  const live = world.mut(e, TradeRoute);
  for (const stop of live.stops) stop.imports = [];
}

export function setTradeAgreement(world: World, e: Entity, agreement: number): void {
  const route = world.tryGet(e, TradeRoute);
  if (route === undefined || route.agreement === agreement) return;
  const live = world.mut(e, TradeRoute);
  live.agreement = agreement;
  live.given = 0;
  live.received = 0;
}

/** One `tradeagreement` row of a map: at the houses stamped with `missionId`, hand over `giveAmount`
 *  of `giveGood` and receive `takeAmount` of `takeGood`. */
export interface TradeAgreement {
  readonly missionId: number;
  readonly giveGood: number;
  readonly giveAmount: number;
  readonly takeGood: number;
  readonly takeAmount: number;
}

const agreementTable = defineWorldSingleton<{ agreements: TradeAgreement[] }>(
  'TradeAgreements',
  'economy',
  () => ({
    agreements: [],
  }),
);

/** The map's agreement table in authored order; an index into it is what a trader's route names. */
export const TradeAgreements = agreementTable.component;

export function tradeAgreements(world: World): DeepReadonly<TradeAgreement[]> {
  return agreementTable.read(world).agreements;
}

/** Register one agreement; a non-positive amount is refused (the exchange could never complete) and a
 *  row past the table's limit is dropped, as the original drops it. */
export function addTradeAgreement(world: World, agreement: TradeAgreement): boolean {
  if (agreement.giveAmount <= 0 || agreement.takeAmount <= 0) return false;
  if (agreementTable.read(world).agreements.length >= TRADE_AGREEMENT_LIMIT) return false;
  agreementTable.write(world, (table) => {
    table.agreements.push({ ...agreement });
  });
  return true;
}

const tradeLedger = defineWorldSingleton<{
  /** `player * MAX_PLAYERS + partner` -> units the player's traders received from the partner's houses. */
  received: Map<number, number>;
}>('TradeLedger', 'players', () => ({ received: new Map() }));

/** What each player has traded with each other player, the tally `NumberOfGoodsTraded` and the diplomacy
 *  window read. Original behavior (byte-level): one per unit of the agreement's take good a trader carries
 *  from the partner's house to its cart, keyed by the trader's player and the house's; the goods it hands
 *  over count nowhere. Approximation: counted as the unit lands in the cart, not as the carry starts. */
export const TradeLedger = tradeLedger.component;

function ledgerKey(player: number, partner: number): number {
  return player * MAX_PLAYERS + partner;
}

export function goodsTradedWith(world: World, player: number, partner: number): number {
  return tradeLedger.read(world).received.get(ledgerKey(player, partner)) ?? 0;
}

export function recordGoodsTraded(world: World, player: number, partner: number, units: number): void {
  if (units <= 0) return;
  tradeLedger.write(world, (ledger) => {
    const key = ledgerKey(player, partner);
    ledger.received.set(key, (ledger.received.get(key) ?? 0) + units);
  });
}
