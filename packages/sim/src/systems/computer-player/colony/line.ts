import { BUILDING_KIND } from '@open-northland/data';
import type { ColonyLine, ColonyLineLeg } from '../../../components/ai/colony.js';
import {
  Building,
  Female,
  Rider,
  Vehicle,
  VehicleStock,
  vehicleCommander,
  vehiclePassengers,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../nav/halfcell.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { homeBuildings, homeSettlers } from '../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { isAdultSettler } from '../../family/eligibility.js';
import { isEdibleFoodIn } from '../../readviews/index.js';
import { stockAtBuildings } from '../../stores/index.js';
import { seatBaseOf } from '../base.js';
import { DEFAULT_BUILD_ORDER } from '../build-order/entries.js';
import { seatBuildOrder } from '../build-order/seat-order.js';
import { sitesShortfalls } from '../build-order/upgrade-supply.js';
import { computerProfileOf } from '../difficulty.js';
import { minutesToTicks } from '../game-phase.js';
import { LANDING_SAIL_TIMEOUT_TICKS, otherShore } from '../military/operations/landing.js';
import { shorePoints, strandedShip } from '../sea-route.js';
import { FOOD_COMFORT_UNITS_PER_SETTLER, storedFoodUnits } from '../workforce/food.js';
import { SeatSupply } from '../workforce/supply.js';
import { holdDone, holdFlushed, holdLoad, pinHold } from './cargo.js';
import { type CargoLine, homewardCargo, LINE_CARGO_MOST, type OutwardRead, outwardCargo } from './demand.js';
import { colonists, colonyOrigin } from './founding.js';
import { tradesmenFor } from './overflow.js';
import { boardOrders, sparePartyMen, standsOn, topUpParty } from './people.js';
import { billsOf, COLONY_OPEN_SITES, colonyPlan, ladderAhead } from './plan.js';
import { handsWanted, menPastWork } from './posts.js';
import { colonyMakes, LAND_GOOD_IDS, storesHeld, workshopGoods } from './provision.js';
import { colonyBuildings } from './spot.js';
import { homeStockOf } from './stock.js';
import {
  type ColonyEnv,
  type ColonyView,
  carryingShip,
  dock,
  homeLandOf,
  lyingStill,
  mooredOn,
  mooringOf,
  unloadAt,
} from './voyage.js';

export type LineView = DeepReadonly<ColonyLine>;

/** The helm and four hands a line ship keeps aboard (authored: five hands bring 40 units in about three
 *  minutes over 20 nodes). */
const LINE_CREW = 5;
/** The fewest a line sails with: a helm and a hand, what a small party can spare until home fills it. */
const LINE_CREW_LEAST = 2;
/** A party gives the line one hand per this many of its men (authored): a party of 8 keeps its builders. */
const MEN_PER_LINE_HAND = 3;
/** Food kept aboard per hand (authored): an empty hold starves its crew, and two meals outlast a leg. */
const PROVISIONS_PER_HAND = 2;
const FOOD_LINE_ID = 'food_simple';
/** Drawn where it is drunk: a well stands wherever a workshop wants it, so it never sails. */
const WATER_ID = 'water';
/** How long a hold may stand unchanged before the ship goes with what it has (authored). */
const LEG_STALL_TICKS = minutesToTicks(2);
/** How long a stop may load at all (authored): 40 units come aboard in four to six minutes from a store by
 *  the shore, and one seat's ship lay 19 minutes while hands fetched a good a unit at a time from far off
 *  (arabskie_wyspy_wolna_gra_mieszana). */
const LEG_LOAD_TICKS = minutesToTicks(7);
/** The shores near its base a seat weighs for its line's berth (authored). */
const BERTH_CANDIDATES = 6;
/** How long a ship may take over one leg before it is given up at the next mooring (authored: a landing's
 *  sail limit). */
const LINE_SAIL_TICKS = LANDING_SAIL_TIMEOUT_TICKS;

/** The ship's riders, the helm first. */
export function ridersOf(world: World, ship: Entity): Entity[] {
  const state = world.tryGet(ship, Vehicle);
  if (state === undefined) return [];
  const helm = vehicleCommander(state);
  const riders = vehiclePassengers(state)
    .map((seat) => seat.entity)
    .filter((e) => e !== helm && world.isAlive(e));
  return helm === null ? riders : [helm, ...riders];
}

function foodLine(ctx: SystemContext): number | null {
  return goodTypeByContentId(ctx.content, FOOD_LINE_ID)?.typeId ?? null;
}

function provisionsFor(crew: number): number {
  return PROVISIONS_PER_HAND * crew;
}

/** The hold's budget past the crew's food, up to {@link LINE_CARGO_MOST}. */
function cargoRoom(env: ColonyEnv, line: LineView): number {
  const { world, ctx } = env;
  const state = world.tryGet(line.ship, Vehicle);
  const type = state === undefined ? undefined : contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return 0;
  return Math.min(type.stockSlots - provisionsFor(line.crew.length), LINE_CARGO_MOST);
}

/** Who keeps the ship at a landing: the helm and the first men, a third of the colony's. */
function crewOf(world: World, ctx: SystemContext, riders: readonly Entity[], men: number): Entity[] {
  const size = Math.min(LINE_CREW, Math.max(LINE_CREW_LEAST, Math.floor(men / MEN_PER_LINE_HAND)));
  return riders.filter((e, i) => i === 0 || isAllocatableMan(world, ctx, e)).slice(0, size);
}

/** The unloaded colony ship becomes the line: its crew stays seated, every other rider steps ashore and it
 *  sails home for food. */
export function startLine(env: ColonyEnv, colony: ColonyView, ship: Entity): PlayerCommand[] {
  const { world, ctx } = env;
  const riders = ridersOf(world, ship);
  const men = colonists(env).filter((e) => isAllocatableMan(world, ctx, e)).length + riders.length;
  const crew = crewOf(world, ctx, riders, men);
  const live = env.edit();
  live.ship = null;
  live.line = { ship, crew, leg: 'sailHome', since: ctx.tick, load: 0, lastLoad: ctx.tick };
  const berth = homeBerth(env, ship) ?? colony.berth;
  live.berth = berth === null ? null : { hx: berth.hx, hy: berth.hy };
  const commands: PlayerCommand[] = riders
    .filter((e) => !crew.includes(e))
    .map((entity) => ({ kind: 'detachFromVehicle', entity }));
  if (berth !== null) commands.push(dock(ship, berth));
  return commands;
}

/** The home shore nearest one of the seat's standing stores, of those near its base: a hand carries a unit a
 *  trip, and the berth the first ship happened to lie at cost stops of up to ten minutes. */
function homeBerth(env: ColonyEnv, ship: Entity): DeepReadonly<HalfCellNode> | null {
  const { world, ctx, terrain, seat } = env;
  const index = contentIndex(ctx.content);
  const base = seatBaseOf(world, ctx, seat);
  const towards = base === null ? null : anchorNodeOf(world, base);
  if (towards === null) return null;
  const stores = homeBuildings(world, ctx, seat).flatMap((e) => {
    const storage = index.buildings.get(world.get(e, Building).buildingType)?.kind === BUILDING_KIND.storage;
    return storage && isBuilt(world, e) ? (anchorNodeOf(world, e) ?? []) : [];
  });
  const spots = shorePoints(
    world,
    ctx,
    terrain,
    ship,
    homeLandOf(env),
    towards,
    () => true,
    BERTH_CANDIDATES,
  );
  const nearStore = (at: HalfCellNode): number => Math.min(...stores.map((s) => nodeManhattan(s, at)));
  let best: HalfCellNode | null = null;
  for (const at of spots) if (best === null || nearStore(at) < nearStore(best)) best = at;
  return best;
}

/** Start `leg` now. */
export function enterLeg(env: ColonyEnv, leg: ColonyLineLeg): void {
  const live = env.edit().line;
  if (live === null) return;
  live.leg = leg;
  live.since = env.ctx.tick;
  live.load = holdLoad(env.world, live.ship);
  live.lastLoad = env.ctx.tick;
}

/** Whether the leg's load lies aboard, a meal a hand aside. */
function loaded(env: ColonyEnv, line: LineView): boolean {
  return holdDone(env.world, line.ship, foodLine(env.ctx), line.crew.length);
}

/** Whether the hold has stood unchanged past {@link LEG_STALL_TICKS}. */
export function stalled(env: ColonyEnv, line: LineView): boolean {
  return env.ctx.tick - line.lastLoad >= LEG_STALL_TICKS;
}

/** Whether a loading stop is over: the load aboard, or out of patience. */
function doneLoading(env: ColonyEnv, line: LineView): boolean {
  return loaded(env, line) || stalled(env, line) || env.ctx.tick - line.since >= LEG_LOAD_TICKS;
}

/** Keep the record of the hold and the crew: only a change writes, as each write drops the home view. */
function noteLine(env: ColonyEnv, line: LineView): void {
  const { world, ctx } = env;
  const load = holdLoad(world, line.ship);
  const lost = line.crew.some((e) => !world.isAlive(e));
  if (load === line.load && !lost) return;
  const live = env.edit().line;
  if (live === null) return;
  if (load !== live.load) {
    live.load = load;
    live.lastLoad = ctx.tick;
  }
  if (lost) live.crew = live.crew.filter((e) => world.isAlive(e));
}

/** Drop from the colony's lists whoever no ship holds and no colony land bears, as a boarding the door
 *  refused, and `gone` besides: those are home's again. Only a change writes. */
function forgetListed(env: ColonyEnv, colony: ColonyView, gone: readonly Entity[]): void {
  const { world, ctx } = env;
  const stays = (e: Entity): boolean =>
    world.isAlive(e) && !gone.includes(e) && (world.has(e, Rider) || standsOn(world, ctx, e, colony.land));
  if (colony.people.every(stays) && colony.rest.every(stays)) return;
  const live = env.edit();
  live.people = live.people.filter(stays);
  live.rest = live.rest.filter(stays);
}

/** The line gives up its ship, moored where it lies: everyone aboard steps off, home's again, and the seat
 *  owes a new ship. */
export function releaseLine(env: ColonyEnv, line: LineView): PlayerCommand[] {
  const { world } = env;
  const mooring = mooringOf(world, line.ship);
  const riders = ridersOf(world, line.ship);
  forgetListed(env, env.edit(), riders);
  env.edit().line = null;
  return mooring === null ? [] : [unloadAt(line.ship, mooring)];
}

/** Orders that empty the hold down to the crew's food. */
function flushOrders(env: ColonyEnv, line: LineView): PlayerCommand[] {
  const { world, ctx } = env;
  const food = foodLine(ctx);
  const aboard = food === null ? 0 : (world.tryGet(line.ship, VehicleStock)?.lines.get(food)?.current ?? 0);
  const kept = Math.min(aboard, provisionsFor(line.crew.length));
  const commands: PlayerCommand[] = [{ kind: 'clearVehicleWanted', vehicle: line.ship }];
  if (food !== null && kept > 0)
    commands.push({ kind: 'setVehicleWanted', vehicle: line.ship, goodType: food, amount: kept });
  return commands;
}

function wantOrders(ship: Entity, lines: readonly CargoLine[]): PlayerCommand[] {
  return lines.map(({ goodType, amount }) => ({ kind: 'setVehicleWanted', vehicle: ship, goodType, amount }));
}

interface ColonyStores {
  readonly buildings: readonly Entity[];
  /** What the colony's warehouses hold, by good. */
  readonly held: ReadonlyMap<number, number>;
  /** What its open sites and next builds still want, by good. */
  readonly owed: ReadonlyMap<number, number>;
  /** What it keeps of what it holds: those, the rest of its plan and what its workshops work up. */
  readonly kept: ReadonlyMap<number, number>;
  /** What it makes or digs itself. */
  readonly makes: ReadonlySet<number>;
}

function addUp(into: Map<number, number>, units: ReadonlyMap<number, number>): void {
  for (const [good, amount] of units) into.set(good, (into.get(good) ?? 0) + amount);
}

function colonyStores(env: ColonyEnv, colony: ColonyView): ColonyStores {
  const { world, ctx } = env;
  const buildings = colonyBuildings(env);
  const plan = colonyPlan(env, colony, buildings);
  const owed = sitesShortfalls(world, ctx, buildings);
  addUp(owed, billsOf(env, plan.slice(0, COLONY_OPEN_SITES)));
  const kept = new Map(owed);
  addUp(kept, billsOf(env, plan.slice(COLONY_OPEN_SITES)));
  addUp(kept, billsOf(env, ladderAhead(env, colony, buildings)));
  addUp(kept, standingWants(env, buildings));
  const from = colonyOrigin(env, colony, buildings);
  return {
    buildings,
    held: storesHeld(env, buildings),
    owed,
    kept,
    makes: from === null ? new Set() : colonyMakes(env, from, buildings),
  };
}

export function homeSupply(env: ColonyEnv): SeatSupply {
  const { world, ctx, seat } = env;
  const order = seatBuildOrder(world, ctx, seat, DEFAULT_BUILD_ORDER, computerProfileOf(world, seat));
  return SeatSupply.of(world, ctx, seat, homeBuildings(world, ctx, seat), order);
}

/** What the colony's standing buildings want in store: a shelf of each workshop input. */
function standingWants(env: ColonyEnv, buildings: readonly Entity[]): Map<number, number> {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const wants = new Map<number, number>();
  for (const e of buildings) {
    if (!isBuilt(world, e)) continue;
    const type = world.get(e, Building).buildingType;
    const shelves = index.stockSlotCapacityByBuilding.get(type);
    for (const input of index.mergedRecipeByBuilding.get(type)?.inputs ?? [])
      wants.set(input.goodType, Math.max(wants.get(input.goodType) ?? 0, shelves?.get(input.goodType) ?? 0));
  }
  return wants;
}

/** What home can give of `good` and stay at its comfort line; food at its comfort per settler. */
export function homeSpare(env: ColonyEnv, supply: SeatSupply): (good: number) => number {
  const { world, ctx, seat } = env;
  const food = foodLine(ctx);
  const mouths = homeSettlers(world, ctx, seat).length;
  return (good) => {
    if (good === food) {
      const stored = storedFoodUnits(ctx.content, homeStockOf(world, ctx, seat));
      return Math.max(0, stored - FOOD_COMFORT_UNITS_PER_SETTLER * mouths);
    }
    const lines = supply.lines(good);
    const surplus = supply.surplus(good);
    return lines === undefined || surplus === undefined
      ? supply.units(good)
      : Math.max(0, surplus - lines.comfort);
  };
}

/** The load the home side owes the colony now. */
function outwardLoad(env: ColonyEnv, colony: ColonyView, line: LineView): CargoLine[] {
  const { ctx } = env;
  const { buildings, held, owed, makes } = colonyStores(env, colony);
  const read: OutwardRead = {
    room: cargoRoom(env, line),
    food: foodLine(ctx),
    foodHeld: storedFoodUnits(ctx.content, { units: (good) => held.get(good) ?? 0 }),
    mouths: colonists(env).length,
    owed,
    held,
    wanted: standingWants(env, buildings),
    makes,
    spare: homeSpare(env, homeSupply(env)),
  };
  return outwardCargo(read);
}

/** The colony's standing workshops home's order handed it: what they make is why they stand there. */
function handedWorkshops(env: ColonyEnv, colony: ColonyView, buildings: readonly Entity[]): Entity[] {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const handed = new Set(colony.overflow.map((row) => index.buildingTypeBySlug.get(row.building)));
  return buildings.filter((e) => isBuilt(world, e) && handed.has(world.get(e, Building).buildingType));
}

/** `held` and what `workshops` have made and still hold on their shelves. */
function withShelves(
  env: ColonyEnv,
  workshops: readonly Entity[],
  made: ReadonlySet<number>,
  held: ReadonlyMap<number, number>,
): Map<number, number> {
  const units = new Map(held);
  for (const [good, amount] of stockAtBuildings(env.world, env.seat, workshops))
    if (made.has(good)) units.set(good, (units.get(good) ?? 0) + amount);
  return units;
}

/** The load the colony owes home now. */
function homewardLoad(env: ColonyEnv, colony: ColonyView, line: LineView): CargoLine[] {
  const { ctx } = env;
  const { buildings, held, kept } = colonyStores(env, colony);
  const supply = homeSupply(env);
  const staples = LAND_GOOD_IDS.flatMap((id) => goodTypeByContentId(ctx.content, id)?.typeId ?? []);
  const water = goodTypeByContentId(ctx.content, WATER_ID)?.typeId;
  const workshops = handedWorkshops(env, colony, buildings);
  const made = workshopGoods(env, workshops);
  const units = withShelves(env, workshops, made, held);
  const sails = [...units.keys()]
    .filter(
      (good) =>
        !staples.includes(good) &&
        !isEdibleFoodIn(ctx.content, good) &&
        !supply.atGlut(good) &&
        good !== water,
    )
    .sort((a, b) => a - b);
  return homewardCargo({
    room: cargoRoom(env, line),
    staples,
    held: units,
    kept,
    lackToComfort: (good) => supply.lackToComfort(good),
    lackToGlut: (good) => {
      const glut = supply.lines(good)?.glut;
      return glut === undefined ? 0 : Math.max(0, glut - (supply.surplus(good) ?? 0));
    },
    crafted: sails.filter((good) => made.has(good)),
    finished: sails.filter((good) => !made.has(good) && !kept.has(good)),
  });
}

/** Hire `men` to bring the crew to {@link LINE_CREW}, and board them; those hired. */
function hireCrew(env: ColonyEnv, line: LineView, men: readonly Entity[]): Entity[] {
  const riders = ridersOf(env.world, line.ship);
  const hired = men.filter((e) => !riders.includes(e)).slice(0, LINE_CREW - line.crew.length);
  const live = env.edit().line;
  if (live !== null) live.crew.push(...hired);
  return hired;
}

/** A ship that lost every hand takes a crew off the colony's men. */
function crewFromColony(env: ColonyEnv, line: LineView): PlayerCommand[] {
  const { world, ctx } = env;
  if (line.crew.length > 0) return [];
  const men = colonists(env).filter((e) => isAllocatableMan(world, ctx, e));
  return boardOrders(world, hireCrew(env, line, men.slice(0, LINE_CREW_LEAST)), line.ship);
}

/** Hire the crew's shortfall from home, then, in the seats left, the craftsmen no colonist can stand in for,
 *  and the hands the colony lacks for its gatherers, sites and workshops ({@link handsWanted}). */
function boardHome(env: ColonyEnv, colony: ColonyView, line: LineView): PlayerCommand[] {
  const { world, ctx, seat } = env;
  forgetListed(env, colony, []);
  const home = homeLandOf(env);
  const hired =
    line.crew.length < LINE_CREW ? hireCrew(env, line, sparePartyMen(world, ctx, seat, home)) : [];
  const people = colonists(env);
  const men = people.filter((e) => isAllocatableMan(world, ctx, e)).length + line.crew.length;
  const women = people.filter((e) => world.has(e, Female) && isAdultSettler(world, e)).length;
  const seats = world.tryGet(line.ship, Vehicle)?.passengers.length ?? 0;
  const free = seats - ridersOf(world, line.ship).length - hired.length;
  const wanted = handsWanted(env, colony);
  const lacking = { men: wanted.men - men, women: wanted.women - women };
  const trades = tradesmenFor(env, people, home, free);
  const tradesmen = trades.sailing.filter((e) => !hired.includes(e));
  const party = topUpParty(world, ctx, seat, home, lacking, free - tradesmen.length).filter(
    (e) => !hired.includes(e) && !tradesmen.includes(e),
  );
  if (tradesmen.length + party.length > 0) env.edit().rest.push(...tradesmen, ...party);
  return [...trades.lessons, ...boardOrders(world, [...hired, ...tradesmen, ...party], line.ship)];
}

/** The home stop's work begins: settlers board and the hands fetch the outward load and the crew's food. */
function beginHomeLoad(env: ColonyEnv, colony: ColonyView, line: LineView): PlayerCommand[] {
  const { ctx } = env;
  const lines = outwardLoad(env, colony, line);
  const food = foodLine(ctx);
  const cargoFood = lines.find((l) => l.goodType === food)?.amount ?? 0;
  const provisions = provisionsFor(Math.max(line.crew.length, LINE_CREW_LEAST)) + cargoFood;
  const orders = wantOrders(
    line.ship,
    food === null
      ? lines
      : [{ goodType: food, amount: provisions }, ...lines.filter((l) => l.goodType !== food)],
  );
  enterLeg(env, 'loadHome');
  return [...boardHome(env, colony, line), ...orders];
}

/** Whether the ship has a reason to sail: cargo or settlers aboard, or goods waiting over there. */
function worthSailing(env: ColonyEnv, colony: ColonyView, line: LineView): boolean {
  const { world } = env;
  return (
    holdLoad(world, line.ship) > provisionsFor(line.crew.length) ||
    ridersOf(world, line.ship).length > line.crew.length ||
    homewardLoad(env, colony, line).length > 0
  );
}

/** The ship `sail`s for `land`: arrived, `arrive`; refused or stopped short, the land's next shore. Late,
 *  it is released where it lies moored, never at sea, or nobody would let its riders off. */
export function sail(
  env: ColonyEnv,
  colony: ColonyView,
  line: LineView,
  to: 'shore' | 'berth',
  land: number,
  arrive: () => PlayerCommand[],
): PlayerCommand[] {
  const { world, ctx } = env;
  if (mooredOn(env, line.ship, land)) return arrive();
  if (ctx.tick - line.since >= LINE_SAIL_TICKS && mooringOf(world, line.ship) !== null)
    return releaseLine(env, line);
  // A crew lost at sea leaves no helm to bring her in, and the seat a ship owed.
  if (strandedShip(world, ctx, env.seat, line.ship)) return releaseLine(env, line);
  const at = colony[to];
  if (!lyingStill(world, line.ship) || at === null) return [];
  const next = otherShore(env, line.ship, at) ?? at;
  env.edit()[to] = next;
  return [dock(line.ship, next)];
}

/** The colony's riders past the crew step ashore. */
export function landPassengers(env: ColonyEnv, line: LineView): PlayerCommand[] {
  return ridersOf(env.world, line.ship)
    .filter((e) => !line.crew.includes(e))
    .map((entity) => ({ kind: 'detachFromVehicle', entity }));
}

/** A line that lost its ship takes the next free one at home. */
function claimShip(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx } = env;
  if (colony.ship !== null) return [];
  const ship = carryingShip(env);
  const berth = ship === null ? null : mooringOf(world, ship);
  if (ship === null || berth === null) return [];
  const live = env.edit();
  live.berth = { hx: berth.hx, hy: berth.hy };
  live.line = { ship, crew: [], leg: 'loadHome', since: ctx.tick, load: 0, lastLoad: ctx.tick };
  return beginHomeLoad(env, live, live.line);
}

/**
 * What a settled colony's line does this decision. At home it empties the hold down to the crew's food, takes
 * on settlers, the outward load and food, and sails while there is something to carry either way, else it
 * looks again. At the colony it lands its passengers, empties and takes on the homeward load. A leg's hold ends
 * when it is met or stands unchanged past {@link LEG_STALL_TICKS}, and is pinned before each sail, or the hands
 * would fetch and flush at the far shore. A ship lost leaves the seat owing one.
 */
export function runLine(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx } = env;
  const line = colony.line;
  if (line === null) return claimShip(env, colony);
  if (!world.has(line.ship, Vehicle)) {
    env.edit().line = null;
    return [];
  }
  if (line.since === ctx.tick) return [];
  noteLine(env, line);
  const ship = line.ship;
  const home = homeLandOf(env);
  switch (line.leg) {
    case 'sailHome':
      return sail(env, colony, line, 'berth', home, () => {
        enterLeg(env, 'unloadHome');
        return [...landPassengers(env, line), ...flushOrders(env, line)];
      });
    case 'unloadHome':
      return holdFlushed(world, ship) || stalled(env, line) ? beginHomeLoad(env, colony, line) : [];
    case 'loadHome': {
      if (!doneLoading(env, line)) return [];
      if (line.crew.length === 0 || !worthSailing(env, colony, line)) return beginHomeLoad(env, colony, line);
      if (colony.shore === null) return [];
      enterLeg(env, 'sailOut');
      return [...pinHold(world, ship), dock(ship, colony.shore)];
    }
    case 'sailOut':
      return sail(env, colony, line, 'shore', colony.land, () => {
        enterLeg(env, 'unloadColony');
        return [...landPassengers(env, line), ...crewFromColony(env, line), ...flushOrders(env, line)];
      });
    case 'unloadColony': {
      if (!holdFlushed(world, ship) && !stalled(env, line)) return [];
      const load = homewardLoad(env, colony, line);
      const seats = world.get(ship, Vehicle).passengers.length - ridersOf(world, ship).length;
      const homeward = menPastWork(env, colony).slice(0, seats);
      enterLeg(env, 'loadColony');
      return [...boardOrders(world, homeward, ship), ...wantOrders(ship, load)];
    }
    case 'loadColony': {
      if (!doneLoading(env, line)) return [];
      if (colony.berth === null) return [];
      enterLeg(env, 'sailHome');
      return [...pinHold(world, ship), dock(ship, colony.berth)];
    }
  }
}
