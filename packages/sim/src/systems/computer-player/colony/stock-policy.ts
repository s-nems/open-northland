import { BUILDING_KIND, type EquipCategory } from '@open-northland/data';
import { Building, Equipment, type EquipmentData, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { homeBuildings, homeSettlers } from '../../ai-shared/home-roster.js';
import type { SystemContext } from '../../context.js';
import { heldGatherGood } from '../../economy/gather-goods.js';
import { edibleGoodFormOf, mayChangeEquipment } from '../../readviews/index.js';
import { toolHelpsJob } from '../../settlers/planner/assistant-grants.js';
import { stockAtBuildings } from '../../stores/index.js';
import { sitesShortfalls } from '../build-order/upgrade-supply.js';
import { FOOD_COMFORT_UNITS_PER_SETTLER, FOOD_SHORT_UNITS_PER_SETTLER } from '../workforce/food.js';
import type { SeatSupply } from '../workforce/supply.js';
import { colonists, colonyOrigin } from './founding.js';
import { foodGood, homeSpare, homeSupply, workshopShelves } from './home-supply.js';
import { chainStepOf } from './industry.js';
import { colonyIndustryWantsOf } from './industry-read.js';
import { billsOf, COLONY_OPEN_SITES, colonyPlan } from './plan.js';
import { colonyMakes, storesHeld, workshopGoods } from './provision.js';
import { colonyBuildings } from './spot.js';
import type { ColonyEnv, SeatEnv } from './voyage.js';

// What a colony keeps in store and what moves between it and home, whatever carries it. Figures are authored
// unless they say otherwise.

/** Owner ruling: the building materials every colony is filled up to, by content id. */
export const COLONY_BUILDING_FLOOR: Readonly<Record<string, number>> = {
  brick: 15,
  pillar: 15,
  tile: 10,
  ornament: 10,
  wood: 20,
  stone: 20,
  mud: 10,
  wheat: 10,
  iron: 1,
};

/** Owner ruling: the goods a colony's settlers wear or drink, by content id; the iron tool falls back to the
 *  wooden one while home cannot spare enough of it. */
const SHOES_ID = 'shoes';
const MEAD_ID = 'mead';
const TOOL_IRON_ID = 'tool_iron';
const TOOL_WOODEN_ID = 'tool_wooden';
/** A settler good's store past those who still lack one: worn units to replace. */
const SETTLER_GOOD_SPARE = 2;
/** The most a colony stores of a settler good: a store reserve, not a hoard. */
const SETTLER_GOOD_MOST = 12;
/** The food a colonist eats over one trader round, the colony's floor of food per mouth: about 0.18 units
 *  a game minute over a round of about 15 minutes (measured on arabskie_wyspy_wolna_gra_mieszana), so an
 *  import is not eaten before the next one lands. */
const COLONY_FOOD_PER_SETTLER_ROUND = 3;
/** What a colony is brought of each input of its standing workshops that it does not make; one it makes it
 *  keeps up to its shelves. */
export const WORKSHOP_INPUT_FLOOR = 5;
/** Drawn where it is drunk: a well stands wherever a workshop wants it, so it never sails. */
const WATER_ID = 'water';
/** Owner ruling: of a colony joinery's goods only the iron tool goes home; a workshop that makes it is one. */
const JOINERY_EXPORT_ID = TOOL_IRON_ID;
/** Owner ruling: grain and flour never sail home, whether or not a mill or bakery of the colony's takes them
 *  in yet; home grows and grinds its own. */
const NEVER_HOME_IDS = ['wheat', 'flour'] as const;

/** A good the colony is filled up to `upTo`, home keeping `keep` of it. */
export interface InboundMark {
  readonly good: number;
  readonly upTo: number;
  readonly keep: number;
}

/** A good that goes home above the colony's `keep`. */
export interface OutboundMark {
  readonly good: number;
  readonly keep: number;
}

export interface ColonyStockPolicy {
  /** Ascending by good. */
  readonly inbound: readonly InboundMark[];
  readonly outbound: readonly OutboundMark[];
}

type Units = ReadonlyMap<number, number>;

/** One colony's reads, by good type. */
export interface StockPolicyRead {
  /** The building materials of {@link COLONY_BUILDING_FLOOR}, each raised to what the colony's open sites
   *  and next builds still lack. */
  readonly buildingFloor: Units;
  /** {@link COLONY_BUILDING_FLOOR} itself: the floor of a good home lacks, which the colony's open sites do
   *  not raise. */
  readonly plainFloor: Units;
  /** The settler goods and food its people want in store. */
  readonly settlerReserve: Units;
  /** Other goods its buildings want in store, by the units: a temple's holy oil, say
   *  ({@link colonyIndustryWantsOf}). */
  readonly wants: Units;
  /** The inputs of its standing workshops, with the units their shelves take. */
  readonly workshopInputs: Units;
  /** What it makes, gathers or digs itself. */
  readonly makes: ReadonlySet<number>;
  /** What its stores hold. */
  readonly held: Units;
  /** What never leaves it: vehicles and its joinery's goods past the iron tool. */
  readonly keptOnColony: ReadonlySet<number>;
  /** The goods it sends home now: a good it both makes and is filled up to goes one way at a time. */
  readonly outboundNow: ReadonlySet<number>;
  /** What home keeps of a good it sends. */
  readonly homeKeep: (good: number) => number;
  /** The inputs home's workshops lack: a good the colony holds above its floor goes home, made there or not. */
  readonly homeWants: ReadonlySet<number>;
  /** What the colony's standing sites, its industries' among them, still lack of their bills. */
  readonly siteLack: Units;
}

/** What the colony keeps of a workshop input: a small floor brought in, its shelves of one it makes. */
function inputFloor(read: StockPolicyRead, good: number): number {
  const shelves = read.workshopInputs.get(good);
  if (shelves === undefined) return 0;
  return read.makes.has(good) ? Math.max(WORKSHOP_INPUT_FLOOR, shelves) : WORKSHOP_INPUT_FLOOR;
}

/** The colony's floor of `good`: what it is filled up to and keeps when it sends the rest home. */
function floorOf(read: StockPolicyRead, good: number): number {
  // Home's ship yard and sites outrank the colony's own building (owner ruling): of a good home lacks the
  // colony keeps its plain floor, so its builders never stand at none, and the rest goes home.
  const building = read.homeWants.has(good) ? read.plainFloor : read.buildingFloor;
  return Math.max(
    building.get(good) ?? 0,
    read.settlerReserve.get(good) ?? 0,
    read.wants.get(good) ?? 0,
    inputFloor(read, good),
  );
}

/**
 * Per good, which way it moves. Inbound: the building floor always, settler goods and workshop inputs the
 * colony does not make. Outbound: what it makes, anything else it holds that no inbound mark brought, and
 * an input home's workshops lack, so a colony holding clay feeds home's brickworks that build it; never what
 * it keeps. A good on both lists, a building material the colony digs, goes the way its stock
 * stands to the floor, and at the floor the way it went: its keep at the colony is the colony's floor, so
 * units that went one way never come back. Both ways at once would balance the two stores instead, holding
 * the colony's surplus while home holds more. A good the colony's sites lack never goes home, and what they
 * lack past its stores comes past home's keep: the mark asks just that much, with nothing kept, so a site
 * waits on no comfort stock of home's. A good home itself lacks is the exception: the colony keeps its floor.
 */
export function colonyStockPolicy(read: StockPolicyRead): ColonyStockPolicy {
  const inboundGoods = new Set<number>(read.buildingFloor.keys());
  for (const good of [...read.settlerReserve.keys(), ...read.wants.keys(), ...read.workshopInputs.keys()])
    if (!read.makes.has(good)) inboundGoods.add(good);
  const outboundGoods = new Set<number>();
  for (const good of [...read.makes, ...read.held.keys()]) {
    if (read.keptOnColony.has(good)) continue;
    if (inboundGoods.has(good) && !read.makes.has(good) && !read.homeWants.has(good)) continue;
    if (!read.makes.has(good) && (read.held.get(good) ?? 0) <= 0) continue;
    outboundGoods.add(good);
  }
  const inbound: InboundMark[] = [];
  const outbound: OutboundMark[] = [];
  for (const good of [...new Set([...inboundGoods, ...outboundGoods])].sort((a, b) => a - b)) {
    const floor = floorOf(read, good);
    const sends = outboundGoods.has(good);
    const takes = inboundGoods.has(good) && floor > 0;
    const held = read.held.get(good) ?? 0;
    // Home's own lack wins: what its workshops and sites wait on goes home above the colony's floor.
    const lack = read.homeWants.has(good) ? 0 : (read.siteLack.get(good) ?? 0);
    const goesHome =
      sends && lack <= 0 && (!takes || held > floor || (held === floor && read.outboundNow.has(good)));
    if (goesHome) outbound.push({ good, keep: floor });
    else if (takes && lack > held) inbound.push({ good, upTo: lack, keep: 0 });
    else if (takes) inbound.push({ good, upTo: floor, keep: read.homeKeep(good) });
  }
  return { inbound, outbound };
}

/** The goods home's stores hold fewer of than its own workshops' shelves take, its ship yard among them, or
 *  than its sites still lack: what a colony's surplus goes home to feed. */
function homeWantsOf(env: SeatEnv): Set<number> {
  const { world, ctx, seat } = env;
  const index = contentIndex(ctx.content);
  const home = homeBuildings(world, ctx, seat);
  const stores = home.filter(
    (e) => index.buildings.get(world.get(e, Building).buildingType)?.kind === BUILDING_KIND.storage,
  );
  const stored = stockAtBuildings(world, seat, stores);
  const wants = new Set<number>();
  for (const [good, shelves] of workshopShelves(env, home))
    if ((stored.get(good) ?? 0) < shelves) wants.add(good);
  for (const [good, lacking] of sitesShortfalls(world, ctx, home))
    if ((stored.get(good) ?? 0) < lacking) wants.add(good);
  return wants;
}

/** The good types of `ids` the content knows, with their figures. */
function byType(ctx: SystemContext, entries: readonly (readonly [string, number])[]): Map<number, number> {
  const units = new Map<number, number>();
  for (const [id, amount] of entries) {
    const good = goodTypeByContentId(ctx.content, id)?.typeId;
    if (good !== undefined) units.set(good, amount);
  }
  return units;
}

function raise(into: Map<number, number>, units: Units): void {
  for (const [good, amount] of units) into.set(good, Math.max(into.get(good) ?? 0, amount));
}

function addUp(into: Map<number, number>, units: Units): void {
  for (const [good, amount] of units) into.set(good, (into.get(good) ?? 0) + amount);
}

/** Whether `eq` holds a unit of `good` in its slot group. */
function wears(eq: EquipmentData | undefined, group: EquipCategory, good: number): boolean {
  if (eq === undefined) return false;
  if (group === 'misc') return eq.misc.some((slot) => slot !== null && slot.goodType === good);
  return eq[group] !== null;
}

/** How many of `people` would take a unit of `good`: those with no unit in its slot, a tool only for a trade
 *  that works with one. */
export function settlersLacking(env: SeatEnv, people: readonly Entity[], good: number): number {
  const { world, ctx } = env;
  const group = contentIndex(ctx.content).goods.get(good)?.equip?.category;
  if (group === undefined) return 0;
  let lacking = 0;
  for (const e of people) {
    if (!mayChangeEquipment(world, ctx.content, e)) continue;
    const job = world.get(e, Settler).jobType;
    if (group === 'tool' && (job === null || !toolHelpsJob(ctx.content, job))) continue;
    if (!wears(world.tryGet(e, Equipment), group, good)) lacking++;
  }
  return lacking;
}

/** A store reserve of a settler good for `people`: those who lack it and a few spares, bounded. */
function gearReserve(env: SeatEnv, people: readonly Entity[], good: number): number {
  return Math.min(SETTLER_GOOD_MOST, settlersLacking(env, people, good) + SETTLER_GOOD_SPARE);
}

/** The settler goods a colony of `people` wants in store, and its food. The iron tool while home can spare
 *  what the colony lacks, else the wooden one. */
function settlerReserve(
  env: ColonyEnv,
  people: readonly Entity[],
  spare: (good: number) => number,
): Map<number, number> {
  const { ctx } = env;
  const reserve = new Map<number, number>();
  for (const id of [SHOES_ID, MEAD_ID]) {
    const good = goodTypeByContentId(ctx.content, id)?.typeId;
    if (good !== undefined) reserve.set(good, gearReserve(env, people, good));
  }
  const iron = goodTypeByContentId(ctx.content, TOOL_IRON_ID)?.typeId;
  const wooden = goodTypeByContentId(ctx.content, TOOL_WOODEN_ID)?.typeId;
  const tool =
    iron !== undefined && (wooden === undefined || spare(iron) >= settlersLacking(env, people, iron))
      ? iron
      : wooden;
  if (tool !== undefined) reserve.set(tool, gearReserve(env, people, tool));
  const food = foodGood(ctx);
  if (food !== null)
    reserve.set(
      food,
      Math.max(FOOD_COMFORT_UNITS_PER_SETTLER, COLONY_FOOD_PER_SETTLER_ROUND) * Math.max(1, people.length),
    );
  return reserve;
}

/**
 * The intermediate goods the colony's own chain consumes: an input good by the content's flag that one of
 * its standing workshops makes and one of its workshops, standing or a site, takes in, such as wheat for its
 * mill and flour for its bakery (owner ruling: these never go home). Home makes its own, and the ship's room
 * goes to what home lacks.
 */
export function chainIntermediates(env: ColonyEnv, buildings: readonly Entity[]): Set<number> {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const made = workshopGoods(env, buildings);
  const kept = new Set<number>();
  for (const e of buildings) {
    const recipe = index.mergedRecipeByBuilding.get(world.get(e, Building).buildingType);
    for (const { goodType } of recipe?.inputs ?? [])
      if (made.has(goodType) && index.goods.get(goodType)?.classification.inputGood === true)
        kept.add(goodType);
  }
  return kept;
}

/** What never leaves the colony: vehicles, water, what no store of its takes (its livestock), grain and
 *  flour, the intermediates its own chain consumes, and of a workshop that makes the joinery's export, its
 *  other goods. */
function keptOnColony(env: ColonyEnv, buildings: readonly Entity[]): Set<number> {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const stored = new Set<number>();
  for (const e of buildings) {
    const typeId = world.get(e, Building).buildingType;
    if (index.buildings.get(typeId)?.kind !== BUILDING_KIND.storage) continue;
    for (const good of index.storedGoodsByBuilding.get(typeId) ?? []) stored.add(good);
  }
  const water = goodTypeByContentId(ctx.content, WATER_ID)?.typeId;
  const kept = new Set<number>();
  for (const good of ctx.content.goods)
    if (good.vehicleHouse !== undefined || good.typeId === water || !stored.has(good.typeId))
      kept.add(good.typeId);
  for (const good of chainIntermediates(env, buildings)) kept.add(good);
  for (const id of NEVER_HOME_IDS) {
    const good = goodTypeByContentId(ctx.content, id)?.typeId;
    if (good !== undefined) kept.add(good);
  }
  const export_ = goodTypeByContentId(ctx.content, JOINERY_EXPORT_ID)?.typeId;
  for (const e of buildings) {
    const typeId = world.get(e, Building).buildingType;
    if (index.buildings.get(typeId)?.kind !== BUILDING_KIND.workplace) continue;
    const outputs = workshopGoods(env, [e]);
    if (export_ === undefined || !outputs.has(export_)) continue;
    for (const good of outputs) if (good !== export_) kept.add(good);
  }
  return kept;
}

/** What the colony makes, gathers or digs: its workshops' goods, the land goods its flags reach, and what its
 *  collectors are gathering now. */
function colonyMade(env: ColonyEnv, buildings: readonly Entity[], people: readonly Entity[]): Set<number> {
  const { world, ctx, colony } = env;
  const origin = colonyOrigin(env, colony, buildings);
  const made = new Set(origin === null ? workshopGoods(env, buildings) : colonyMakes(env, origin, buildings));
  for (const e of people) {
    const good = heldGatherGood(world, ctx, e);
    if (good !== undefined) made.add(edibleGoodFormOf(ctx.content, good));
  }
  return made;
}

/** The colony's stores by good, its dishes counted as the food they are. */
function heldByForm(env: ColonyEnv, buildings: readonly Entity[]): Map<number, number> {
  const held = new Map<number, number>();
  for (const [good, amount] of storesHeld(env, buildings)) {
    const form = edibleGoodFormOf(env.ctx.content, good);
    held.set(form, (held.get(form) ?? 0) + amount);
  }
  return held;
}

/**
 * What home keeps of `good` when it sends some: food at its short line per mouth, so a colony's larder fills
 * before home's reaches comfort; a managed good at its comfort line past its sites, a settler good for its
 * own people who lack it, and a workshop input its own shelves.
 */
function homeKeepOf(
  env: SeatEnv,
  supply: SeatSupply,
  spare: (good: number) => number,
): (good: number) => number {
  const { world, ctx, seat } = env;
  const food = foodGood(ctx);
  const people = homeSettlers(world, ctx, seat);
  let shelves: Map<number, number> | undefined;
  return (good) => {
    if (good === food) return FOOD_SHORT_UNITS_PER_SETTLER * people.length;
    const comfort = Math.max(0, supply.units(good) - spare(good));
    shelves ??= workshopShelves(env, homeBuildings(world, ctx, seat));
    // Home keeps a unit for each of its own people who lacks one, with no colony's bound on it.
    const gear =
      contentIndex(ctx.content).goods.get(good)?.equip === undefined
        ? 0
        : settlersLacking(env, people, good) + SETTLER_GOOD_SPARE;
    return Math.max(comfort, gear, shelves.get(good) ?? 0);
  };
}

/** A colony's reads but the goods a route's trader sends home now, which each route adds of its own. */
export type ColonyStockReads = Omit<StockPolicyRead, 'outboundNow'>;

/** The colony's reads now, for {@link colonyStockPolicy} once a route adds its `outboundNow`. */
export function colonyStockReadsOf(env: ColonyEnv): ColonyStockReads {
  const { world, ctx } = env;
  const buildings = colonyBuildings(env);
  const people = colonists(env);
  const lacking = sitesShortfalls(world, ctx, buildings);
  const owed = new Map(lacking);
  // The next builds' bills, and each industry's next step's: its site opens only once the colony's stores
  // hold its whole bill, so a mint's gold dug on the colony stays there rather than sailing home.
  const plan = colonyPlan(env, env.colony, buildings);
  addUp(
    owed,
    billsOf(
      env,
      plan.filter((building, i) => i < COLONY_OPEN_SITES || chainStepOf(building) !== undefined),
    ),
  );
  const plainFloor = byType(ctx, Object.entries(COLONY_BUILDING_FLOOR));
  const buildingFloor = new Map(plainFloor);
  raise(buildingFloor, owed);
  const supply = homeSupply(env);
  const spare = homeSpare(env, supply);
  const held = heldByForm(env, buildings);
  return {
    buildingFloor,
    plainFloor,
    settlerReserve: settlerReserve(env, people, spare),
    wants: colonyIndustryWantsOf(env, buildings),
    workshopInputs: workshopShelves(env, buildings),
    makes: colonyMade(env, buildings, people),
    held,
    keptOnColony: keptOnColony(env, buildings),
    homeKeep: homeKeepOf(env, supply, spare),
    homeWants: homeWantsOf(env),
    siteLack: lacking,
  };
}
