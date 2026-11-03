import { BUILDING_KIND, type BuildingType, buildingFootprintFor } from '@open-northland/data';
import {
  Building,
  Female,
  Marriage,
  mapBriefOf,
  playerPlacementTribes,
  Residence,
  Settler,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { DeepReadonly, Entity } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { buildingTypeByContentId, countedTiers } from '../../ai-shared/content-lookup.js';
import { homeBuildings } from '../../ai-shared/home-roster.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import { mayMarry } from '../../family/eligibility.js';
import { familiesOf } from '../../family/households.js';
import { buildingEnabled, jobEnabled, needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { isCarrierJob } from '../../stores/index.js';
import { seatHasSide } from '../build-order/seat-order.js';
import { minutesToTicks } from '../game-phase.js';
import { technologyTable } from '../technology/requirements.js';
import { topEnabledTier } from '../top-tier.js';
import { FOOD_COMFORT_UNITS_PER_SETTLER } from '../workforce/food.js';
import { colonists, colonyOrigin } from './founding.js';
import { colonyFed, colonyFoodHeld } from './provision.js';
import { siteRoom } from './survey.js';
import { towersLacking } from './towers.js';
import type { ColonyEnv, ColonyView } from './voyage.js';

/** The open sites a colony's builders work at once (authored): its hold pays for little more. */
export const COLONY_OPEN_SITES = 2;
/** How far from its anchor a building's spot may lie, in Manhattan nodes (authored: the walk range). */
export const COLONY_SPOT_NODES = 50;

/** The home chain's base tier: a colony raises its homes at the top tier enabled ({@link topEnabledTier}). */
const HOME_ID = 'home_level_00';
/** The nodes round its footprint a building takes for its door, its paths and its neighbours' spacing, per
 *  footprint node (authored, an approximation): the room a site's block holds at the map's scan is spent at
 *  this rate, so a block of 300 free nodes takes about four level-0 homes and one of 2600 about forty. */
const ROOM_PER_FOOTPRINT_NODE = 3;
/** The family slots a colony keeps free ahead of its couples while home has no room to build (owner ruling:
 *  a roomy colony grows the people of a cramped seat): a home's worth. */
const SLOTS_AHEAD_WHEN_CRAMPED = 1;

/** What a colony's next home waits for. */
export interface HomesRead {
  /** The families with no home there: wives, and the brides its grooms can marry. */
  readonly homeless: number;
  /** The family slots free in its homes, sites included. */
  readonly freeSlots: number;
  /** Whether its people eat well ({@link colonyFed}). */
  readonly fed: boolean;
  /** Whether its block has room left for another home. */
  readonly roomy: boolean;
  /** Whether home has no room left to build. */
  readonly cramped: boolean;
}

/** Owner ruling: a colony with room builds homes as it needs, no fixed number: one more while it is fed and
 *  roomy and its homeless families, with a home's slots ahead on a cramped seat, outnumber its free slots. */
export function homeStepDue(read: HomesRead): boolean {
  if (!read.fed || !read.roomy) return false;
  return read.homeless + (read.cramped ? SLOTS_AHEAD_WHEN_CRAMPED : 0) > read.freeSlots;
}

/** Fishers first: what they and the hunters bring may meet the hunger, so the ladder waits this long after
 *  the landing (authored: a warehouse and its first catch take about that on
 *  arabskie_wyspy_wolna_gra_mieszana). */
const FISHERS_FIRST_TICKS = minutesToTicks(10);
/** Plantable nodes within the spot search of a colony's store that a grain farm's fields want, and that a
 *  well or a hive wants under its body (authored, untuned: every colony site on
 *  arabskie_wyspy_wolna_gra_mieszana clears both). */
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
  /** Whether the tribe has unlocked a building and its trades have a man in reach. */
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

/** How many of `buildings` stand at any tier of `type`'s chain, sites included. */
export function chainCount(env: ColonyEnv, buildings: readonly Entity[], type: BuildingType): number {
  const { world, ctx } = env;
  const chain = countedTiers(ctx.content, type, undefined);
  return buildings.filter((e) => chain.has(world.get(e, Building).buildingType)).length;
}

/** The trades of `type` a colony must find a man for: a carrier any man can be. */
function operatorJobs(env: ColonyEnv, type: BuildingType): number[] {
  return type.workers.map((slot) => slot.jobType).filter((job) => !isCarrierJob(env.ctx, job));
}

/** Whether a school standing at home teaches `job`: its pupil sails on the line. */
export function homeTeaches(env: ColonyEnv, job: number): boolean {
  const { world, ctx, seat } = env;
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const school =
    tribe === undefined ? null : (technologyTable(ctx.content, tribe)?.jobs.get(job)?.school ?? null);
  if (tribe === undefined || school === null || !jobEnabled(world, ctx, seat, tribe, job)) return false;
  return homeBuildings(world, ctx, seat).some(
    (e) => school.schools.includes(world.get(e, Building).buildingType) && isBuilt(world, e),
  );
}

/** Whether each trade of `type` has its man: earned by one of the colony's, or one home's school can make.
 *  Owner ruling: people cross like goods, so a trade the colony lacks is no reason to go without its building. */
export function crewInReach(env: ColonyEnv, type: BuildingType): boolean {
  const { world, ctx } = env;
  const men = colonists(env).filter((e) => isAllocatableMan(world, ctx, e));
  return operatorJobs(env, type).every(
    (job) =>
      men.some((e) => {
        const held = world.get(e, Settler).jobType === job;
        return held || settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', job);
      }) || homeTeaches(env, job),
  );
}

/** Whether the colony's `tribe` has unlocked `type`. */
export function unlocked(env: ColonyEnv, type: BuildingType): boolean {
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
      return type !== undefined && unlocked(env, type) && crewInReach(env, type);
    },
  };
}

/** The nodes of the colony's block its buildings and `extra` would take ({@link ROOM_PER_FOOTPRINT_NODE}). */
function roomTaken(env: ColonyEnv, buildings: readonly Entity[], extra: BuildingType): number {
  const { world, ctx, seat } = env;
  const index = contentIndex(ctx.content);
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const nodes = (type: BuildingType | undefined): number =>
    type === undefined ? 0 : (buildingFootprintFor(type, tribe)?.blocked.length ?? 0);
  let taken = nodes(extra);
  for (const e of buildings) taken += nodes(index.buildings.get(world.get(e, Building).buildingType));
  return ROOM_PER_FOOTPRINT_NODE * taken;
}

/** Whether the colony's block still has room for `type` beside what stands there. */
function roomFor(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
  type: BuildingType,
): boolean {
  return roomTaken(env, buildings, type) <= siteRoom(env.world, colony);
}

/** The family slots of the colony's homes, sites included, and those families fill. */
export function homeSlots(
  env: ColonyEnv,
  buildings: readonly Entity[],
): { readonly slots: number; readonly free: number } {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  let slots = 0;
  let free = 0;
  for (const e of buildings) {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type?.kind !== BUILDING_KIND.home) continue;
    slots += type.homeSize;
    free += type.homeSize - (isBuilt(world, e) ? familiesOf(world, e).length : 0);
  }
  return { slots, free };
}

/** The home the colony raises next, if one is due ({@link homeStepDue}). */
function homeStep(env: ColonyEnv, colony: ColonyView, buildings: readonly Entity[]): string[] {
  const { world, ctx, seat } = env;
  const base = buildingTypeByContentId(ctx.content, HOME_ID);
  const tribe = playerPlacementTribes(world, seat)?.[0];
  if (base === undefined || tribe === undefined) return [];
  // Owner ruling: a colony home goes to the top level at once, since the line supplies its materials.
  const type = topEnabledTier(world, ctx, seat, tribe, base);
  const people = colonists(env);
  const women = people.filter((e) => world.has(e, Female));
  const wives = women.filter((e) => world.has(e, Marriage) && !world.has(e, Residence)).length;
  const brides = women.filter((e) => mayMarry(world, ctx.content, e)).length;
  const grooms = people.filter((e) => !world.has(e, Female) && mayMarry(world, ctx.content, e)).length;
  const due = homeStepDue({
    homeless: wives + Math.min(brides, grooms),
    freeSlots: homeSlots(env, buildings).free,
    fed: colonyFed(env, buildings, people),
    roomy: roomFor(env, colony, buildings, type),
    cramped: seatHasSide(world, seat, 'noRoom'),
  });
  return due ? [type.id] : [];
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

/** What the colony means to raise, in order: its unplaced rows; then its next food step, the towers its
 *  garrison mans and its homes. Owner ruling: it raises no pottery or mason hut, home makes their goods. */
export function colonyPlan(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
): readonly string[] {
  const rows = colony.builds.filter((b) => !b.placed).map((b) => b.building);
  if (rows.length > 0) return rows;
  const ladder = ladderRead(env, colony, buildings);
  const food = ladder === null ? null : nextFoodStep(ladder);
  const towers = towersLacking(env, colony, buildings);
  return [...(food === null ? [] : [food]), ...towers, ...homeStep(env, colony, buildings)];
}
