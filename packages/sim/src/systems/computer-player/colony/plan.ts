import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import {
  Building,
  Female,
  Marriage,
  mapBriefOf,
  playerPlacementTribes,
  Settler,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { DeepReadonly, Entity } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { countedTiers } from '../../ai-shared/content-lookup.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import { buildingEnabled, needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { isCarrierJob } from '../../stores/index.js';
import { minutesToTicks } from '../game-phase.js';
import { FOOD_COMFORT_UNITS_PER_SETTLER } from '../workforce/food.js';
import { colonists, colonyOrigin } from './founding.js';
import { colonyFoodHeld, colonyMakes, landHolds } from './provision.js';
import { siteRoom } from './survey.js';
import type { ColonyEnv, ColonyView } from './voyage.js';

/** The open sites a colony's builders work at once (authored): its hold pays for little more. */
export const COLONY_OPEN_SITES = 2;
/** How far from its anchor a building's spot may lie, in Manhattan nodes (authored: the walk range). */
export const COLONY_SPOT_NODES = 50;

/** Owner ruling: what a colony builds with, made in its own workshop or shipped, decided per material. */
const MATERIAL_GOOD_IDS: readonly string[] = ['brick', 'pillar', 'tile', 'ornament'];

/** The units of a material the colony's plan must call for before its workshop earns its bill and its man
 *  (authored): a mason hut or a pottery costs four or five units and a man for good, and the ladder's whole
 *  bill holds four pillars and two bricks, so the mason pays and the pottery does not. */
const MATERIAL_WORKSHOP_FROM_UNITS = 3;

/** The home a colony raises. */
const HOME_ID = 'home_level_00';
/** Free nodes in the site's block past which a colony has room for a second home, and with
 *  {@link BIG_COLONY_PEOPLE} people for a third (authored from the brief's blocks on
 *  arabskie_wyspy_wolna_gra_mieszana: they hold 300 to 2600). */
const ROOM_FOR_TWO_HOMES_NODES = 1000;
const ROOM_FOR_THREE_HOMES_NODES = 2000;
const BIG_COLONY_PEOPLE = 25;
const ONE_HOME = 1;
const TWO_HOMES = 2;
const THREE_HOMES = 3;

/** What sizes a colony's homes. */
export interface HomesRead {
  /** The couples living there. */
  readonly couples: number;
  /** Whether its food holds one meal a mouth. */
  readonly fed: boolean;
  /** Free nodes in its site's block. */
  readonly room: number;
  /** The people living there. */
  readonly people: number;
}

/** Owner ruling: homes only serve growth, and a colony lacking everything has nothing to grow: none while
 *  it has no couple to house or no food in store, then one or two by the island's size, more only with a
 *  lot of room and a big planned colony. People come by ship, not by homes. */
export function colonyHomes(read: HomesRead): number {
  if (read.couples === 0 || !read.fed) return 0;
  if (read.room >= ROOM_FOR_THREE_HOMES_NODES && read.people >= BIG_COLONY_PEOPLE) return THREE_HOMES;
  return read.room >= ROOM_FOR_TWO_HOMES_NODES ? TWO_HOMES : ONE_HOME;
}

/** Fishers first: what they and the hunters bring may meet the hunger, so the ladder waits this long after
 *  the landing (authored: a warehouse and its first catch take about that on
 *  arabskie_wyspy_wolna_gra_mieszana). */
const FISHERS_FIRST_TICKS = minutesToTicks(10);
/** Plantable nodes within the spot search of a colony's store that a grain farm's fields want, and that a
 *  well or a hive wants under its body (authored: a farm sows about a dozen nodes a farmer, a well stands
 *  on a handful). */
const FIELD_NODES = 48;
const GRASS_NODES = 6;

const FARM = 'work_farm_00';
const MILL = 'work_mill_00';
const WELL = 'work_well_00';
const BAKERY = 'work_bakery_00';
const ANIMAL_FARM = 'work_animal_farm';
const HIVE = 'work_hive_00';
const BREWERY = 'work_brewery';

/** The ground a step asks for: a farm's fields, a patch of grass, or any. */
export type StepGround = 'field' | 'grass' | 'any';

interface LadderStep {
  readonly building: string;
  readonly ground: StepGround;
  /** What stands before this step does. */
  readonly after: readonly string[];
  /** The buildings this one serves: it waits until one of them could run. */
  readonly serves?: readonly string[];
  /** Whether it needs animals on the land. */
  readonly animals?: true;
}

/** Owner ruling: fishers first, later a farm, a mill, a well and a bakery, where there is grass for the farm
 *  and the well. */
const GRAIN_LADDER: readonly LadderStep[] = [
  { building: FARM, ground: 'field', after: [] },
  { building: MILL, ground: 'any', after: [FARM] },
  { building: WELL, ground: 'grass', after: [MILL], serves: [BAKERY] },
  { building: BAKERY, ground: 'any', after: [MILL, WELL] },
];

/** Owner ruling: else, or besides, an animal farm where animals exist and a brewery, whose well and hive want
 *  green ground too. */
const GREEN_LADDER: readonly LadderStep[] = [
  { building: WELL, ground: 'grass', after: [], serves: [ANIMAL_FARM, BREWERY] },
  { building: ANIMAL_FARM, ground: 'any', after: [WELL], animals: true },
  { building: HIVE, ground: 'grass', after: [WELL], serves: [BREWERY] },
  { building: BREWERY, ground: 'any', after: [WELL, HIVE] },
];

/** One look at the colony's food. */
export interface LadderRead {
  /** The ladder's buildings raised, sites included, and those standing. */
  readonly raised: ReadonlySet<string>;
  readonly standing: ReadonlySet<string>;
  /** Whether the colony's food runs under its comfort past the fishers' start. */
  readonly hungry: boolean;
  /** Whether the ground takes a farm's fields, and a well's patch. */
  readonly field: boolean;
  readonly grass: boolean;
  /** Whether animals live on the land. */
  readonly animals: boolean;
  /** Whether the tribe has unlocked a building and a man has earned its trades. */
  readonly open: (building: string) => boolean;
}

function stepFits(step: LadderStep, read: LadderRead): boolean {
  const ground = step.ground === 'any' || (step.ground === 'field' ? read.field : read.grass);
  const animals = step.animals !== true || read.animals;
  const serves = step.serves === undefined || step.serves.some((building) => read.open(building));
  return ground && animals && serves;
}

/** The steps the ladders hold for `read`'s ground that are not yet raised, whatever the moment. */
function stepsAhead(read: LadderRead): LadderStep[] {
  const steps = [...GRAIN_LADDER, ...GREEN_LADDER];
  const unique = steps.filter((step, i) => steps.findIndex((s) => s.building === step.building) === i);
  return unique.filter((step) => !read.raised.has(step.building) && stepFits(step, read));
}

/**
 * The next food building, or null (owner ruling: ordered by need, not all at founding). It runs while the
 * colony is hungry, one building at a time, on the grain ladder where a field fits and then on the green one:
 * a step whose ground, animals, tribe or men are lacking is passed over, and what it would serve with it.
 */
export function nextFoodStep(read: LadderRead): string | null {
  if (!read.hungry) return null;
  for (const ladder of read.field ? [GRAIN_LADDER, GREEN_LADDER] : [GREEN_LADDER]) {
    if (ladder.some((s) => read.raised.has(s.building) && !read.standing.has(s.building))) return null;
    const next = ladder.find(
      (s) =>
        !read.raised.has(s.building) &&
        s.after.every((building) => read.standing.has(building)) &&
        stepFits(s, read) &&
        read.open(s.building),
    );
    if (next !== undefined) return next.building;
  }
  return null;
}

/** The ground the ladder asks of `building`. */
export function stepGround(building: string): StepGround {
  return [...GRAIN_LADDER, ...GREEN_LADDER].find((s) => s.building === building)?.ground ?? 'any';
}

/** The workshop that makes `good`, the lowest type id of those whose record names it. */
function makerOf(env: ColonyEnv, good: number): BuildingType | undefined {
  return env.ctx.content.buildings.find(
    (b) => b.kind === BUILDING_KIND.workplace && b.produces.includes(good),
  );
}

/** How many of `buildings` stand at any tier of `type`'s chain, sites included. */
function chainCount(env: ColonyEnv, buildings: readonly Entity[], type: BuildingType): number {
  const { world, ctx } = env;
  const chain = countedTiers(ctx.content, type, undefined);
  return buildings.filter((e) => chain.has(world.get(e, Building).buildingType)).length;
}

/** The trades of `type` a colony must find a man for: a carrier any man can be. */
function operatorJobs(env: ColonyEnv, type: BuildingType): number[] {
  return type.workers.map((slot) => slot.jobType).filter((job) => !isCarrierJob(env.ctx, job));
}

/** Whether some man of the colony has earned each trade of `type`. */
export function crewOnColony(env: ColonyEnv, type: BuildingType): boolean {
  const { world, ctx } = env;
  const men = colonists(env).filter((e) => isAllocatableMan(world, ctx, e));
  return operatorJobs(env, type).every((job) =>
    men.some((e) => {
      const held = world.get(e, Settler).jobType === job;
      return held || settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', job);
    }),
  );
}

/** Whether the colony's `tribe` has unlocked `type`. */
function unlocked(env: ColonyEnv, type: BuildingType): boolean {
  const tribe = playerPlacementTribes(env.world, env.seat)?.[0];
  return tribe !== undefined && buildingEnabled(env.world, env.ctx, env.seat, tribe, type.typeId);
}

/** The units of each good `plan`'s bills take. */
export function billsOf(env: ColonyEnv, plan: readonly string[]): Map<number, number> {
  const index = contentIndex(env.ctx.content);
  const bills = new Map<number, number>();
  for (const building of plan) {
    const type = index.buildingTypeBySlug.get(building);
    for (const line of type === undefined ? [] : (index.constructionBillByBuilding.get(type) ?? []))
      bills.set(line.goodType, (bills.get(line.goodType) ?? 0) + line.amount);
  }
  return bills;
}

/**
 * Owner ruling: make a material or ship it, per material. The workshop goes up when `bills` call for
 * {@link MATERIAL_WORKSHOP_FROM_UNITS} of what it makes, the colony's land or workshops supply all it works
 * up, the tribe has it unlocked and a man has earned its trade. Everything else sails.
 */
function materialWorkshops(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
  bills: ReadonlyMap<number, number>,
): string[] {
  const { ctx } = env;
  const index = contentIndex(ctx.content);
  const from = colonyOrigin(env, colony, buildings);
  if (from === null) return [];
  const makes = colonyMakes(env, from, buildings);
  const workshops: string[] = [];
  for (const id of MATERIAL_GOOD_IDS) {
    const good = index.goodTypeBySlug.get(id);
    if (good === undefined || (bills.get(good) ?? 0) < MATERIAL_WORKSHOP_FROM_UNITS) continue;
    const maker = makerOf(env, good);
    if (maker === undefined || workshops.includes(maker.id) || chainCount(env, buildings, maker) > 0)
      continue;
    const inputs = index.mergedRecipeByBuilding.get(maker.typeId)?.inputs ?? [];
    const fed = inputs.every((input) => makes.has(input.goodType) || landHolds(env, from, input.goodType));
    if (fed && unlocked(env, maker) && crewOnColony(env, maker)) workshops.push(maker.id);
  }
  return workshops;
}

/** Whether a wild herd stood on `land` at the map's scan. */
function animalsOn(env: ColonyEnv, land: number): boolean {
  const { world, terrain } = env;
  const spots = mapBriefOf(world)?.livestock ?? [];
  return spots.some((at) => terrain.componentOf(terrain.nodeAt(at.hx, at.hy)) === land);
}

const plantableMemo = new WeakMap<TerrainGraph, Map<number, number>>();

/** The plantable nodes on `land` within `reach` of `from`: the ground never changes, so kept per terrain and
 *  store node. Never hashed. */
function plantableNear(
  env: ColonyEnv,
  from: DeepReadonly<HalfCellNode>,
  land: number,
  reach: number,
): number {
  const { terrain } = env;
  let byNode = plantableMemo.get(terrain);
  if (byNode === undefined) {
    byNode = new Map();
    plantableMemo.set(terrain, byNode);
  }
  const key = terrain.nodeAtClamped(from.hx, from.hy);
  const held = byNode.get(key);
  if (held !== undefined) return held;
  let nodes = 0;
  for (let dy = -reach; dy <= reach; dy++) {
    const span = reach - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      const x = from.hx + dx;
      const y = from.hy + dy;
      if (!terrain.inBounds(x, y)) continue;
      const node = terrain.nodeAt(x, y);
      if (terrain.componentOf(node) === land && terrain.isPlantable(node)) nodes++;
    }
  }
  byNode.set(key, nodes);
  return nodes;
}

/** The colony's food as {@link nextFoodStep} reads it. */
function ladderRead(env: ColonyEnv, colony: ColonyView, buildings: readonly Entity[]): LadderRead | null {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const from = colonyOrigin(env, colony, buildings);
  if (from === null) return null;
  const raised = new Set<string>();
  const standing = new Set<string>();
  for (const e of buildings) {
    const id = index.buildings.get(world.get(e, Building).buildingType)?.id;
    if (id === undefined) continue;
    raised.add(id);
    if (isBuilt(world, e)) standing.add(id);
  }
  const plantable = plantableNear(env, from, colony.land, COLONY_SPOT_NODES);
  const mouths = colonists(env).length;
  const fishersDone = ctx.tick - colony.since >= FISHERS_FIRST_TICKS;
  return {
    raised,
    standing,
    hungry: fishersDone && colonyFoodHeld(env, buildings) < FOOD_COMFORT_UNITS_PER_SETTLER * mouths,
    field: plantable >= FIELD_NODES,
    grass: plantable >= GRASS_NODES,
    animals: animalsOn(env, colony.land),
    open: (building) => {
      const typeId = index.buildingTypeBySlug.get(building);
      const type = typeId === undefined ? undefined : index.buildings.get(typeId);
      return type !== undefined && unlocked(env, type) && crewOnColony(env, type);
    },
  };
}

/** The homes the colony still lacks ({@link colonyHomes}), each a row of the plan. */
function homesLacking(env: ColonyEnv, colony: ColonyView, buildings: readonly Entity[]): string[] {
  const { world, ctx } = env;
  const home = contentIndex(ctx.content).buildingTypeBySlug.get(HOME_ID);
  const type = home === undefined ? undefined : contentIndex(ctx.content).buildings.get(home);
  if (type === undefined) return [];
  const people = colonists(env);
  const wanted = colonyHomes({
    couples: people.filter((e) => world.has(e, Female) && world.has(e, Marriage)).length,
    fed: colonyFoodHeld(env, buildings) >= people.length,
    room: siteRoom(world, colony),
    people: people.length,
  });
  return new Array<string>(Math.max(0, wanted - chainCount(env, buildings, type))).fill(HOME_ID);
}

/** The buildings the colony's ladders still hold for its ground, whatever the moment: what it keeps goods
 *  for though no step is due. */
export function ladderAhead(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
): readonly string[] {
  const ladder = ladderRead(env, colony, buildings);
  return ladder === null ? [] : stepsAhead(ladder).map((step) => step.building);
}

/** What the colony means to raise, in order: its unplaced rows; then its next food step, its homes, and what
 *  the ladder's bills and theirs make worth raising. */
export function colonyPlan(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
): readonly string[] {
  const rows = colony.builds.filter((b) => !b.placed).map((b) => b.building);
  if (rows.length > 0) return rows;
  const ladder = ladderRead(env, colony, buildings);
  const food = ladder === null ? null : nextFoodStep(ladder);
  const ahead = ladder === null ? [] : stepsAhead(ladder).map((step) => step.building);
  const homes = homesLacking(env, colony, buildings);
  const bills = billsOf(env, [...ahead, ...homes]);
  return [...(food === null ? [] : [food]), ...homes, ...materialWorkshops(env, colony, buildings, bills)];
}
