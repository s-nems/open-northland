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
import { FOOD_COMFORT_UNITS_PER_SETTLER } from '../workforce/food.js';
import { colonists, colonyOrigin } from './founding.js';
import { foodGood, homeSpare, homeSupply, workshopShelves } from './home-supply.js';
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
/** The most food a colony is filled up to, however many it feeds: the trader comes back. */
const COLONY_FOOD_MOST = 40;
/** What a colony is brought of each input of its standing workshops that it does not make; one it makes it
 *  keeps up to its shelves. */
export const WORKSHOP_INPUT_FLOOR = 5;
/** Drawn where it is drunk: a well stands wherever a workshop wants it, so it never sails. */
const WATER_ID = 'water';
/** Owner ruling: of a colony joinery's goods only the iron tool goes home; a workshop that makes it is one. */
const JOINERY_EXPORT_ID = TOOL_IRON_ID;

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
}

/** What the colony keeps of a workshop input: a small floor brought in, its shelves of one it makes. */
function inputFloor(read: StockPolicyRead, good: number): number {
  const shelves = read.workshopInputs.get(good);
  if (shelves === undefined) return 0;
  return read.makes.has(good) ? Math.max(WORKSHOP_INPUT_FLOOR, shelves) : WORKSHOP_INPUT_FLOOR;
}

/** The colony's floor of `good`: what it is filled up to and keeps when it sends the rest home. */
function floorOf(read: StockPolicyRead, good: number): number {
  return Math.max(
    read.buildingFloor.get(good) ?? 0,
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
 * the colony's surplus while home holds more.
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
    const goesHome = sends && (!takes || held > floor || (held === floor && read.outboundNow.has(good)));
    if (goesHome) outbound.push({ good, keep: floor });
    else if (takes) inbound.push({ good, upTo: floor, keep: read.homeKeep(good) });
  }
  return { inbound, outbound };
}

/** The inputs home's own workshops, its ship yard among them, have fewer of in home's stores than their
 *  shelves take: what a colony's surplus goes home to feed. */
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
      Math.min(COLONY_FOOD_MOST, FOOD_COMFORT_UNITS_PER_SETTLER * Math.max(1, people.length)),
    );
  return reserve;
}

/** What never leaves the colony: vehicles, water, what no store of its takes (its livestock), and of a
 *  workshop that makes the joinery's export, its other goods. */
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
 * What home keeps of `good` when it sends some: food at its comfort per mouth, a managed good at its comfort
 * line past its sites, a settler good for its own people who lack it, and a workshop input its own shelves.
 */
function homeKeepOf(env: SeatEnv): (good: number) => number {
  const { world, ctx, seat } = env;
  const supply = homeSupply(env);
  const spare = homeSpare(env, supply);
  const food = foodGood(ctx);
  const people = homeSettlers(world, ctx, seat);
  let shelves: Map<number, number> | undefined;
  return (good) => {
    if (good === food) return FOOD_COMFORT_UNITS_PER_SETTLER * people.length;
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

/** Home's `keep` of each good less what the colony's standing sites still lack past its own `held` store: a
 *  colony site waits on no comfort stock of home's, so a top-tier home is not held up for two units home
 *  could spare. */
export function keepPastSites(
  keep: (good: number) => number,
  lacking: ReadonlyMap<number, number>,
  held: ReadonlyMap<number, number>,
): (good: number) => number {
  return (good) => Math.max(0, keep(good) - Math.max(0, (lacking.get(good) ?? 0) - (held.get(good) ?? 0)));
}

/** The colony's policy now; `outboundNow` the goods its carrier sends home as marked. */
export function colonyStockPolicyOf(env: ColonyEnv, outboundNow: ReadonlySet<number>): ColonyStockPolicy {
  const { world, ctx } = env;
  const buildings = colonyBuildings(env);
  const people = colonists(env);
  const lacking = sitesShortfalls(world, ctx, buildings);
  const owed = new Map(lacking);
  addUp(owed, billsOf(env, colonyPlan(env, env.colony, buildings).slice(0, COLONY_OPEN_SITES)));
  const buildingFloor = byType(ctx, Object.entries(COLONY_BUILDING_FLOOR));
  raise(buildingFloor, owed);
  const spare = homeSpare(env, homeSupply(env));
  const held = heldByForm(env, buildings);
  return colonyStockPolicy({
    buildingFloor,
    settlerReserve: settlerReserve(env, people, spare),
    wants: colonyIndustryWantsOf(env, buildings),
    workshopInputs: workshopShelves(env, buildings),
    makes: colonyMade(env, buildings, people),
    held,
    keptOnColony: keptOnColony(env, buildings),
    outboundNow,
    homeKeep: keepPastSites(homeKeepOf(env), lacking, held),
    homeWants: homeWantsOf(env),
  });
}
