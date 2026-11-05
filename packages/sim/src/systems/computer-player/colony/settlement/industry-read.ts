import { BUILDING_KIND, type BuildingType, buildingFootprintFor } from '@open-northland/data';
import { Building, mapBriefOf, playerPlacementTribes, Settler } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import {
  buildingTypeByContentId,
  goodTypeByContentId,
  tiersAtOrAbove,
} from '../../../ai-shared/content-lookup.js';
import { homeBuildings } from '../../../ai-shared/home-roster.js';
import { isBuilt } from '../../../ai-shared/seat-roster.js';
import { isAllocatableMan } from '../../../ai-shared/workforce/pool.js';
import { buildingEnabled, jobEnabled, needSubjectOf, settlerMeetsNeed } from '../../../progression/index.js';
import { isCarrierJob } from '../../../stores/index.js';
import { ROOM_HOME_BUILDING } from '../../build-order/ground/room.js';
import { homeStockOf } from '../../home-stock.js';
import { technologyTable } from '../../technology/requirements.js';
import { enabledTiersAbove, topEnabledTier } from '../../top-tier.js';
import type { ColonyEnv, ColonyView } from '../env.js';
import { landHolds } from '../land.js';
import { colonists, colonyOrigin } from '../roster.js';
import { siteRoom } from '../voyage/survey.js';
import {
  ALL_STEPS,
  type ChainStep,
  chooseIndustries,
  colonyIndustryWants,
  type IndustryChoice,
  type SeatRead,
  type SiteFacts,
  type StepRead,
  type Worth,
} from './industry.js';

/** How far from its anchor a building's spot may lie, in Manhattan nodes (authored: the walk range). */
export const COLONY_SPOT_NODES = 50;
/** The nodes round its footprint a building takes for its door, its paths and its neighbours' spacing, per
 *  footprint node (authored, an approximation): the room a site's block holds at the map's scan is spent at
 *  this rate, so a block of 300 free nodes takes about four level-0 homes and one of 2600 about forty. */
const ROOM_PER_FOOTPRINT_NODE = 3;
/** Plantable nodes within the spot search of a colony's store that a grain farm's fields want, and that a
 *  well, a hive or a herb hut wants under its body (authored, untuned: every colony site on
 *  arabskie_wyspy_wolna_gra_mieszana clears both). */
const FIELD_NODES = 48;
const GRASS_NODES = 6;
/** The homes whose room a colony keeps from its industries (authored), at the top tier enabled: owner
 *  ruling, colony homes go straight to the top level. A site with no more grows people alone. */
const HOMES_KEPT = 2;
/** The units of a good home makes at which it holds plenty, and a colony makes none for it (authored: a
 *  wave's arms and more). */
const HOME_PLENTY_UNITS = 30;

/** The trades of `type` a colony must find a man for: a carrier any man can be. */
function operatorJobs(env: ColonyEnv, type: BuildingType): number[] {
  return type.workers.map((slot) => slot.jobType).filter((job) => !isCarrierJob(env.ctx, job));
}

/** Whether a school standing at home teaches `job`: its pupil sails on the ferry. */
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
function crewInReach(env: ColonyEnv, men: readonly Entity[], type: BuildingType): boolean {
  const { world, ctx } = env;
  return operatorJobs(env, type).every(
    (job) =>
      men.some((e) => {
        const held = world.get(e, Settler).jobType === job;
        return held || settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', job);
      }) || homeTeaches(env, job),
  );
}

/** Whether the colony's tribe has unlocked `type`. */
function unlocked(env: ColonyEnv, type: BuildingType): boolean {
  const tribe = playerPlacementTribes(env.world, env.seat)?.[0];
  return tribe !== undefined && buildingEnabled(env.world, env.ctx, env.seat, tribe, type.typeId);
}

/** The building `step` is raised as: the top tier the tribe has enabled, which must be the step's own
 *  tier when it names one; else its base, a step with a top going up there later (`./lifts.ts`). Undefined
 *  while the content or the tribe lacks it. */
export function stepType(env: ColonyEnv, step: ChainStep): BuildingType | undefined {
  const { world, ctx, seat } = env;
  const base = buildingTypeByContentId(ctx.content, step.building);
  const tribe = playerPlacementTribes(world, seat)?.[0];
  if (base === undefined || step.tier === undefined) return base;
  if (tribe === undefined) return undefined;
  const top = topEnabledTier(world, ctx, seat, tribe, base);
  return top.id === step.tier ? top : undefined;
}

/** The tier a step with a top goes up to now: the highest the tribe has enabled up to its top, else its
 *  base. */
export function stepTop(env: ColonyEnv, step: ChainStep): BuildingType | undefined {
  const { world, ctx, seat } = env;
  const base = buildingTypeByContentId(ctx.content, step.building);
  const tribe = playerPlacementTribes(world, seat)?.[0];
  if (base === undefined || step.top === undefined || tribe === undefined) return base;
  const tiers = enabledTiersAbove(world, ctx, seat, tribe, base);
  const upTo = tiers.findIndex((tier) => tier.id === step.top);
  return (upTo < 0 ? tiers.at(-1) : tiers[upTo]) ?? base;
}

/** The nodes of the colony's block `type` takes ({@link ROOM_PER_FOOTPRINT_NODE}). */
function roomOfType(env: ColonyEnv, type: BuildingType | undefined): number {
  const tribe = playerPlacementTribes(env.world, env.seat)?.[0];
  return type === undefined
    ? 0
    : ROOM_PER_FOOTPRINT_NODE * (buildingFootprintFor(type, tribe)?.blocked.length ?? 0);
}

/** The nodes of the colony's block its buildings take. */
function roomTaken(env: ColonyEnv, buildings: readonly Entity[]): number {
  const index = contentIndex(env.ctx.content);
  let taken = 0;
  for (const e of buildings)
    taken += roomOfType(env, index.buildings.get(env.world.get(e, Building).buildingType));
  return taken;
}

/** Whether the colony's block still has room for `type` beside what stands there. */
export function roomFor(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
  type: BuildingType,
): boolean {
  return roomTaken(env, buildings) + roomOfType(env, type) <= siteRoom(env.world, colony);
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

/** The room the colony keeps for {@link HOMES_KEPT} homes at the top tier its tribe has enabled. */
function homesRoom(env: ColonyEnv): number {
  const { world, ctx, seat } = env;
  const base = buildingTypeByContentId(ctx.content, ROOM_HOME_BUILDING);
  const tribe = playerPlacementTribes(world, seat)?.[0];
  if (base === undefined || tribe === undefined) return 0;
  return HOMES_KEPT * roomOfType(env, topEnabledTier(world, ctx, seat, tribe, base));
}

/** What the colony's land offers ({@link SiteFacts}). Costs a resource search per deposit good. */
function siteFacts(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
  from: HalfCellNode,
): SiteFacts {
  const plantable = plantableNear(env, from, colony.land, COLONY_SPOT_NODES);
  const holds = (id: string): boolean => {
    const good = goodTypeByContentId(env.ctx.content, id)?.typeId;
    return good !== undefined && landHolds(env, from, good);
  };
  return {
    field: plantable >= FIELD_NODES,
    grass: plantable >= GRASS_NODES,
    wood: holds('wood'),
    iron: holds('iron'),
    gold: holds('gold'),
    mushroom: holds('mushroom'),
    animals: animalsOn(env, colony.land),
    room: Math.max(0, siteRoom(env.world, colony) - roomTaken(env, buildings) - homesRoom(env)),
  };
}

/** The goods home's standing workshops make. */
function homeMade(env: ColonyEnv): Set<number> {
  const { world, ctx, seat } = env;
  const index = contentIndex(ctx.content);
  const goods = new Set<number>();
  for (const e of homeBuildings(world, ctx, seat)) {
    const typeId = world.get(e, Building).buildingType;
    if (index.buildings.get(typeId)?.kind !== BUILDING_KIND.workplace || !isBuilt(world, e)) continue;
    for (const good of index.buildings.get(typeId)?.produces ?? []) goods.add(good);
    for (const output of index.mergedRecipeByBuilding.get(typeId)?.outputs ?? []) goods.add(output.goodType);
  }
  return goods;
}

/** The steps of every chain raised on the colony, sites included, and those standing, by base id: a
 *  building at any tier of a step's chain counts. */
function raisedSteps(
  env: ColonyEnv,
  buildings: readonly Entity[],
  steps: readonly ChainStep[],
): { readonly raised: Set<string>; readonly standing: Set<string> } {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const raised = new Set<string>();
  const standing = new Set<string>();
  for (const step of steps) {
    const base = buildingTypeByContentId(ctx.content, step.building);
    if (base === undefined || raised.has(step.building)) continue;
    const tiers = tiersAtOrAbove(index, base);
    for (const e of buildings) {
      if (!tiers.has(world.get(e, Building).buildingType)) continue;
      raised.add(step.building);
      if (isBuilt(world, e)) standing.add(step.building);
    }
  }
  return { raised, standing };
}

/** One colony's industries this tick: what it chose, why, and where its chains stand. */
export interface ColonyIndustries {
  readonly site: SiteFacts;
  readonly homeMakesHolyOil: boolean;
  readonly choices: readonly IndustryChoice[];
  readonly read: StepRead;
}

const industriesMemo = new WeakMap<
  World,
  Map<string, { readonly tick: number; readonly value: ColonyIndustries }>
>();

function readIndustries(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
): ColonyIndustries | null {
  const { world, ctx, seat } = env;
  const from = colonyOrigin(env, colony, buildings);
  if (from === null) return null;
  const site = siteFacts(env, colony, buildings, from);
  const { raised, standing } = raisedSteps(env, buildings, ALL_STEPS);
  const made = homeMade(env);
  const stock = homeStockOf(world, ctx, seat);
  const worth = (id: string): Worth => {
    const good = goodTypeByContentId(ctx.content, id)?.typeId;
    if (good === undefined || !made.has(good)) return 'lacking';
    return stock.units(good) >= HOME_PLENTY_UNITS ? 'plenty' : 'wanted';
  };
  const oil = goodTypeByContentId(ctx.content, 'holy_oil')?.typeId;
  const homeMakesHolyOil = oil !== undefined && made.has(oil);
  const people = colonists(env);
  const men = people.filter((e) => isAllocatableMan(world, ctx, e));
  const opened = new Map<string, boolean>();
  const open = (step: ChainStep): boolean => {
    const key = step.tier ?? step.building;
    let held = opened.get(key);
    if (held === undefined) {
      const type = stepType(env, step);
      held = type !== undefined && unlocked(env, type) && crewInReach(env, men, type);
      opened.set(key, held);
    }
    return held;
  };
  const seatRead: SeatRead = {
    worth,
    homeMakesHolyOil,
    open,
    roomOf: (step) => roomOfType(env, stepType(env, step)),
    raised,
  };
  return {
    site,
    homeMakesHolyOil,
    choices: chooseIndustries(site, seatRead),
    read: { raised, standing, running: colony.phase === 'running', open },
  };
}

/** The colony's industries ({@link ColonyIndustries}), or null while it has no node to work from. Read once
 *  per tick and colony, as the plan, its posts and its hands all ask. Never hashed. */
export function colonyIndustries(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
): ColonyIndustries | null {
  const { world, ctx, seat } = env;
  let byColony = industriesMemo.get(world);
  if (byColony === undefined) {
    byColony = new Map();
    industriesMemo.set(world, byColony);
  }
  const key = `${seat}:${colony.land}`;
  const held = byColony.get(key);
  if (held !== undefined && held.tick === ctx.tick) return held.value;
  const value = readIndustries(env, colony, buildings);
  if (value !== null) byColony.set(key, { tick: ctx.tick, value });
  return value;
}

/** What the colony's industries want in store past their workshops' inputs ({@link colonyIndustryWants}),
 *  units by good type: the stock policy's `wants`. */
export function colonyIndustryWantsOf(env: ColonyEnv, buildings: readonly Entity[]): Map<number, number> {
  const wants = new Map<number, number>();
  const industries = colonyIndustries(env, env.colony, buildings);
  if (industries === null) return wants;
  for (const { good, upTo } of colonyIndustryWants(industries.choices, industries.homeMakesHolyOil)) {
    const goodType = goodTypeByContentId(env.ctx.content, good)?.typeId;
    if (goodType !== undefined) wants.set(goodType, Math.max(wants.get(goodType) ?? 0, upTo));
  }
  return wants;
}
