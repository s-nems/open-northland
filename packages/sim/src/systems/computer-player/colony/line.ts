import { BUILDING_KIND } from '@open-northland/data';
import type { ColonyLine, ColonyLineLeg } from '../../../components/ai/colony.js';
import {
  Building,
  Female,
  Vehicle,
  VehicleStock,
  vehicleCommander,
  vehiclePassengers,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { homeBuildings, homeSettlers } from '../../ai-shared/home-roster.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { isEdibleFoodIn } from '../../readviews/index.js';
import { stockAtBuildings } from '../../stores/index.js';
import { DEFAULT_BUILD_ORDER } from '../build-order/entries.js';
import { seatBuildOrder } from '../build-order/seat-order.js';
import { sitesShortfalls } from '../build-order/upgrade-supply.js';
import { computerProfileOf } from '../difficulty.js';
import { minutesToTicks } from '../game-phase.js';
import { LANDING_SAIL_TIMEOUT_TICKS, otherShore } from '../military/operations/landing.js';
import { FOOD_COMFORT_UNITS_PER_SETTLER, storedFoodUnits } from '../workforce/food.js';
import { SeatSupply } from '../workforce/supply.js';
import { holdDone, holdFlushed, holdLoad, pinHold } from './cargo.js';
import { type CargoLine, homewardCargo, LINE_CARGO_MOST, type OutwardRead, outwardCargo } from './demand.js';
import { colonists } from './founding.js';
import { boardOrders, sparePartyMen, topUpParty } from './people.js';
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
/** The goods home wants of a colony, first of all. Owner ruling: wood and stone. */
const STAPLE_GOOD_IDS: readonly string[] = ['wood', 'stone'];
/** What a colony keeps in store for people who wear or draw it (authored): no bill or shelf sizes it. */
const COLONY_STOCK_GOODS: readonly { readonly id: string; readonly units: number }[] = [
  { id: 'shoes', units: 5 },
];
/** How long a hold may stand unchanged before the ship goes with what it has (authored). */
const LEG_STALL_TICKS = minutesToTicks(2);
/** How long a ship may sail one leg (authored: a landing's sail limit). */
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
  const commands: PlayerCommand[] = riders
    .filter((e) => !crew.includes(e))
    .map((entity) => ({ kind: 'detachFromVehicle', entity }));
  if (colony.berth !== null) commands.push(dock(ship, colony.berth));
  return commands;
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

/** Whether the hold has stood unchanged past {@link LEG_STALL_TICKS}. */
export function stalled(env: ColonyEnv, line: LineView): boolean {
  return env.ctx.tick - line.lastLoad >= LEG_STALL_TICKS;
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

/** The line gives its ship up where it lies: moored, the crew step off, and the seat owes a new one. */
export function releaseLine(env: ColonyEnv, line: LineView): PlayerCommand[] {
  const mooring = mooringOf(env.world, line.ship);
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
  /** What the colony's standing warehouses hold, by good. */
  readonly held: ReadonlyMap<number, number>;
  /** What its open sites and next build still want, by good. */
  readonly owed: ReadonlyMap<number, number>;
}

function colonyStores(env: ColonyEnv, colony: ColonyView): ColonyStores {
  const { world, ctx, seat } = env;
  const index = contentIndex(ctx.content);
  const buildings = colonyBuildings(env);
  const stores = buildings.filter(
    (e) =>
      isBuilt(world, e) &&
      index.buildings.get(world.get(e, Building).buildingType)?.kind === BUILDING_KIND.storage,
  );
  const owed = sitesShortfalls(world, ctx, buildings);
  const next = colony.builds.find((b) => !b.placed);
  const type = next === undefined ? undefined : index.buildingTypeBySlug.get(next.building);
  for (const line of type === undefined ? [] : (index.constructionBillByBuilding.get(type) ?? []))
    owed.set(line.goodType, (owed.get(line.goodType) ?? 0) + line.amount);
  return { buildings, held: stockAtBuildings(world, seat, stores), owed };
}

function homeSupply(env: ColonyEnv): SeatSupply {
  const { world, ctx, seat } = env;
  const order = seatBuildOrder(world, ctx, seat, DEFAULT_BUILD_ORDER, computerProfileOf(world, seat));
  return SeatSupply.of(world, ctx, seat, homeBuildings(world, ctx, seat), order);
}

/** What the colony's standing buildings want in store: a shelf of each workshop input, and its
 *  {@link COLONY_STOCK_GOODS}. */
function standingWants(env: ColonyEnv, buildings: readonly Entity[]): Map<number, number> {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const wants = new Map<number, number>();
  for (const { id, units } of COLONY_STOCK_GOODS) {
    const good = goodTypeByContentId(ctx.content, id);
    if (good !== undefined) wants.set(good.typeId, units);
  }
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
function homeSpare(env: ColonyEnv, supply: SeatSupply): (good: number) => number {
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
  const { buildings, held, owed } = colonyStores(env, colony);
  const read: OutwardRead = {
    room: cargoRoom(env, line),
    food: foodLine(ctx),
    foodHeld: storedFoodUnits(ctx.content, { units: (good) => held.get(good) ?? 0 }),
    mouths: colonists(env).length,
    owed,
    held,
    wanted: standingWants(env, buildings),
    spare: homeSpare(env, homeSupply(env)),
  };
  return outwardCargo(read);
}

/** The load the colony owes home now. */
function homewardLoad(env: ColonyEnv, colony: ColonyView, line: LineView): CargoLine[] {
  const { ctx } = env;
  const { buildings, held, owed } = colonyStores(env, colony);
  const supply = homeSupply(env);
  const staples = STAPLE_GOOD_IDS.flatMap((id) => goodTypeByContentId(ctx.content, id)?.typeId ?? []);
  const kept = standingWants(env, buildings);
  const finished = [...held.keys()]
    .filter((good) => !staples.includes(good) && !kept.has(good) && !isEdibleFoodIn(ctx.content, good))
    .sort((a, b) => a - b);
  return homewardCargo({
    room: cargoRoom(env, line),
    staples,
    held,
    owed,
    lackToComfort: (good) => supply.lackToComfort(good),
    lackToGlut: (good) => {
      const glut = supply.lines(good)?.glut;
      return glut === undefined ? 0 : Math.max(0, glut - (supply.surplus(good) ?? 0));
    },
    finished,
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

/** Hire the crew's shortfall from home, then the settlers the colony still lacks, in the seats left. */
function boardHome(env: ColonyEnv, line: LineView): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const home = homeLandOf(env);
  const hired =
    line.crew.length < LINE_CREW ? hireCrew(env, line, sparePartyMen(world, ctx, seat, home)) : [];
  const people = colonists(env);
  const men = people.filter((e) => isAllocatableMan(world, ctx, e)).length + line.crew.length;
  const women = people.filter((e) => world.has(e, Female)).length;
  const seats = world.tryGet(line.ship, Vehicle)?.passengers.length ?? 0;
  const free = seats - ridersOf(world, line.ship).length - hired.length;
  const party = topUpParty(world, ctx, seat, home, { men, women }, free).filter((e) => !hired.includes(e));
  if (party.length > 0) env.edit().rest.push(...party);
  return boardOrders(world, [...hired, ...party], line.ship);
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
  return [...boardHome(env, line), ...orders];
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

/** The ship `sail`s for `land`: arrived, `arrive`; refused or stopped short, the land's next shore. */
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
  if (ctx.tick - line.since >= LINE_SAIL_TICKS) return releaseLine(env, line);
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
  const { world } = env;
  const line = colony.line;
  if (line === null) return claimShip(env, colony);
  if (!world.has(line.ship, Vehicle)) {
    env.edit().line = null;
    return [];
  }
  noteLine(env, line);
  const ship = line.ship;
  const home = homeLandOf(env);
  switch (line.leg) {
    case 'sailHome':
      return sail(env, colony, line, 'berth', home, () => {
        enterLeg(env, 'unloadHome');
        return flushOrders(env, line);
      });
    case 'unloadHome':
      return holdFlushed(world, ship) || stalled(env, line) ? beginHomeLoad(env, colony, line) : [];
    case 'loadHome': {
      if (!holdDone(world, ship) && !stalled(env, line)) return [];
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
      enterLeg(env, 'loadColony');
      return wantOrders(ship, load);
    }
    case 'loadColony': {
      if (!holdDone(world, ship) && !stalled(env, line)) return [];
      if (colony.berth === null) return [];
      enterLeg(env, 'sailHome');
      return [...pinHold(world, ship), dock(ship, colony.berth)];
    }
  }
}
