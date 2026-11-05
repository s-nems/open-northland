import { BUILDING_KIND } from '@open-northland/data';
import {
  Building,
  HaulingCart,
  Health,
  Marriage,
  Position,
  Residence,
  Settler,
  TRADE_LIMIT_NONE,
  type TradeImportMark,
  TradeRoute,
  type TradeRouteView,
  TradeShip,
  Vehicle,
  VehicleStock,
  vehicleLoad,
  vehiclePassengers,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { isCarrierJobId, isTraderJobId } from '../../../../core/content-index/jobs.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, hexDistance } from '../../../../nav/halfcell.js';
import { moduleBeatDue, POPULATION_PHASE, WORKFORCE_EVERY_DECISIONS } from '../../../ai-shared/cadence.js';
import { buildingTypeByContentId, tiersAtOrAbove } from '../../../ai-shared/content-lookup.js';
import { homeBuildings, homeSettlers } from '../../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { isBuilt } from '../../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../../context.js';
import { isAdultSettler } from '../../../family/eligibility.js';
import { CIVILIST_JOB } from '../../../lifecycle/ageclass.js';
import { canChooseJob, needSubjectOf } from '../../../progression/index.js';
import { isFighterJob, isTraderJob } from '../../../readviews/index.js';
import { heldBands } from '../../../settlers/targets/held-bands.js';
import { isCarrierJob } from '../../../stores/index.js';
import { settlementGround } from '../../../trade/settlement-ground.js';
import { canPinTradeShip } from '../../../trade/ship.js';
import { isCartType } from '../../../vehicles/drag.js';
import { canTakeHaulingCart } from '../../../vehicles/hauling-cart.js';
import { vehicleIndex } from '../../../vehicles/registry.js';
import { minutesToTicks } from '../../game-phase.js';
import { strandedShip } from '../../sea-route.js';
import { type ColonyEnv, type ColonyView, homeLandOf } from '../env.js';
import { sparePartyMen } from '../party.js';
import { colonists, colonyBuildings, standsOn } from '../roster.js';
import { carryingShip, newRoute, type RouteSlot, takeRouteShip } from '../sea/fleet.js';
import { lyingStill, mooredOn, mooringOf, unloadAt } from '../sea/moorings.js';
import { lineWayClear, sailOrders, withDanger } from '../sea/sea-danger.js';
import { storesHeld } from '../settlement/provision.js';
import { homeStockOf } from '../stock.js';
import {
  type ColonyStockPolicy,
  type ColonyStockReads,
  colonyStockPolicy,
  colonyStockReadsOf,
} from './stock-policy.js';

// A colony's goods go by a trader of the seat's (owner ruling): a home man takes the trade, a ship is pinned
// to his route between a home warehouse and the colony's, both standing for their settlements, and the marks
// follow the colony's stock policy. Everything is a player's command.

/** A settler with no trade, which no job type matches. */
const NO_JOB = -1;
/** Owner ruling: a trader works from a level-3 warehouse, so the route waits for the colony's to stand. */
const ROUTE_STORE_ID = 'stock_02';
/** The carriers seated on the route's ship to help load (authored: the trade-sea carriers scene's three). */
const ROUTE_HELPERS = 3;
/** How long a man chosen for the trade may take to change it, finishing what he holds first (authored). */
const TRADE_TAKE_UP_TICKS = minutesToTicks(2);
/** Every how many decisions the marks are read again (authored: a game minute; the policy costs a flag
 *  search, and stock moves slower than that). */
const MARKS_EVERY_DECISIONS = 15;

export type RouteView = DeepReadonly<NonNullable<ColonyView['route']>>;

/** What a colony's two routes share within one decision. */
interface RouteDecision {
  /** The men already spoken for: the other route's trader and the helpers seated so far. */
  readonly taken: Set<Entity>;
  /** The colony's stock reads, read once for both routes' marks. */
  readonly stockReads: () => ColonyStockReads;
}

/** One trader round on arabskie_wyspy_wolna_gra_mieszana, home to colony and back (measured: about 15
 *  game minutes, as the colony's food per mouth assumes). A route that unloaded within it is working. */
const ROUTE_ROUND_TICKS = minutesToTicks(15);
/** How long the marks must ask more than one hold while the route works before a relief sails beside it
 *  (authored: two rounds, so one slow round or a burst of surplus raises none). */
export const RELIEF_AFTER_TICKS = 2 * ROUTE_ROUND_TICKS;

/** The first job of `content` whose id passes `test`. */
function jobWhere(ctx: SystemContext, test: (id: string) => boolean): number | null {
  for (const [typeId, job] of contentIndex(ctx.content).jobs) if (test(job.id)) return typeId;
  return null;
}

/** The units aboard `ship` and in the carts it or `trader` holds. */
function routeLoad(world: World, ship: Entity, trader: Entity | null): number {
  const loadOf = (e: Entity | null): number => {
    const stock = e === null ? undefined : world.tryGet(e, VehicleStock);
    return stock === undefined ? 0 : vehicleLoad(stock);
  };
  const carts = (world.tryGet(ship, Vehicle)?.vehicles ?? []).flatMap((slot) =>
    slot === null ? [] : [slot.entity],
  );
  let units = loadOf(ship);
  for (const cart of carts) units += loadOf(cart);
  const held = trader === null ? undefined : world.tryGet(trader, HaulingCart)?.vehicle;
  if (held !== undefined && !carts.includes(held)) units += loadOf(held);
  return units;
}

/** Keep the record of the hull and the load: a hull that fell marks where the ship lies as danger, a load
 *  that fell with the ship moored at either stop is a delivery, so a full store at one end does not hide a
 *  working route. Only a change writes. */
function noteRoute(
  env: ColonyEnv,
  colony: ColonyView,
  route: RouteView,
  ship: Entity,
  slot: RouteSlot,
): void {
  const { world, ctx } = env;
  const hull = world.tryGet(ship, Health)?.hitpoints ?? 0;
  const load = routeLoad(world, ship, route.trader);
  if (hull === route.hull && load === route.load) return;
  if (hull < route.hull) {
    const at = anchorNodeOf(world, ship);
    const dangers = at === null ? null : withDanger(colony.dangers, at, ctx.tick);
    if (dangers !== null) env.edit().dangers = dangers;
  }
  if (load < route.load && (mooredOn(env, ship, homeLandOf(env)) || mooredOn(env, ship, colony.land)))
    env.edit().delivered = ctx.tick;
  const live = env.edit()[slot];
  if (live === null) return;
  live.hull = hull;
  live.load = load;
}

/** A route with no ship takes a free one at home while a way clear of the fire that took the last remains. */
function claimShip(env: ColonyEnv, colony: ColonyView, slot: RouteSlot): void {
  if (!lineWayClear(env.terrain, colony.dangers, colony.berth, colony.shore)) return;
  const ship = carryingShip(env);
  if (ship !== null) takeRouteShip(env, ship, slot);
}

/** Bring an unpinned ship home: riders off where it lies at home, else a helm aboard sails it to the berth. */
function shipHome(env: ColonyEnv, colony: ColonyView, ship: Entity): PlayerCommand[] {
  const { world } = env;
  const state = world.get(ship, Vehicle);
  const riders = vehiclePassengers(state);
  const mooring = mooringOf(world, ship);
  if (mooredOn(env, ship, homeLandOf(env)))
    return riders.length > 0 && mooring !== null ? [unloadAt(ship, mooring)] : [];
  if (!lyingStill(world, ship) || colony.berth === null) return [];
  if (riders.length > 0)
    return riders.every((r) => r.inside) ? sailOrders(env, colony, ship, colony.berth) : [];
  if (!mooredOn(env, ship, colony.land)) return [];
  const helm = colonists(env).find((e) => canHelm(env, e));
  return helm === undefined ? [] : [{ kind: 'attachToVehicle', entity: helm, vehicle: ship }];
}

function canHelm(env: ColonyEnv, e: Entity): boolean {
  const { world, ctx } = env;
  return isAdultSettler(world, e) && !isFighterJob(ctx.content, world.get(e, Settler).jobType);
}

/** Whether `e` has no residence, or one among home's buildings: a family on the colony keeps calling him. */
function livesAtHome(world: World, homes: ReadonlySet<Entity>, e: Entity): boolean {
  const home = world.tryGet(e, Residence)?.home;
  return home === undefined || homes.has(home);
}

/** The man at home who takes the trade: a spare man or a carrier who has earned it, standing on home's land
 *  and living there and not in `taken`, a wed man first, then a spare one, then ascending id. */
function traderFor(env: ColonyEnv, trader: number, taken: ReadonlySet<Entity>): Entity | null {
  const { world, ctx, seat } = env;
  const home = homeLandOf(env);
  const spare = new Set(sparePartyMen(world, ctx, seat, home));
  const homes = new Set(homeBuildings(world, ctx, seat));
  const able = homeSettlers(world, ctx, seat).filter(
    (e) =>
      !taken.has(e) &&
      canHelm(env, e) &&
      livesAtHome(world, homes, e) &&
      !isTraderJob(ctx.content, world.get(e, Settler).jobType) &&
      standsOn(world, ctx, e, home) &&
      (spare.has(e) || isCarrierJob(ctx, world.get(e, Settler).jobType ?? NO_JOB)) &&
      canChooseJob(world, ctx, needSubjectOf(world, e), trader),
  );
  // A man wed at home goes on living there; an unwed one could take a wife on the colony and be called over.
  // A spare man before a carrier off his store, never a craftsman off his workshop.
  const rank = (e: Entity): number => (world.has(e, Marriage) ? 0 : 2) + (spare.has(e) ? 0 : 1);
  return able.reduce<Entity | null>((best, e) => (best === null || rank(e) < rank(best) ? e : best), null);
}

/** Keep the route's trader: a dead one, or one who has not taken the trade in time, is let go and the next
 *  is chosen outside `taken`; null while none is a trader yet. */
function keepTrader(
  env: ColonyEnv,
  route: RouteView,
  slot: RouteSlot,
  taken: ReadonlySet<Entity>,
): { trader: Entity | null; commands: PlayerCommand[] } {
  const { world, ctx } = env;
  const job = jobWhere(ctx, isTraderJobId);
  if (job === null) return { trader: null, commands: [] };
  const held = route.trader;
  if (held !== null && world.isAlive(held)) {
    if (isTraderJob(ctx.content, world.tryGet(held, Settler)?.jobType ?? null))
      return { trader: held, commands: [] };
    if (ctx.tick - route.chosen < TRADE_TAKE_UP_TICKS) return { trader: null, commands: [] };
  }
  const next = traderFor(env, job, taken);
  const live = env.edit()[slot];
  if (live !== null) {
    live.trader = next;
    live.chosen = ctx.tick;
  }
  return { trader: null, commands: next === null ? [] : [{ kind: 'setJob', entity: next, jobType: job }] };
}

/** Whether `e` is a built storage of the route's tier or above. */
function routeStore(env: ColonyEnv, e: Entity): boolean {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const top = buildingTypeByContentId(ctx.content, ROUTE_STORE_ID);
  const type = world.get(e, Building).buildingType;
  return top !== undefined && isBuilt(world, e) && tiersAtOrAbove(index, top).has(type);
}

function isStore(env: ColonyEnv, e: Entity): boolean {
  const kind = contentIndex(env.ctx.content).buildings.get(env.world.get(e, Building).buildingType)?.kind;
  return kind === BUILDING_KIND.storage && isBuilt(env.world, e);
}

function nearest(env: ColonyEnv, stores: readonly Entity[], to: DeepReadonly<HalfCellNode>): Entity | null {
  let best: { readonly e: Entity; readonly d: number } | null = null;
  for (const e of stores) {
    const at = anchorNodeOf(env.world, e);
    const d = at === null ? Number.POSITIVE_INFINITY : hexDistance(at, { hx: to.hx, hy: to.hy });
    if (best === null || d < best.d) best = { e, d };
  }
  return best?.e ?? null;
}

/** The route's two stops: the colony's level-3 warehouse nearest its shore, and home's store nearest the
 *  berth, a level-3 one where home has one. Null until both stand. */
function stopsOf(
  env: ColonyEnv,
  colony: ColonyView,
  held: readonly Entity[],
): { home: Entity; colony: Entity } | null {
  const { world, ctx, seat } = env;
  const there = colonyBuildings(env).filter((e) => routeStore(env, e));
  const at = colony.shore ?? colony.site;
  const away = keptOr(held, there) ?? nearest(env, there, at);
  const stores = homeBuildings(world, ctx, seat).filter((e) => isStore(env, e));
  const topStores = stores.filter((e) => routeStore(env, e));
  const berth = colony.berth ?? colony.site;
  const candidates = topStores.length > 0 ? topStores : stores;
  const home = keptOr(held, candidates) ?? nearest(env, candidates, berth);
  return away === null || home === null ? null : { home, colony: away };
}

/** The stop the route holds among `candidates`, kept while it qualifies: moving a stop starts the route over,
 *  which turned a ship under way back home each time home raised a warehouse nearer the berth. */
function keptOr(held: readonly Entity[], candidates: readonly Entity[]): Entity | null {
  return held.find((house) => candidates.includes(house)) ?? null;
}

/** Orders that put the route on `home` then `away`, both standing for their settlements. */
function stopOrders(
  trader: Entity,
  route: TradeRouteView | undefined,
  home: Entity,
  away: Entity,
): PlayerCommand[] {
  const stops = route?.stops ?? [];
  const commands: PlayerCommand[] = [];
  for (const stop of stops)
    if (stop.house !== home && stop.house !== away)
      commands.push({ kind: 'detachTradeHouse', entity: trader, house: stop.house });
  for (const house of [home, away]) {
    const stop = stops.find((s) => s.house === house);
    if (stop === undefined) commands.push({ kind: 'attachTradeHouse', entity: trader, house });
    if (stop?.settlement !== true)
      commands.push({ kind: 'setTradeSettlement', entity: trader, house, on: true });
  }
  return commands;
}

/** Orders that bring `house`'s marks to `wanted`: one per mark added, cleared or limited anew. */
export function markOrders(
  trader: Entity,
  house: Entity,
  held: readonly DeepReadonly<TradeImportMark>[],
  wanted: readonly TradeImportMark[],
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const mark of held)
    if (!wanted.some((w) => w.good === mark.good))
      commands.push({ kind: 'setTradeImport', entity: trader, house, good: mark.good, on: false });
  for (const mark of wanted) {
    const had = held.find((h) => h.good === mark.good);
    if (had === undefined)
      commands.push({ kind: 'setTradeImport', entity: trader, house, good: mark.good, on: true });
    if (had === undefined || had.upTo !== mark.upTo || had.keep !== mark.keep)
      commands.push({ kind: 'setTradeImportLimits', entity: trader, house, ...mark });
  }
  return commands;
}

/**
 * The trader's marks for `policy`: inbound at the colony's stop, outbound at home's with no ceiling. Home
 * keeps a reserve in its stores, but its stop counts the goods lying on home's ground as home's stock, so a
 * kept reserve is raised by `homeGround`: else heaps by the flags and the shore would let the colony's
 * marks empty home's stores below the reserve.
 */
export function routeMarks(
  policy: ColonyStockPolicy,
  homeGround: (good: number) => number,
): {
  readonly atColony: TradeImportMark[];
  readonly atHome: TradeImportMark[];
} {
  return {
    atColony: policy.inbound.map(({ good, upTo, keep }) => ({
      good,
      upTo,
      keep: keep > 0 ? keep + homeGround(good) : keep,
    })),
    atHome: policy.outbound.map(({ good, keep }) => ({ good, upTo: TRADE_LIMIT_NONE, keep })),
  };
}

/** Sync the marks on the stops with the colony's policy, on its beat or while the colony's stop has none. */
function syncMarks(
  env: ColonyEnv,
  decision: RouteDecision,
  trader: Entity,
  home: Entity,
  away: Entity,
): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const route = world.tryGet(trader, TradeRoute);
  const homeStop = route?.stops.find((s) => s.house === home);
  const awayStop = route?.stops.find((s) => s.house === away);
  if (homeStop === undefined || awayStop === undefined) return [];
  const due = moduleBeatDue(ctx.tick - POPULATION_PHASE, seat, MARKS_EVERY_DECISIONS);
  if (!due && awayStop.imports.length > 0) return [];
  const outboundNow = new Set(homeStop.imports.map((m) => m.good));
  const policy = colonyStockPolicy({ ...decision.stockReads(), outboundNow });
  const bands = heldBands(world, ctx, env.terrain);
  const holding = (good: number) => {
    const band = bands.holding(good);
    band.sync();
    return band.index;
  };
  const { atColony, atHome } = routeMarks(policy, (good) =>
    settlementGround(world, ctx, env.terrain, trader, home, away, good, holding).units(),
  );
  return [
    ...markOrders(trader, away, awayStop.imports, atColony),
    ...markOrders(trader, home, homeStop.imports, atHome),
  ];
}

/** Carriers seated on the ship as the trader's helpers while it lies at home: spare men of home outside
 *  `taken`, each taking the carrier's trade first. Those chosen join `taken`. */
function seatHelpers(env: ColonyEnv, trader: Entity, ship: Entity, taken: Set<Entity>): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const carrier = jobWhere(ctx, isCarrierJobId);
  const home = homeLandOf(env);
  if (carrier === null || !mooredOn(env, ship, home)) return [];
  const state = world.get(ship, Vehicle);
  const seated = vehiclePassengers(state).filter((r) => r.entity !== trader).length;
  const free = state.passengers.length - vehiclePassengers(state).length;
  const want = Math.min(ROUTE_HELPERS - seated, free - (world.has(trader, Position) ? 1 : 0));
  if (want <= 0) return [];
  const chosen = sparePartyMen(world, ctx, seat, home)
    .filter((e) => e !== trader && !taken.has(e))
    .slice(0, want);
  for (const e of chosen) taken.add(e);
  return chosen.flatMap((e): PlayerCommand[] => [
    ...(world.get(e, Settler).jobType === carrier
      ? []
      : [{ kind: 'setJob', entity: e, jobType: carrier } as const]),
    { kind: 'attachToVehicle', entity: e, vehicle: ship },
  ]);
}

/** A cart of the seat's for a trader ashore with none, while the ship has a vehicle slot free: the largest
 *  hold first, then ascending id. */
function cartOrder(env: ColonyEnv, trader: Entity, ship: Entity): PlayerCommand[] {
  const { world, ctx, seat } = env;
  if (world.has(trader, HaulingCart) || !world.has(trader, Position)) return [];
  if (!world.get(ship, Vehicle).vehicles.includes(null)) return [];
  const vehicles = contentIndex(ctx.content).vehicles;
  let best: { readonly e: Entity; readonly hold: number } | null = null;
  for (const e of vehicleIndex(world).ownedBy(seat)) {
    const type = vehicles.get(world.get(e, Vehicle).vehicleType);
    if (type === undefined || !isCartType(type) || !canTakeHaulingCart(world, ctx, trader, e)) continue;
    if (best === null || type.stockSlots > best.hold) best = { e, hold: type.stockSlots };
  }
  return best === null ? [] : [{ kind: 'attachToVehicle', entity: trader, vehicle: best.e }];
}

/** The houses `slot`'s trader already plies between, then the first route's: a relief takes the same stops. */
function heldStops(env: ColonyEnv, slot: RouteSlot, trader: Entity): Entity[] {
  const { world, colony } = env;
  const own = (world.tryGet(trader, TradeRoute)?.stops ?? []).map((s) => s.house);
  const first = slot === 'relief' ? (colony.route?.trader ?? null) : null;
  const firstStops =
    first === null || !world.isAlive(first) ? [] : (world.tryGet(first, TradeRoute)?.stops ?? []);
  return [...own, ...firstStops.map((s) => s.house)];
}

/**
 * What one of a colony's routes does this decision. A route with no ship takes one; a ship not yet pinned
 * comes home and lets its riders off; a home man who has earned the trade takes it; the ship is pinned to
 * him, his route runs from home's store to the colony's level-3 warehouse, both standing for their
 * settlements, with the marks of the colony's stock policy, issued only as they change; on the workforce
 * beat carriers are seated as helpers and a cart goes to the trader. The route leaves alone the men the
 * decision has already spoken for.
 */
function runRouteSlot(env: ColonyEnv, slot: RouteSlot, decision: RouteDecision): PlayerCommand[] {
  const { taken } = decision;
  const { world, ctx, seat, colony } = env;
  const route = colony[slot];
  if (route === null || route.ship === null) {
    claimShip(env, colony, slot);
    return [];
  }
  const ship = route.ship;
  if (!world.has(ship, Vehicle) || strandedShip(world, ctx, seat, ship)) {
    const live = env.edit()[slot];
    if (live !== null) live.ship = null;
    return [];
  }
  noteRoute(env, colony, route, ship, slot);
  const { trader, commands } = keepTrader(env, env.colony[slot] ?? route, slot, taken);
  const pinned = trader !== null && world.tryGet(trader, TradeShip)?.vehicle === ship;
  if (!pinned) {
    const home = shipHome(env, colony, ship);
    if (home.length > 0 || trader === null) return [...commands, ...home];
    if (!canPinTradeShip(world, ctx, trader, ship)) return commands;
    return [...commands, { kind: 'setTradeShip', entity: trader, ship }];
  }
  const stops = stopsOf(env, colony, heldStops(env, slot, trader));
  if (stops === null) return commands;
  const orders = [
    ...commands,
    ...stopOrders(trader, world.tryGet(trader, TradeRoute), stops.home, stops.colony),
  ];
  if (orders.length > 0) return orders;
  orders.push(...syncMarks(env, decision, trader, stops.home, stops.colony));
  if (slot === 'route') noteBehind(env, trader, ship, stops.home, stops.colony);
  if (moduleBeatDue(ctx.tick - POPULATION_PHASE, seat, WORKFORCE_EVERY_DECISIONS))
    orders.push(...seatHelpers(env, trader, ship, taken), ...cartOrder(env, trader, ship));
  return orders;
}

/** What a colony's routes do this decision: the first, and the relief once raised. Neither takes the
 *  other's trader, held or chosen just now, nor a helper the other seated this decision. */
export function runRoute(env: ColonyEnv): PlayerCommand[] {
  const taken = new Set<Entity>();
  let reads: ColonyStockReads | null = null;
  const decision: RouteDecision = { taken, stockReads: () => (reads ??= colonyStockReadsOf(env)) };
  const reliefTrader = env.colony.relief?.trader ?? null;
  if (reliefTrader !== null) taken.add(reliefTrader);
  const orders = runRouteSlot(env, 'route', decision);
  if (env.colony.relief === null) return orders;
  // The relief may choose its own trader again; the first route left him alone.
  if (reliefTrader !== null) taken.delete(reliefTrader);
  const firstTrader = env.colony.route?.trader ?? null;
  if (firstTrader !== null) taken.add(firstTrader);
  orders.push(...runRouteSlot(env, 'relief', decision));
  return orders;
}

/** The units the marks still ask to move that the giving side spares: of each mark at the colony, what the
 *  colony lacks of its `upTo` past what home holds above its `keep`; of each mark at home, what the colony
 *  holds above its `keep`. */
export function routeBacklog(
  atColony: readonly DeepReadonly<TradeImportMark>[],
  atHome: readonly DeepReadonly<TradeImportMark>[],
  colonyHeld: (good: number) => number,
  homeHeld: (good: number) => number,
): number {
  let units = 0;
  for (const mark of atColony)
    units += Math.max(0, Math.min(mark.upTo - colonyHeld(mark.good), homeHeld(mark.good) - mark.keep));
  for (const mark of atHome) units += Math.max(0, colonyHeld(mark.good) - mark.keep);
  return units;
}

/** Whether a route measurably cannot keep up: it unloaded within the last round, so its ship is at work,
 *  and still the marks ask more than its hold carries in one trip. */
export function routeBehind(backlog: number, hold: number, delivered: number | null, tick: number): boolean {
  return backlog > hold && delivered !== null && tick - delivered <= ROUTE_ROUND_TICKS;
}

/** On the marks beat, keep the first route's record of how long it has been behind, and raise the relief
 *  once that is {@link RELIEF_AFTER_TICKS}: a second trader and ship, which the decisions after take up. */
function noteBehind(env: ColonyEnv, trader: Entity, ship: Entity, home: Entity, away: Entity): void {
  const { world, ctx, seat, colony } = env;
  if (colony.relief !== null || colony.route === null) return;
  if (!moduleBeatDue(ctx.tick - POPULATION_PHASE, seat, MARKS_EVERY_DECISIONS)) return;
  const stops = world.tryGet(trader, TradeRoute)?.stops ?? [];
  const atHome = stops.find((s) => s.house === home)?.imports ?? [];
  const atColony = stops.find((s) => s.house === away)?.imports ?? [];
  const held = storesHeld(env, colonyBuildings(env));
  const homeStock = homeStockOf(world, ctx, seat);
  const backlog = routeBacklog(
    atColony,
    atHome,
    (g) => held.get(g) ?? 0,
    (g) => homeStock.units(g),
  );
  const hold = contentIndex(ctx.content).vehicles.get(world.get(ship, Vehicle).vehicleType)?.stockSlots ?? 0;
  const behind = routeBehind(backlog, hold, colony.delivered, ctx.tick);
  const since = behind ? (colony.route.behindSince ?? ctx.tick) : null;
  if (since !== colony.route.behindSince) {
    const live = env.edit().route;
    if (live !== null) live.behindSince = since;
  }
  if (since !== null && ctx.tick - since >= RELIEF_AFTER_TICKS)
    env.edit().relief = newRoute(ctx.tick, null, 0);
}

/** One route let go: the helpers off the ship, so it lies free for a ferry, the ship unpinned and the
 *  trader back to a civilian. A helper aboard at sea stays seated. */
function releaseOne(env: ColonyEnv, route: RouteView): PlayerCommand[] {
  const { world, ctx } = env;
  const trader = route.trader;
  const state = route.ship === null ? undefined : world.tryGet(route.ship, Vehicle);
  const helpersOff = (state === undefined ? [] : vehiclePassengers(state))
    .filter((seat) => seat.entity !== trader)
    .map((seat): PlayerCommand => ({ kind: 'detachFromVehicle', entity: seat.entity }));
  if (
    trader === null ||
    !world.isAlive(trader) ||
    !isTraderJob(ctx.content, world.tryGet(trader, Settler)?.jobType ?? null)
  )
    return helpersOff;
  return [
    ...helpersOff,
    { kind: 'setTradeShip', entity: trader, ship: null },
    { kind: 'setJob', entity: trader, jobType: CIVILIST_JOB },
  ];
}

/** The colony lets its routes go, the relief with the first. */
export function releaseRoute(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { route, relief } = colony;
  if (route === null && relief === null) return [];
  const live = env.edit();
  live.route = null;
  live.relief = null;
  return [
    ...(route === null ? [] : releaseOne(env, route)),
    ...(relief === null ? [] : releaseOne(env, relief)),
  ];
}
