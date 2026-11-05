import { BUILDING_KIND } from '@open-northland/data';
import {
  Building,
  Female,
  Marriage,
  playerPlacementTribes,
  Residence,
  UnderConstruction,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { buildingTypeByContentId } from '../../ai-shared/content-lookup.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { mayMarry } from '../../family/eligibility.js';
import { familiesOf } from '../../family/households.js';
import { ROOM_HOME_BUILDING } from '../build-order/room.js';
import { topEnabledTier } from '../top-tier.js';
import type { ColonyEnv, ColonyView } from './env.js';
import { type ChainStep, chainStepOf, nextIndustrySteps } from './industry.js';
import { colonyIndustries, roomFor, stepType } from './industry-read.js';
import { colonyFed } from './provision.js';
import { colonists } from './roster.js';
import { schoolLacking } from './school.js';
import type { StepGround } from './spot.js';
import { towersLacking } from './towers.js';

/** The open sites a colony's builders work at once besides its industries' (authored): its hold pays for
 *  little more. */
export const COLONY_OPEN_SITES = 2;
/** The open sites its industries hold at once (authored), apart from the others: each chain raises one
 *  building at a time, so a stuck site holds back its own chain and this many chains go up together. */
const COLONY_INDUSTRY_SITES = 2;

/** The sites a colony has open, its industries' apart. */
export interface OpenSites {
  readonly industry: number;
  readonly other: number;
}

/** The colony's open sites, its industries' apart: an upgrading building is a site of its kind. */
export function openSites(env: ColonyEnv, buildings: readonly Entity[]): OpenSites {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const open = { industry: 0, other: 0 };
  for (const e of buildings) {
    if (!world.has(e, UnderConstruction)) continue;
    const id = index.buildings.get(world.get(e, Building).buildingType)?.id;
    if (id !== undefined && chainStepOf(id) !== undefined) open.industry++;
    else open.other++;
  }
  return open;
}

/** Whether `building` may go up beside the colony's `open` sites: within its kind's budget, so a home
 *  waiting on its bill holds back no workshop and the other way round. */
export function siteFree(building: string, open: OpenSites): boolean {
  return chainStepOf(building) === undefined
    ? open.other < COLONY_OPEN_SITES
    : open.industry < COLONY_INDUSTRY_SITES;
}

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
  /** The family slots it keeps free ahead of its families: the next home's. */
  readonly ahead: number;
}

/** Owner ruling: a colony with room builds homes as it needs, no fixed number, and a roomy colony grows the
 *  seat's people: one more home while it is fed and roomy and its homeless families, with a home's slots
 *  ahead for the couples the ferry brings, outnumber its free slots. Its room and its food bound how far. */
export function homeStepDue(read: HomesRead): boolean {
  if (!read.fed || !read.roomy) return false;
  return read.homeless + read.ahead > read.freeSlots;
}

/** The ground the chain asks of `building`. */
export function stepGround(building: string): StepGround {
  return chainStepOf(building)?.ground ?? 'any';
}

/** Whether `building` is a chain's workshop whose spot may lie past the store's walk range. */
export function farStep(building: string): boolean {
  return chainStepOf(building)?.far === true;
}

/** The building `step` is raised as now ({@link stepType}), or its base. */
function placedId(env: ColonyEnv, step: ChainStep): string {
  return stepType(env, step)?.id ?? step.building;
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
  const base = buildingTypeByContentId(ctx.content, ROOM_HOME_BUILDING);
  const tribe = playerPlacementTribes(world, seat)?.[0];
  if (base === undefined || tribe === undefined) return [];
  // Owner ruling: a colony home goes to the top level at once, since the trader brings its materials.
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
    ahead: type.homeSize,
  });
  return due ? [type.id] : [];
}

/** What the colony means to raise, in order: its unplaced rows; then its school (`./school.ts`), the next
 *  step of its industries (`./industry.ts`), the towers its garrison mans and its homes. Owner ruling: it
 *  raises no pottery or mason hut, home makes their goods. */
export function colonyPlan(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
): readonly string[] {
  const rows = colony.builds.filter((b) => !b.placed).map((b) => b.building);
  if (rows.length > 0) return rows;
  const industries = colonyIndustries(env, colony, buildings);
  const steps = industries === null ? [] : nextIndustrySteps(industries.choices, industries.read);
  const towers = towersLacking(env, colony, buildings);
  return [
    ...schoolLacking(env, buildings),
    ...steps.map((step) => placedId(env, step)),
    ...towers,
    ...homeStep(env, colony, buildings),
  ];
}
