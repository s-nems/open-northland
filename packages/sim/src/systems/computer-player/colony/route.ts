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
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { isCarrierJobId, isTraderJobId } from '../../../core/content-index/jobs.js';
import { contentIndex } from '../../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistance } from '../../../nav/halfcell.js';
import { moduleBeatDue, POPULATION_PHASE, WORKFORCE_EVERY_DECISIONS } from '../../ai-shared/cadence.js';
import { buildingTypeByContentId, tiersAtOrAbove } from '../../ai-shared/content-lookup.js';
import { homeBuildings, homeSettlers } from '../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { isAdultSettler } from '../../family/eligibility.js';
import { CIVILIST_JOB } from '../../lifecycle/ageclass.js';
import { canChooseJob, needSubjectOf } from '../../progression/index.js';
import { isFighterJob, isTraderJob } from '../../readviews/index.js';
import { canPinTradeShip } from '../../trade/ship.js';
import { isCartType } from '../../vehicles/drag.js';
import { canTakeHaulingCart } from '../../vehicles/hauling-cart.js';
import { vehicleIndex } from '../../vehicles/registry.js';
import { minutesToTicks } from '../game-phase.js';
import { nodeOfEntity } from '../military/operations/raid-target.js';
import { strandedShip } from '../sea-route.js';
import { sailOrders } from './ferry.js';
import { colonists } from './founding.js';
import { sparePartyMen, standsOn } from './people.js';
import { lineWayClear, withDanger } from './sea-danger.js';
import { colonyBuildings } from './spot.js';
import { type ColonyStockPolicy, colonyStockPolicyOf } from './stock-policy.js';
import {
  type ColonyEnv,
  type ColonyView,
  carryingShip,
  homeLandOf,
  lyingStill,
  mooredOn,
  mooringOf,
  unloadAt,
} from './voyage.js';

// A colony's goods go by a trader of the seat's (owner ruling): a home man takes the trade, a ship is pinned
// to his route between a home warehouse and the colony's, both standing for their settlements, and the marks
// follow the colony's stock policy. Everything is a player's command.

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
 *  that fell with the ship at home is a delivery. Only a change writes. */
function noteRoute(env: ColonyEnv, colony: ColonyView, route: RouteView, ship: Entity): void {
  const { world, ctx } = env;
  const hull = world.tryGet(ship, Health)?.hitpoints ?? 0;
  const load = routeLoad(world, ship, route.trader);
  if (hull === route.hull && load === route.load) return;
  if (hull < route.hull) {
    const at = nodeOfEntity(world, ship);
    const dangers = at === null ? null : withDanger(colony.dangers, at, ctx.tick);
    if (dangers !== null) env.edit().dangers = dangers;
  }
  if (load < route.load && mooredOn(env, ship, homeLandOf(env))) env.edit().delivered = ctx.tick;
  const live = env.edit().route;
  if (live === null) return;
  live.hull = hull;
  live.load = load;
}

/** The colony takes `ship` for its route: the founding ship once its hold is out, or a free one at home. */
export function takeRouteShip(env: ColonyEnv, ship: Entity): void {
  const { world, ctx } = env;
  const live = env.edit();
  const hull = world.tryGet(ship, Health)?.hitpoints ?? 0;
  if (live.route === null) live.route = { trader: null, chosen: ctx.tick, ship, hull, load: 0 };
  else Object.assign(live.route, { ship, hull, load: 0 });
}

/** A route with no ship takes a free one at home while a way clear of the fire that took the last remains. */
function claimShip(env: ColonyEnv, colony: ColonyView): void {
  if (!lineWayClear(env.terrain, colony.dangers, colony.berth, colony.shore)) return;
  const ship = carryingShip(env);
  if (ship !== null) takeRouteShip(env, ship);
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

/** The man at home who takes the trade: one who has earned it, standing on home's land and living there, a
 *  wed man first, then a spare one, then ascending id. */
function traderFor(env: ColonyEnv, trader: number): Entity | null {
  const { world, ctx, seat } = env;
  const home = homeLandOf(env);
  const spare = new Set(sparePartyMen(world, ctx, seat, home));
  const homes = new Set(homeBuildings(world, ctx, seat));
  const able = homeSettlers(world, ctx, seat).filter(
    (e) =>
      canHelm(env, e) &&
      livesAtHome(world, homes, e) &&
      !isTraderJob(ctx.content, world.get(e, Settler).jobType) &&
      standsOn(world, ctx, e, home) &&
      canChooseJob(world, ctx, needSubjectOf(world, e), trader),
  );
  // A man wed at home goes on living there; an unwed one could take a wife on the colony and be called over.
  const rank = (e: Entity): number => (world.has(e, Marriage) ? 0 : 2) + (spare.has(e) ? 0 : 1);
  return able.reduce<Entity | null>((best, e) => (best === null || rank(e) < rank(best) ? e : best), null);
}

/** Keep the route's trader: a dead one, or one who has not taken the trade in time, is let go and the next
 *  is chosen; null while none is a trader yet. */
function keepTrader(env: ColonyEnv, route: RouteView): { trader: Entity | null; commands: PlayerCommand[] } {
  const { world, ctx } = env;
  const job = jobWhere(ctx, isTraderJobId);
  if (job === null) return { trader: null, commands: [] };
  const held = route.trader;
  if (held !== null && world.isAlive(held)) {
    if (isTraderJob(ctx.content, world.get(held, Settler).jobType)) return { trader: held, commands: [] };
    if (ctx.tick - route.chosen < TRADE_TAKE_UP_TICKS) return { trader: null, commands: [] };
  }
  const next = traderFor(env, job);
  const live = env.edit().route;
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
function stopsOf(env: ColonyEnv, colony: ColonyView): { home: Entity; colony: Entity } | null {
  const { world, ctx, seat } = env;
  const there = colonyBuildings(env).filter((e) => routeStore(env, e));
  const at = colony.shore ?? colony.site;
  const away = nearest(env, there, at);
  const stores = homeBuildings(world, ctx, seat).filter((e) => isStore(env, e));
  const topStores = stores.filter((e) => routeStore(env, e));
  const berth = colony.berth ?? colony.site;
  const home = nearest(env, topStores.length > 0 ? topStores : stores, berth);
  return away === null || home === null ? null : { home, colony: away };
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

/** The trader's marks for `policy`: inbound at the colony's stop, outbound at home's with no ceiling. */
export function routeMarks(policy: ColonyStockPolicy): {
  readonly atColony: TradeImportMark[];
  readonly atHome: TradeImportMark[];
} {
  return {
    atColony: policy.inbound.map(({ good, upTo, keep }) => ({ good, upTo, keep })),
    atHome: policy.outbound.map(({ good, keep }) => ({ good, upTo: TRADE_LIMIT_NONE, keep })),
  };
}

/** Sync the marks on the stops with the colony's policy, on its beat or while the colony's stop has none. */
function syncMarks(env: ColonyEnv, trader: Entity, home: Entity, away: Entity): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const route = world.tryGet(trader, TradeRoute);
  const homeStop = route?.stops.find((s) => s.house === home);
  const awayStop = route?.stops.find((s) => s.house === away);
  if (homeStop === undefined || awayStop === undefined) return [];
  const due = moduleBeatDue(ctx.tick - POPULATION_PHASE, seat, MARKS_EVERY_DECISIONS);
  if (!due && awayStop.imports.length > 0) return [];
  const policy = colonyStockPolicyOf(env, new Set(homeStop.imports.map((m) => m.good)));
  const { atColony, atHome } = routeMarks(policy);
  return [
    ...markOrders(trader, away, awayStop.imports, atColony),
    ...markOrders(trader, home, homeStop.imports, atHome),
  ];
}

/** Carriers seated on the ship as the trader's helpers while it lies at home: spare men of home, each taking
 *  the carrier's trade first. */
function seatHelpers(env: ColonyEnv, trader: Entity, ship: Entity): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const carrier = jobWhere(ctx, isCarrierJobId);
  const home = homeLandOf(env);
  if (carrier === null || !mooredOn(env, ship, home)) return [];
  const state = world.get(ship, Vehicle);
  const seated = vehiclePassengers(state).filter((r) => r.entity !== trader).length;
  const free = state.passengers.length - vehiclePassengers(state).length;
  const want = Math.min(ROUTE_HELPERS - seated, free - (world.has(trader, Position) ? 1 : 0));
  if (want <= 0) return [];
  return sparePartyMen(world, ctx, seat, home)
    .filter((e) => e !== trader)
    .slice(0, want)
    .flatMap((e): PlayerCommand[] => [
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

/**
 * What a colony's route does this decision. A route with no ship takes one; a ship not yet pinned comes home
 * and lets its riders off; a home man who has earned the trade takes it; the ship is pinned to him, his route
 * runs from home's store to the colony's level-3 warehouse, both standing for their settlements, with the
 * marks of the colony's stock policy, issued only as they change; on the workforce beat carriers are seated
 * as helpers and a cart goes to the trader.
 */
export function runRoute(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const route = colony.route;
  if (route === null || route.ship === null) {
    claimShip(env, colony);
    return [];
  }
  const ship = route.ship;
  if (!world.has(ship, Vehicle) || strandedShip(world, ctx, seat, ship)) {
    const live = env.edit().route;
    if (live !== null) live.ship = null;
    return [];
  }
  noteRoute(env, colony, route, ship);
  const { trader, commands } = keepTrader(env, env.colony.route ?? route);
  const pinned = trader !== null && world.tryGet(trader, TradeShip)?.vehicle === ship;
  if (!pinned) {
    const home = shipHome(env, colony, ship);
    if (home.length > 0 || trader === null) return [...commands, ...home];
    if (!canPinTradeShip(world, ctx, trader, ship)) return commands;
    return [...commands, { kind: 'setTradeShip', entity: trader, ship }];
  }
  const stops = stopsOf(env, colony);
  if (stops === null) return commands;
  const orders = [
    ...commands,
    ...stopOrders(trader, world.tryGet(trader, TradeRoute), stops.home, stops.colony),
  ];
  if (orders.length > 0) return orders;
  orders.push(...syncMarks(env, trader, stops.home, stops.colony));
  if (moduleBeatDue(ctx.tick - POPULATION_PHASE, seat, WORKFORCE_EVERY_DECISIONS))
    orders.push(...seatHelpers(env, trader, ship), ...cartOrder(env, trader, ship));
  return orders;
}

/** The colony lets its route go: the ship unpinned and the trader back to a civilian. */
export function releaseRoute(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx } = env;
  const route = colony.route;
  if (route === null) return [];
  env.edit().route = null;
  const trader = route.trader;
  if (
    trader === null ||
    !world.isAlive(trader) ||
    !isTraderJob(ctx.content, world.get(trader, Settler).jobType)
  )
    return [];
  return [
    { kind: 'setTradeShip', entity: trader, ship: null },
    { kind: 'setJob', entity: trader, jobType: CIVILIST_JOB },
  ];
}
