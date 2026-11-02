import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import { Building, Female, Marriage, playerPlacementTribes, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { countedTiers } from '../../ai-shared/content-lookup.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import { buildingEnabled, needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { isCarrierJob } from '../../stores/index.js';
import { colonists, colonyOrigin } from './founding.js';
import { colonyFoodHeld, colonyMakes, landHolds } from './provision.js';
import { siteRoom } from './survey.js';
import type { ColonyEnv, ColonyView } from './voyage.js';

/** The open sites a colony's builders work at once (authored): its hold pays for little more. */
export const COLONY_OPEN_SITES = 2;

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

/** What the colony means to raise, in order: its unplaced rows, its homes, then what that makes worth
 *  raising. */
export function colonyPlan(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
): readonly string[] {
  const rows = colony.builds.filter((b) => !b.placed).map((b) => b.building);
  const raised = rows.length > 0 ? rows : homesLacking(env, colony, buildings);
  return [...raised, ...materialWorkshops(env, colony, buildings, billsOf(env, raised))];
}
