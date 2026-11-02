import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import { Building, playerPlacementTribes, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { countedTiers } from '../../ai-shared/content-lookup.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import { buildingEnabled, needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { isCarrierJob } from '../../stores/index.js';
import { colonists, colonyOrigin } from './founding.js';
import { colonyMakes, landHolds } from './provision.js';
import type { ColonyEnv, ColonyView } from './voyage.js';

/** The open sites a colony's builders work at once (authored): its hold pays for little more. */
export const COLONY_OPEN_SITES = 2;

/** Owner ruling: what a colony builds with, made in its own workshop or shipped, decided per material. */
const MATERIAL_GOOD_IDS: readonly string[] = ['brick', 'pillar', 'tile', 'ornament'];

/** The units of a material the colony's plan must call for before its workshop earns its bill and its man
 *  (authored): a mason hut or a pottery costs four or five units and a man for good, and the ladder's whole
 *  bill holds four pillars and two bricks, so the mason pays and the pottery does not. */
const MATERIAL_WORKSHOP_FROM_UNITS = 3;

/** The workshop that makes `good`, the lowest type id of those whose record names it. */
function makerOf(env: ColonyEnv, good: number): BuildingType | undefined {
  return env.ctx.content.buildings.find(
    (b) => b.kind === BUILDING_KIND.workplace && b.produces.includes(good),
  );
}

/** Whether `buildings` hold `type` at any tier of its chain, a site included. */
function holdsChain(env: ColonyEnv, buildings: readonly Entity[], type: BuildingType): boolean {
  const { world, ctx } = env;
  const chain = countedTiers(ctx.content, type, undefined);
  return buildings.some((e) => chain.has(world.get(e, Building).buildingType));
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
    if (maker === undefined || workshops.includes(maker.id) || holdsChain(env, buildings, maker)) continue;
    const inputs = index.mergedRecipeByBuilding.get(maker.typeId)?.inputs ?? [];
    const fed = inputs.every((input) => makes.has(input.goodType) || landHolds(env, from, input.goodType));
    if (fed && unlocked(env, maker) && crewOnColony(env, maker)) workshops.push(maker.id);
  }
  return workshops;
}

/** What the colony means to raise, in order: its unplaced rows, then what its plan makes worth raising. */
export function colonyPlan(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
): readonly string[] {
  const rows = colony.builds.filter((b) => !b.placed).map((b) => b.building);
  return [...rows, ...materialWorkshops(env, colony, buildings, billsOf(env, rows))];
}
