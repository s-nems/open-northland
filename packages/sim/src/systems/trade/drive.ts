import {
  Building,
  Carrying,
  dropFallenTradeStops,
  isForeignHouse,
  Position,
  Rider,
  TRADE_LIMIT_NONE,
  TRADE_ROUTE_HOUSES,
  type TradeAgreement,
  type TradeImportMark,
  TradeRoute,
  type TradeRouteView,
  type TradeStop,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistance, nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, SystemContext } from '../context.js';
import { interactionNode, vehicleAnchor } from '../footprint/index.js';
import { countsAsOwnStock, roomFor, stockOf, typeStoresGood } from '../missions/stock.js';
import { atomicDuration } from '../readviews/animations.js';
import { edibleGoodFormOf, isFoodKeptAtHome } from '../readviews/food.js';
import { isTraderJob } from '../readviews/jobs.js';
import {
  atOrWalk,
  collectAtomicOf,
  PILEUP_ATOMIC_ID,
  startAtomic,
  startRefillWait,
} from '../settlers/atomics/start.js';
import { fetchHaulingCart } from '../settlers/drives/economy/hauling-cart.js';
import { doorHeapRoom, doorHeapUnits } from '../settlers/drives/economy/workshop/door-heap.js';
import type { PlannerContext } from '../settlers/planner/context.js';
import { interactionCell } from '../settlers/targets/index.js';
import { LendableTally, storageLendable } from '../settlers/targets/stores/storage-reserve.js';
import { isUnreachableGoal, unreachableGoals } from '../settlers/unreachable-goals.js';
import { mayFetchGoodFrom } from '../stores/index.js';
import { haulingCartLiftTicks, parkHaulingCart } from '../vehicles/hauling-cart.js';
import { activeAgreement } from './agreements.js';
import { planCrossing, planShipOrder, seaLegOf, takeStopAtHand } from './ferry.js';
import { sameFoodClass } from './goods.js';
import { cartStands, NO_HELPERS, TRADE_CART_HOUSE_DISTANCE, type TraderHold, traderHoldOf } from './hold.js';
import { refillRestores } from './partner-stock.js';
import { pileUnitsOf, settlementHouses, settlementPiles, standsForSettlement } from './settlement.js';
import { routeCrossesSea, stopContinent } from './ship.js';

/** A unit the trader moves at a stop: loaded out of `from`, the stop's house or a house of its
 *  settlement, or unloaded into the stop's house. */
type StopWork =
  | { readonly kind: 'load'; readonly good: number; readonly from: Entity }
  | { readonly kind: 'unload'; readonly good: number; readonly into: Entity | null };

type NextStop = { readonly kind: 'next' };

/** What the trader does next at its current stop. */
type TradeAction = StopWork | NextStop | { readonly kind: 'wait' };

const NEXT: NextStop = { kind: 'next' };
const WAIT: TradeAction = { kind: 'wait' };

/** The stop the trader loads at, with what choosing a source there reads. `exclude` is the other stop's
 *  house, which a settlement never loads out of. `countsSettlement` and `otherCountsSettlement` say
 *  whether this stop and the other one stand for their settlements in this decision; `members` and
 *  `piles` hold the settlement houses and ground piles read so far, by anchor and good, so one decision
 *  reads each settlement once per good. */
interface LoadScope {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly terrain: TerrainGraph;
  readonly trader: Entity;
  readonly hold: TraderHold;
  readonly stop: DeepReadonly<TradeStop>;
  readonly exclude: Entity;
  readonly countsSettlement: boolean;
  readonly otherCountsSettlement: boolean;
  members: Map<string, readonly Entity[]> | undefined;
  piles: Map<string, readonly Entity[]> | undefined;
}

/**
 * TRADER - a trader with a valid route works it on foot, a unit in its hands a trip, or with the hauling
 * cart it pulls as its tool: at each stop it stands the cart within {@link TRADE_CART_HOUSE_DISTANCE} of
 * the door, unloads what the stop takes and loads what the other stop wants, then takes the cart up and
 * walks it over. Between the player's own houses the import marks decide what moves; at a foreign house
 * the chosen agreement does, give first, then take. A trader with fewer than two standing houses, a
 * foreign stop with no valid agreement, or a seat on a vehicle is left to the rungs below; so is a unit in
 * its hands that neither own stop takes, which the delivery rung banks elsewhere. Original
 * behavior of the trader's job, except that the original's trader commands its cart and idles without
 * one (owner's choice). Approximation: the original's trader carries every unit between the house and
 * the cart's door; here the load and unload clips at the house move the unit straight into and out of
 * the standing cart. A route across the sea with a pinned ship goes by that ship (`ferry.ts`), and a
 * pinned ship holding the player's order takes its trader off everything else.
 */
export function planTrader(plan: PlannerContext): boolean {
  const { world, ctx, entity: e } = plan;
  if (!isTraderJob(ctx.content, plan.jobType) || world.has(e, Rider)) return false;
  if (planShipOrder(plan, waitWithLoad)) return true;
  if (!world.has(e, TradeRoute) || !routeStandsFinished(world, e)) return false;
  if (world.get(e, TradeRoute).current < 0) world.mut(e, TradeRoute).current = 0;
  takeStopAtHand(plan);
  const current = world.get(e, TradeRoute);
  const stop = current.stops[current.current];
  const other = current.stops[1 - current.current];
  if (stop === undefined || other === undefined) return false;

  const hold = traderHoldOf(world, ctx, e);
  // A unit in the hands of a trader with a cart, one the ground refused, goes to the delivery rung first.
  if (hold.cart !== null && world.has(e, Carrying)) return false;
  const leg = seaLegOf(plan, current);
  if (leg !== null) {
    const here = (held: TraderHold): LoadScope => loadScope(plan, held, stop, other);
    return planCrossing(plan, leg, hold, {
      decide: (held) => decide(here(held), current, held, other),
      setsOut: (held) => setsOutForOtherStop(plan, held, stop, other),
      work: (near, action) => workStop(plan, near, stop.house, action),
      wait: (near) => waitWithLoad(plan, near),
    });
  }
  const action = decide(loadScope(plan, hold, stop, other), current, hold, other);
  if (routeCrossesSea(world, ctx, plan.terrain, e)) {
    // No ship is pinned to the crossing: what the hold carries for this island's stop still lands, but
    // nothing is loaded for a stop no walk reaches, and the trader idles.
    const onIsland = stopContinent(world, ctx, plan.terrain, stop) === plan.terrain.componentOf(plan.here);
    return onIsland && action.kind === 'unload' && workStop(plan, hold, stop.house, action);
  }
  switch (action.kind) {
    case 'wait':
      return waitWithLoad(plan, hold);
    case 'load':
    case 'unload':
      return workStop(plan, hold, stop.house, action);
    case 'next':
      break;
  }
  if (!isForeignHouse(world, e, stop.house) && !isForeignHouse(world, e, other.house)) {
    // Original behavior: an own stop with nothing to move hands the turn to the other one, and the trader
    // sets out only once that stop has a unit to load or unload.
    const there = decideDomestic(loadScope(plan, hold, other, stop), hold, stop);
    if (there.kind === 'next') return false;
    world.mut(e, TradeRoute).current = 1 - current.current;
    return workStop(plan, hold, other.house, there);
  }
  // The cart goes along: one standing at this stop is taken up before the trader sets out.
  if (cartStands(world, hold)) return fetchHaulingCart(plan);
  if (failedToReach(plan, other.house)) return waitWithLoad(plan, hold);
  world.mut(e, TradeRoute).current = 1 - current.current;
  walkTo(plan, other.house, () => {});
  return true;
}

/** Whether a stop done with its work hands over to the other stop now: an own route once work waits
 *  there, a foreign route at once. */
function setsOutForOtherStop(
  plan: PlannerContext,
  hold: TraderHold,
  stop: DeepReadonly<TradeStop>,
  other: DeepReadonly<TradeStop>,
): boolean {
  const { world, entity: e } = plan;
  if (isForeignHouse(world, e, stop.house) || isForeignHouse(world, e, other.house)) return true;
  // The helpers work this stop; the question is about the other one.
  const there = { ...hold, helpers: NO_HELPERS };
  return decideDomestic(loadScope(plan, there, other, stop), there, stop).kind !== 'next';
}

function loadScope(
  plan: PlannerContext,
  hold: TraderHold,
  stop: DeepReadonly<TradeStop>,
  other: DeepReadonly<TradeStop>,
): LoadScope {
  return scopeAt(plan.world, plan.ctx, plan.terrain, plan.entity, hold, stop, other);
}

function scopeAt(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  trader: Entity,
  hold: TraderHold,
  stop: DeepReadonly<TradeStop>,
  other: DeepReadonly<TradeStop>,
): LoadScope {
  return {
    world,
    ctx,
    terrain,
    trader,
    hold,
    stop,
    exclude: other.house,
    countsSettlement: countsSettlement(world, ctx, terrain, trader, stop),
    otherCountsSettlement: countsSettlement(world, ctx, terrain, trader, other),
    members: undefined,
    piles: undefined,
  };
}

/** Whether `at` stands for its settlement in this decision; a stop without the flag reads nothing. */
function countsSettlement(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  trader: Entity,
  at: DeepReadonly<TradeStop>,
): boolean {
  if (!at.settlement) return false;
  const stops = world.get(trader, TradeRoute).stops;
  const index = stops.findIndex((s) => s.house === at.house);
  return standsForSettlement(world, ctx, terrain, trader, stops, index);
}

/** Move one unit at the stop whose house is `stopHouse`, at the house the unit moves at: a cart standing
 *  away from that house is taken up first, one in hand is stood beside it on arrival. */
function workStop(plan: PlannerContext, hold: TraderHold, stopHouse: Entity, work: StopWork): boolean {
  const { world, ctx, entity: e } = plan;
  const house = work.kind === 'load' ? work.from : stopHouse;
  if (cartStands(world, hold) && !holdNearHouse(world, ctx, e, hold, house)) return fetchHaulingCart(plan);
  if (failedToReach(plan, house)) return waitWithLoad(plan, hold);
  walkTo(plan, house, () => {
    parkHaulingCart(world, ctx, e);
    if (work.kind === 'load') {
      const atomicId = collectAtomicOf(world, ctx, house);
      startAtomic(
        world,
        e,
        atomicId,
        { kind: 'tradeLoad', from: house, goodType: work.good },
        haulingCartLiftTicks(world, ctx.content, e, atomicDuration(ctx.content, plan, atomicId)),
        house,
      );
      return;
    }
    startAtomic(
      world,
      e,
      PILEUP_ATOMIC_ID,
      { kind: 'tradeUnload', store: work.into, goodType: work.good },
      haulingCartLiftTicks(world, ctx.content, e, atomicDuration(ctx.content, plan, PILEUP_ATOMIC_ID)),
      work.into,
    );
  });
  return true;
}

/** A trader waiting at a stop with route goods in its hands keeps them there through the wait, which the
 *  delivery rung below would otherwise carry off to a store; one with free hands, or its goods in the
 *  cart, is left to the rungs below. */
function waitWithLoad(plan: PlannerContext, hold: TraderHold): boolean {
  if (hold.cart !== null || hold.load <= 0) return false;
  startRefillWait(plan.world, plan.ctx, plan.entity);
  return true;
}

function houseDoor(world: World, ctx: SystemContext, house: Entity): HalfCellNode | null {
  const door = interactionNode(world, ctx, house);
  return door === null ? null : { hx: door.x, hy: door.y };
}

/** Where the trader's hold is: the standing cart's anchor, else the trader's own node. */
function holdPoint(world: World, trader: Entity, hold: TraderHold): HalfCellNode | null {
  if (hold.cart !== null && cartStands(world, hold)) return vehicleAnchor(world, hold.cart);
  const pos = world.tryGet(trader, Position);
  return pos === undefined ? null : nodeOfPosition(pos.x, pos.y);
}

/** Whether the trader's hold is within {@link TRADE_CART_HOUSE_DISTANCE} steps of the house's door. */
function holdNearHouse(
  world: World,
  ctx: SystemContext,
  trader: Entity,
  hold: TraderHold,
  house: Entity,
): boolean {
  const at = holdPoint(world, trader, hold);
  const door = houseDoor(world, ctx, house);
  return at !== null && door !== null && hexDistance(at, door) <= TRADE_CART_HOUSE_DISTANCE;
}

/** Whether a walk to the house's work cell failed lately: the trader waits out its failed-goal memo
 *  there rather than searching the same path again on every stranded retry. */
function failedToReach(plan: PlannerContext, house: Entity): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  return isUnreachableGoal(
    unreachableGoals(world, ctx, e),
    interactionCell(world, ctx, terrain, house, here),
  );
}

function walkTo(plan: PlannerContext, house: Entity, start: () => void): void {
  const { world, ctx, terrain, entity: e, here } = plan;
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, house, here), start);
}

/** Drop the stops whose house fell; reports whether a full route of finished houses is left to work. A
 *  house being upgraded holds the trader until it stands finished again. */
export function routeStandsFinished(world: World, e: Entity): boolean {
  dropFallenTradeStops(world, e);
  const { stops } = world.get(e, TradeRoute);
  return (
    stops.length === TRADE_ROUTE_HOUSES &&
    stops.every((stop) => world.get(stop.house, Building).built === ONE)
  );
}

function decide(
  scope: LoadScope,
  route: TradeRouteView,
  hold: TraderHold,
  other: DeepReadonly<TradeStop>,
): TradeAction {
  const { world, ctx, trader, stop } = scope;
  const foreign = isForeignHouse(world, trader, stop.house);
  if (!foreign && !isForeignHouse(world, trader, other.house)) return decideDomestic(scope, hold, other);
  const agreement = activeAgreement(world, trader, route);
  if (agreement === undefined) return carryHomeWhileNoAgreement(scope, hold, foreign);
  return foreign
    ? decideExchange(world, ctx, trader, route, hold, stop.house, agreement)
    : decidePreparation(scope, route, hold, agreement);
}

/**
 * A route whose agreement does not hold waits for it, its goods kept aboard a cart. A trader on foot
 * brings what its hands hold home first, so the unit is not held through the wait.
 */
function carryHomeWhileNoAgreement(scope: LoadScope, hold: TraderHold, foreign: boolean): TradeAction {
  const held = hold.cart === null ? hold.entries[0] : undefined;
  if (held === undefined) return WAIT;
  return foreign ? NEXT : (unloadAtHome(scope, held[0]) ?? WAIT);
}

/**
 * Whether the hold is too small for one whole exchange, the give goods out or the take goods back (the
 * hands; a small cart against a large agreement): the trader then shuttles the exchange over several
 * trips, the route's `given` and `received` carrying it from one to the next (owner's choice; the
 * original's trader waits for room it never gets).
 */
function shuttles(hold: TraderHold, agreement: DeepReadonly<TradeAgreement>): boolean {
  return hold.capacity < Math.max(agreement.giveAmount, agreement.takeAmount);
}

/**
 * At the player's own house before a foreign trip: clear the hold of everything but the give good into
 * the house, then load give goods while the hold has room for the whole exchange and the house (or its
 * settlement) has spare; leave once a batch is aboard. Original behavior (reading): the room test keeps
 * space for the take goods every aboard batch will bring back. A {@link shuttles} hold loads what the
 * exchange still lacks as far as it fits, and leaves empty while take goods are still owed. The player's
 * two limits are this build's own (owner's choice): the give goods load only above `giveKeep`, and no
 * batch starts once the take goods at home plus what the batches aboard bring back reach `takeUpTo`. A
 * full home takes the rest onto the ground by its door; once no ground there has room no batch starts,
 * and what home cannot take waits aboard.
 */
function decidePreparation(
  scope: LoadScope,
  route: TradeRouteView,
  hold: TraderHold,
  agreement: DeepReadonly<TradeAgreement>,
): TradeAction {
  const { world, ctx, stop } = scope;
  const strays = hold.entries.filter(([good]) => !sameFoodClass(ctx, good, agreement.giveGood));
  for (const [good] of strays) {
    const unload = unloadAtHome(scope, good);
    if (unload !== null) return unload;
  }
  // Goods home cannot take wait aboard until it can.
  if (strays.length > 0) return WAIT;
  const aboard = aboardOfClass(ctx, hold, agreement.giveGood);
  const shuttle = shuttles(hold, agreement);
  if (shuttle && route.given >= agreement.giveAmount) return NEXT;
  const give = Math.max(1, agreement.giveAmount);
  const extra = Math.max(0, agreement.takeAmount - agreement.giveAmount);
  const batchesAboard = Math.floor(aboard / give);
  const toCompleteBatch = give - (aboard % give);
  const fits = shuttle
    ? hold.room > 0 && route.given + aboard < agreement.giveAmount
    : (batchesAboard + 1) * extra + toCompleteBatch <= hold.room;
  const startsBatch = shuttle ? route.given + aboard === 0 : aboard % give === 0;
  const filled =
    startsBatch &&
    ((route.takeUpTo !== TRADE_LIMIT_NONE &&
      homeStockOf(scope, agreement.takeGood) + batchesAboard * agreement.takeAmount >= route.takeUpTo) ||
      unloadAtHome(scope, edibleGoodFormOf(ctx.content, agreement.takeGood)) === null);
  if (fits && !filled && !isFoodKeptAtHome(world, ctx, stop.house, agreement.giveGood)) {
    const source = loadSourceOf(scope, agreement.giveGood, route.giveKeep);
    if (source !== undefined && hold.carries(source.good)) return { kind: 'load', ...source };
  }
  return aboard >= (shuttle ? 1 : agreement.giveAmount) ? NEXT : WAIT;
}

/**
 * At the foreign house: hand the give goods over one by one, then take the agreed goods aboard, then
 * start over while another batch is aboard; go home when the hold runs out or fills up, or when the
 * house runs out of the take good mid-batch (what was handed over stays given, as the original's goods
 * vanish into the house). A {@link shuttles} hold hands over whatever give goods it holds. Nothing is
 * handed over while the house holds fewer take goods than one batch pays out, where the original
 * delivers regardless: the trader waits at the house for its seat's refill instead, so one trip sells the
 * whole load (owner's choice). At a house no refill tops up again, whose take good the hold cannot carry,
 * or with no room for the give good, a trader with only give goods aboard waits there, one with anything
 * else aboard carries it home first.
 */
function decideExchange(
  world: World,
  ctx: SystemContext,
  trader: Entity,
  route: TradeRouteView,
  hold: TraderHold,
  house: Entity,
  agreement: DeepReadonly<TradeAgreement>,
): TradeAction {
  const aboard = aboardOfClass(ctx, hold, agreement.giveGood);
  const batch = shuttles(hold, agreement) ? 1 : agreement.giveAmount;
  const stocked = stockedFormAt(world, ctx, house, agreement.takeGood);
  const onOffer =
    stocked === undefined
      ? 0
      : Math.min(stockOf(world, house, stocked), storageLendable(world, ctx, house, stocked));
  if (route.given < agreement.giveAmount) {
    if (aboard + route.given < Math.min(batch + route.given, agreement.giveAmount)) return NEXT;
    const otherAboard = hold.entries.some(([good]) => !sameFoodClass(ctx, good, agreement.giveGood));
    // A hold that cannot take the take good would hand the give goods over for nothing.
    if (stocked !== undefined && !hold.carries(stocked)) return otherAboard ? NEXT : WAIT;
    if (route.given === 0 && onOffer < agreement.takeAmount) {
      if (refillRestores(world, ctx, house, agreement.takeGood, agreement.takeAmount)) return WAIT;
      return otherAboard ? NEXT : WAIT;
    }
    // The hold keeps a dish as its edible, so the unit handed over is whichever aboard good the
    // agreement's give good matches.
    const giving = hold.entries.find(([good]) => sameFoodClass(ctx, good, agreement.giveGood));
    if (giving === undefined) return NEXT;
    const slot = storableFormAt(world, ctx, house, giving[0]);
    // A house with no room for the give good: going home with only give goods aboard brings the same
    // load straight back.
    if (slot === undefined || roomFor(world, ctx, house, slot) <= 0) return otherAboard ? NEXT : WAIT;
    return { kind: 'unload', good: giving[0], into: house };
  }
  if (route.received < agreement.takeAmount) {
    if (hold.room <= 0) return NEXT;
    if (stocked === undefined || !hold.carries(stocked) || onOffer <= 0) {
      resetExchange(world, trader);
      return NEXT;
    }
    return { kind: 'load', good: stocked, from: house };
  }
  resetExchange(world, trader);
  return aboard >= batch
    ? decideExchange(world, ctx, trader, world.get(trader, TradeRoute), hold, house, agreement)
    : NEXT;
}

/** The units aboard that answer for `good`: the good itself, or a dish's edible form of its class. */
function aboardOfClass(ctx: ContentContext, hold: TraderHold, good: number): number {
  let total = 0;
  for (const [aboard, amount] of hold.entries) if (sameFoodClass(ctx, aboard, good)) total += amount;
  return total;
}

function resetExchange(world: World, trader: Entity): void {
  const live = world.mut(trader, TradeRoute);
  live.given = 0;
  live.received = 0;
}

/**
 * Between the player's own houses the import marks decide what moves (original behavior, except where
 * noted):
 * - A good marked at this stop and not at the other is unloaded here; one marked at the other stop only
 *   stays aboard for it; one neither stop marks is unloaded at the first stop that stores it.
 * - A good marked at the other stop only is loaded while this stop has a spare unit and the other has
 *   room for it beside what is aboard.
 * - A good both stops mark is balanced: it is loaded while this stop holds more than the other plus
 *   what is aboard, and unloaded while the other stop holds more (score `(here - there - aboard) / 2`).
 * - A mark limits the flow into its own stop: nothing is unloaded there once the stop holds `upTo`
 *   units, nothing is loaded for it once its stock plus what is aboard reaches `upTo`, the heap by its
 *   door counted toward the ceiling, and loading for it leaves `keep` units in the other stop, each
 *   counting what a pinned ship's helpers have under way.
 *   A balanced good is two such flows, each limited by the mark at the stop it flows into.
 *   Approximation: `keep` stands in for the original's per-house minimum stock setting, and the `upTo`
 *   ceiling is this build's own addition (owner's choice).
 * - A stop standing for its settlement (our own extension) loads out of the whole settlement, and its
 *   stock in every rule above is the settlement's, the goods lying loose on its ground included (owner
 *   ruling); what it takes in still goes into its house.
 * - With no mark on either stop nothing moves. The original then balances every good; this build waits
 *   for the player's marks instead (owner's choice).
 * Food is never taken out of a home. Approximations: the original ranks candidates by the houses'
 * request counters, which this build does not keep, so the lowest good id goes first; and it keeps
 * "home enhancer" goods out of a home, a good class the content does not flag.
 */
function decideDomestic(
  scope: LoadScope,
  hold: TraderHold,
  other: DeepReadonly<TradeStop>,
): StopWork | NextStop {
  const { world, ctx, stop } = scope;
  const markOf = (at: DeepReadonly<TradeStop>, good: number): TradeImportMark | undefined => {
    const edible = edibleGoodFormOf(ctx.content, good);
    return at.imports.find((mark) => mark.good === good || mark.good === edible);
  };
  const hereType = world.get(stop.house, Building).buildingType;
  const { helpers } = hold;

  for (const [good, aboard] of hold.entries) {
    const slot = storableFormAt(world, ctx, stop.house, good);
    const coming = helpers.toHouse(good);
    if (slot === undefined) continue;
    const wantedHere = markOf(stop, good);
    const wantedThere = markOf(other, good);
    if (wantedThere !== undefined && wantedHere === undefined) continue;
    const full = roomFor(world, ctx, stop.house, slot) - coming <= 0;
    // Owner ruling: a full store does not stop goods marked for it coming ashore; they go onto the ground by
    // its door while the ground there has room, as a workshop's door heap. Not original behavior.
    if (full && (wantedHere === undefined || wantedThere !== undefined)) continue;
    if (full && heapRoomAt(scope, stop.house, good) - coming <= 0) continue;
    const held =
      (wantedHere !== undefined && scope.countsSettlement
        ? homeStockOf(scope, good)
        : stockOf(world, stop.house, slot)) + coming;
    if (
      wantedHere !== undefined &&
      reachesCeiling(scope, wantedHere, stop.house, good, held, scope.countsSettlement)
    )
      continue;
    if (wantedHere !== undefined && wantedThere !== undefined) {
      const there = storableFormAt(world, ctx, other.house, good);
      const shortfall = (there === undefined ? 0 : otherStockOf(scope, other, good)) - held;
      if (there !== undefined && Math.floor((aboard + shortfall) / 2) <= 0) continue;
    }
    return { kind: 'unload', good, into: full ? null : stop.house };
  }

  if (hold.room <= 0) return NEXT;
  for (const good of ownGoodsOf(ctx, hereType)) {
    const wantedThere = markOf(other, good);
    if (wantedThere === undefined || isFoodKeptAtHome(world, ctx, stop.house, good)) continue;
    const carried = edibleGoodFormOf(ctx.content, good);
    if (!hold.carries(carried)) continue;
    const slot = storableFormAt(world, ctx, other.house, carried);
    if (slot === undefined) continue;
    const aboard = hold.amount(carried);
    // A full other stop still takes a good marked only there, onto the ground by its door.
    if (
      roomFor(world, ctx, other.house, slot) - aboard <= 0 &&
      (markOf(stop, good) !== undefined || heapRoomAt(scope, other.house, carried) - aboard <= 0)
    )
      continue;
    const bound = otherStockOf(scope, other, carried) + hold.amount(carried);
    if (reachesCeiling(scope, wantedThere, other.house, carried, bound, scope.otherCountsSettlement))
      continue;
    const leaving = helpers.toLift(carried);
    if (markOf(stop, good) !== undefined) {
      if (scope.countsSettlement) {
        // A balanced good weighs the two settlements, so the load may come out of any of this one's houses.
        if (Math.floor((homeStockOf(scope, good) - leaving - bound) / 2) <= 0) continue;
        const source = loadSourceOf(scope, good, wantedThere.keep + leaving);
        if (source !== undefined) return { kind: 'load', ...source };
        continue;
      }
      if (spareOf(world, ctx, stop.house, good) - wantedThere.keep - leaving <= 0) continue;
      if (Math.floor((stockOf(world, stop.house, good) - leaving - bound) / 2) <= 0) continue;
      return { kind: 'load', good, from: stop.house };
    }
    const source = loadSourceOf(scope, good, wantedThere.keep + leaving);
    if (source !== undefined) return { kind: 'load', ...source };
  }
  return NEXT;
}

/** {@link decideDomestic} at `stop` over `hold`, as a helper of `trader`'s pinned ship asks it. */
export function decideForHelper(
  plan: PlannerContext,
  trader: Entity,
  hold: TraderHold,
  stop: DeepReadonly<TradeStop>,
  other: DeepReadonly<TradeStop>,
): StopWork | NextStop {
  return decideDomestic(scopeAt(plan.world, plan.ctx, plan.terrain, trader, hold, stop, other), hold, other);
}

/** A house to load one unit of a good out of, and the form it holds the good in. */
interface LoadSource {
  readonly from: Entity;
  readonly good: number;
}

/**
 * Where the stop loads a unit of `good` while `keep` units stay at home: out of the stop's house while it
 * spares one, else, at a settlement stop, out of the settlement house nearest the hold that spares one
 * (ties by id), skipping houses the trader failed to reach. A settlement keeps `keep` summed over its
 * houses, and a house the hold already stands at goes first, so a unit dropped into the storehouse
 * meanwhile does not call the trader back from a settlement house it is still emptying. Undefined when
 * nothing may leave.
 */
function loadSourceOf(scope: LoadScope, good: number, keep: number): LoadSource | undefined {
  const { world, ctx, terrain, trader, hold, stop } = scope;
  const homeSpare = spareOf(world, ctx, stop.house, good);
  const homeForm = stockedFormAt(world, ctx, stop.house, good);
  const fromHome = homeForm === undefined ? undefined : { from: stop.house, good: homeForm };
  if (!scope.countsSettlement) return homeSpare - keep >= 1 ? fromHome : undefined;
  const atHome = holdNearHouse(world, ctx, trader, hold, stop.house);
  if (homeSpare - keep >= 1 && atHome) return fromHome;
  const members = membersOf(scope, stop.house, scope.exclude, good);
  const settlementSpare = new LendableTally(world, ctx);
  tallyStock(world, ctx, settlementSpare, stop.house, good);
  for (const house of members) tallyStock(world, ctx, settlementSpare, house, good);
  for (const pile of pilesOf(scope, stop.house, scope.exclude, good))
    settlementSpare.add(pile, good, pileUnitsOf(world, ctx, pile, good));
  if (settlementSpare.total() - keep < 1) return undefined;
  if (homeSpare >= 1 && atHome) return fromHome;
  const anchor = holdPoint(world, trader, hold);
  const failed = unreachableGoals(world, ctx, trader);
  let best: { readonly house: Entity; readonly distance: number } | undefined;
  for (const house of members) {
    if (spareOf(world, ctx, house, good) < 1) continue;
    const door = houseDoor(world, ctx, house);
    if (door === null || isUnreachableGoal(failed, terrain.nodeAtClamped(door.hx, door.hy))) continue;
    const distance = anchor === null ? 0 : hexDistance(anchor, door);
    // Members run ascending by id, so a later house wins only when strictly nearer.
    if (best === undefined || distance < best.distance) best = { house, distance };
  }
  const form = best === undefined ? undefined : stockedFormAt(world, ctx, best.house, good);
  const fromMember = best === undefined || form === undefined ? undefined : { from: best.house, good: form };
  if (best !== undefined && best.distance <= TRADE_CART_HOUSE_DISTANCE) return fromMember;
  return homeSpare >= 1 ? fromHome : fromMember;
}

/** The units of `good` the stop holds at home: in its house, plus its settlement's houses at a stop
 *  standing for its settlement. */
function homeStockOf(scope: LoadScope, good: number): number {
  return stockOfStop(scope, scope.stop.house, scope.exclude, scope.countsSettlement, good);
}

/** {@link homeStockOf} of the route's other stop, whose settlement leaves this stop's house out. */
function otherStockOf(scope: LoadScope, other: DeepReadonly<TradeStop>, good: number): number {
  return stockOfStop(scope, other.house, scope.stop.house, scope.otherCountsSettlement, good);
}

function stockOfStop(
  scope: LoadScope,
  house: Entity,
  exclude: Entity,
  wholeSettlement: boolean,
  good: number,
): number {
  const { world, ctx } = scope;
  const held = (at: Entity, form: number | undefined): number =>
    form === undefined ? 0 : stockOf(world, at, form);
  let total = held(house, storableFormAt(world, ctx, house, good));
  if (!wholeSettlement) return total;
  for (const member of membersOf(scope, house, exclude, good)) {
    total += held(member, stockedFormAt(world, ctx, member, good));
  }
  for (const pile of pilesOf(scope, house, exclude, good)) total += pileUnitsOf(world, ctx, pile, good);
  return total;
}

/** {@link settlementHouses} of `anchor` for `good`, walked once per decision. */
function membersOf(scope: LoadScope, anchor: Entity, exclude: Entity, good: number): readonly Entity[] {
  const key = `${anchor}:${good}`;
  scope.members ??= new Map();
  let members = scope.members.get(key);
  if (members === undefined) {
    members = settlementHouses(scope.world, scope.ctx, scope.terrain, scope.trader, anchor, exclude, good);
    scope.members.set(key, members);
  }
  return members;
}

/** {@link settlementPiles} of `anchor` for `good`, read once per decision. */
function pilesOf(scope: LoadScope, anchor: Entity, exclude: Entity, good: number): readonly Entity[] {
  const key = `${anchor}:${good}`;
  scope.piles ??= new Map();
  let piles = scope.piles.get(key);
  if (piles === undefined) {
    piles = settlementPiles(scope.world, scope.ctx, scope.terrain, scope.trader, anchor, exclude, good);
    scope.piles.set(key, piles);
  }
  return piles;
}

/** The units of `good` the ground by `house`'s door still takes. */
function heapRoomAt(scope: LoadScope, house: Entity, good: number): number {
  const { world, ctx, terrain } = scope;
  return doorHeapRoom(world, ctx, terrain, interactionCell(world, ctx, terrain, house), good);
}

/** Whether `units` in (or bound for) a mark's stop at `house` reach the mark's `upTo` ceiling. A stop that
 *  counts its whole settlement has its ground in `units` already; another adds what of `good` lies heaped
 *  by the house's door, where the stop's goods go once its shelf is full. */
function reachesCeiling(
  scope: LoadScope,
  mark: DeepReadonly<TradeImportMark>,
  house: Entity,
  good: number,
  units: number,
  settlementWide: boolean,
): boolean {
  if (mark.upTo === TRADE_LIMIT_NONE) return false;
  if (units >= mark.upTo) return true;
  if (settlementWide) return false;
  const { world, ctx, terrain } = scope;
  const heaped = doorHeapUnits(world, terrain, interactionCell(world, ctx, terrain, house), good);
  return units + heaped >= mark.upTo;
}

/** Unloading `good` at the stop's own house: onto its shelf while it has room, else onto the ground by its
 *  door while that has room (owner ruling: a full store does not block unloading, as a workshop's door
 *  heap); null once neither has. */
function unloadAtHome(scope: LoadScope, good: number): StopWork | null {
  const { world, ctx, stop } = scope;
  const slot = storableFormAt(world, ctx, stop.house, good);
  if (slot !== undefined && roomFor(world, ctx, stop.house, slot) > 0) {
    return { kind: 'unload', good, into: stop.house };
  }
  return heapRoomAt(scope, stop.house, good) > 0 ? { kind: 'unload', good, into: null } : null;
}

/** The goods a house type counts as its own stock, ascending: what a trader may take out of it. */
function ownGoodsOf(ctx: ContentContext, buildingType: number): number[] {
  const stored = contentIndex(ctx.content).storedGoodsByBuilding.get(buildingType);
  if (stored === undefined) return [];
  return [...stored].filter((good) => countsAsOwnStock(ctx, buildingType, good)).sort((a, b) => a - b);
}

/** The units of `good` a house can give up: its own stock, none of it while its recipe consumes the
 *  good (the reserve it runs on), and no more than its owner's storage minimum lets go. Approximation of
 *  the original's per-house minimum stock setting. */
function spareOf(world: World, ctx: SystemContext, house: Entity, good: number): number {
  const stocked = fetchableFormAt(world, ctx, house, good);
  if (stocked === undefined) return 0;
  return Math.min(stockOf(world, house, stocked), storageLendable(world, ctx, house, stocked));
}

/** Adds a house's stock of `good` to a settlement's tally, which caps it by the owner's minimum once
 *  across the owner's storehouses rather than once per house as {@link spareOf} does. */
function tallyStock(
  world: World,
  ctx: SystemContext,
  tally: LendableTally,
  house: Entity,
  good: number,
): void {
  const stocked = fetchableFormAt(world, ctx, house, good);
  if (stocked !== undefined) tally.add(house, stocked, stockOf(world, house, stocked));
}

/** {@link stockedFormAt} when the house may give that form up at all. */
function fetchableFormAt(world: World, ctx: SystemContext, house: Entity, good: number): number | undefined {
  const stocked = stockedFormAt(world, ctx, house, good);
  return stocked !== undefined && mayFetchGoodFrom(world, ctx, house, stocked) ? stocked : undefined;
}

/** The good a house answers a request for `good` with out of its own stock: the good itself, else the
 *  first dish of its edible class the house makes (a bakery gives bread for `food_simple`). */
function stockedFormAt(world: World, ctx: ContentContext, house: Entity, good: number): number | undefined {
  const type = world.get(house, Building).buildingType;
  if (countsAsOwnStock(ctx, type, good)) return good;
  const index = contentIndex(ctx.content);
  const stored = index.storedGoodsByBuilding.get(type);
  if (stored === undefined) return undefined;
  for (const candidate of [...stored].sort((a, b) => a - b)) {
    if (countsAsOwnStock(ctx, type, candidate) && sameFoodClass(ctx, candidate, good)) return candidate;
  }
  return undefined;
}

/** The slot a house takes `good` into, on any of its shelves, inputs included; undefined with none. */
export function storableFormAt(
  world: World,
  ctx: ContentContext,
  house: Entity,
  good: number,
): number | undefined {
  const type = world.get(house, Building).buildingType;
  if (typeStoresGood(ctx, type, good)) return good;
  const edible = edibleGoodFormOf(ctx.content, good);
  return edible !== good && typeStoresGood(ctx, type, edible) ? edible : undefined;
}
