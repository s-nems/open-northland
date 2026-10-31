import type { BuildingType } from '@open-northland/data';
import { Building, Carrying, CurrentAtomic, JobAssignment, Settler } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { isBuilt, ownedSettlers } from '../../ai-shared/seat-roster.js';
import { byExperience, experienceRank, tradeExperience } from '../../ai-shared/workforce/experience.js';
import type { SpareForce } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { isServedConstructionSite } from '../../settlers/targets/index.js';
import { isCarrierJob } from '../../stores/index.js';
import { type ComputerProfile, shareOf } from '../difficulty.js';
import { LATE_GAME_FROM_TICKS } from '../game-phase.js';
import type { Promotions } from '../technology/promotion.js';
import type { Schooling } from '../technology/schooling.js';
import { inFoodChain } from './food.js';
import { buildingStaffing, type HeldStaff, LATE_GAME_CIVILIANS, type SeatStaffing } from './staffing-plan.js';
import type { BuildingStaffing } from './staffing-rows.js';
import { incrementStaffing, type StaffingTally } from './tally.js';

/** Whichever tier a staffing pass fills toward - see {@link staffBuildings}. `food` is the first hand of
 *  each food chain workplace ({@link inFoodChain}) within its minimum tier, carriers left out. */
export type StaffingTier = 'food' | 'min' | 'target' | 'surplus';

/** The operators the `food` tier posts per food chain workplace (owner ruling: food production outranks
 *  population and weapons). Authored: on battle_for_the_four_hills_multiplayer (seed 7) seats of twelve
 *  men whose builders, gatherers, potter and mason came first left the farm, the animal farm and the
 *  bakery without a hand for 30-60 minutes, their store food at 0-3 and the homes closed. */
export const FOOD_CHAIN_FIRST_HANDS = 1;

/** The reserve's floor while a build-order placement finds no spot (authored): every man the open sites
 *  do not call for ({@link stalledBuilderLimit}) fells and digs the room the placement waits for. */
export const STALLED_BUILDER_CAP = 4;

/** The builders each open construction site of the seat keeps out of the gatherer posts (authored): one
 *  carries the bill while another raises it. Basis: on mroczny_las (seed 7) a seat with three sites and
 *  two or three builders left a site at 60% for over fifteen minutes with its wood and stone in stock. */
export const BUILDERS_PER_OPEN_SITE = 2;

/** The builders the seat's open sites among `owned` call for, upgrades included, at most `cap`. A
 *  workshop's vehicle site is left out: builders never serve it. */
export function siteBuilderFloor(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  cap: number,
): number {
  let sites = 0;
  for (const e of owned) if (isServedConstructionSite(world, ctx.content, e)) sites++;
  return Math.min(cap, sites * BUILDERS_PER_OPEN_SITE);
}

/** The builder reserve while a placement is stalled, out of the seat's `cap`: {@link STALLED_BUILDER_CAP},
 *  or the open sites' pairs ({@link siteBuilderFloor}) when they call for more, so the sites already standing
 *  still rise while the clearing posts take the rest. Authored: on ciezka_wspolpraca and smocza_kraina
 *  (cramped seats, seed 7) seats whose steps found no spot kept 2-4 builders for five to eight open sites
 *  from minute 15 to 70, home sites and the bakery open 20-50 minutes, while 9-18 gatherers piled 150-1060
 *  wood and 100-285 stone. */
export function stalledBuilderLimit(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  cap: number,
): number {
  return Math.min(cap, Math.max(STALLED_BUILDER_CAP, siteBuilderFloor(world, ctx, owned, cap)));
}

/** The builders a seat with open sites keeps ahead of its scout and its generic posts (authored, the
 *  pair {@link BUILDERS_PER_OPEN_SITE} puts on one site). Basis: on specjalna_forteca (seed 7) a seat of six
 *  men posted its gatherers, hunter, scout and farmer and kept no builder for 90 minutes. */
export const CORE_BUILDERS = 2;

/** The core of the open sites' `builderFloor` ({@link siteBuilderFloor}): none while no site is open. */
export function coreBuilderFloor(builderFloor: number): number {
  return Math.min(builderFloor, CORE_BUILDERS);
}

/** The seat's men of the builder trade, spare or bound to a site. */
export function seatBuilderCount(world: World, player: number, builderJob: number | null): number {
  if (builderJob === null) return 0;
  let builders = 0;
  for (const e of ownedSettlers(world, player)) if (world.get(e, Settler).jobType === builderJob) builders++;
  return builders;
}

/** The builder reserve of `profile`'s seat of `civilians` non-fighting settlers deciding at `tick`: the
 *  phase's figure, grown by the profile's share of the civilians past {@link LATE_GAME_CIVILIANS}. The
 *  reserve claims only spare men after the minimum crews, and the army floor may reclaim it past the open
 *  sites' builders, so the growth takes no workshop's first hands and no draft. */
export function builderCap(profile: ComputerProfile, civilians: number, tick: number): number {
  const { builders } = profile;
  const grown = civilians >= LATE_GAME_CIVILIANS;
  const base = tick >= LATE_GAME_FROM_TICKS ? builders.late : grown ? builders.grown : builders.opening;
  if (builders.perCivilian === null || !grown) return base;
  return base + shareOf(civilians - LATE_GAME_CIVILIANS, builders.perCivilian);
}

/** Where a gated slot no spare man qualifies for gets its man: a school lesson while a standing school
 *  teaches the trade, else a promotion. */
export interface GatedSlotSources {
  readonly schooling: Schooling;
  readonly promotions: Promotions;
}

/**
 * Staff each built workplace and storage toward its plan's tier ({@link buildingStaffing}), where an
 * operator is a non-carrier, non-gatherer slot. Each post goes to the spare man most experienced on the
 * slot trade's general track who qualifies for it (`settlerMeetsNeed`). A slot no spare man qualifies for
 * takes a pupil of the trade's school lesson ({@link Schooling}), counted as filling it until he
 * graduates, or with no school teaching the trade a promotion ({@link Promotions}). Gatherer slots stay
 * open, and a carrier-only workplace (the well, the hive) fills itself, so it needs no staff. Workplaces fill
 * before training buildings and those before storage within a tier, and
 * all tiers advance one shared {@link StaffingTally} because the commands apply only next tick.
 */
export function staffBuildings(
  world: World,
  ctx: SystemContext,
  seat: SeatStaffing,
  force: SpareForce,
  tally: StaffingTally,
  tier: StaffingTier,
  gated: GatedSlotSources,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const index = contentIndex(ctx.content);
  const ofKind = (kind: BuildingType['kind']): Entity[] =>
    seat.owned.filter((e) => index.buildings.get(world.get(e, Building).buildingType)?.kind === kind);
  const ordered =
    tier === 'food'
      ? ofKind('workplace')
      : [...ofKind('workplace'), ...ofKind('training'), ...ofKind('storage')];
  for (const building of ordered) {
    if (!isBuilt(world, building)) continue;
    const type = index.buildings.get(world.get(building, Building).buildingType);
    if (type === undefined || (tier === 'food' && !inFoodChain(ctx, type))) continue;
    const staffing = buildingStaffing(world, ctx, seat, building, type, heldAt(ctx, tally, building));
    if (staffing === null) continue;
    const operatorWant =
      tier === 'food'
        ? Math.min(staffing.operatorMin, FOOD_CHAIN_FIRST_HANDS)
        : tier === 'min'
          ? staffing.operatorMin
          : tier === 'target'
            ? staffing.operatorTarget
            : (staffing.operatorSurplus ?? staffing.operatorTarget);
    const carrierWant =
      tier === 'food'
        ? 0
        : tier === 'min'
          ? staffing.carrierMin
          : tier === 'target'
            ? staffing.carrierTarget
            : (staffing.carrierSurplus ?? staffing.carrierTarget);
    for (const slot of type.workers) {
      const carrier = isCarrierJob(ctx, slot.jobType);
      if (!carrier && index.harvestJobs.has(slot.jobType)) continue; // gatherer slots stay open
      if (type.kind !== 'workplace' && !carrier) continue; // a store or a barracks staffs transport only
      const want = Math.min(slot.count, carrier ? carrierWant : operatorWant);
      const held =
        (tally.get(building)?.get(slot.jobType) ?? 0) + gated.schooling.promised(building, slot.jobType);
      const veteranFirst = held < want ? experienceRank(world, ctx, slot.jobType) : undefined;
      const qualifies = (e: Entity): boolean =>
        settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', slot.jobType);
      for (let i = held; i < want; i++) {
        let spare = force.take(qualifies, veteranFirst);
        if (spare === null) {
          const lesson = gated.schooling.enrol(slot.jobType, building, force);
          if (lesson.kind === 'learn') commands.push(lesson.command);
          if (lesson.kind === 'learn' || lesson.kind === 'promised') continue;
          // A promotion seats a building's first man of the trade only, so a second post never strips the
          // predecessor trade a second time.
          if (lesson.kind === 'none' && i === 0) spare = gated.promotions.take(slot.jobType);
        }
        if (spare === null) {
          if (!force.any()) return commands; // pool dry - the rest waits for grown sons
          break; // nobody qualifies for this trade yet
        }
        commands.push({ kind: 'assignWorker', entity: spare, building, jobPriority: [slot.jobType] });
        incrementStaffing(tally, building, slot.jobType);
      }
    }
  }
  return commands;
}

/** Whether `job` is an operator trade: neither a transport carrier nor a flag gatherer. */
function isOperatorJob(ctx: SystemContext, job: number): boolean {
  return !isCarrierJob(ctx, job) && !contentIndex(ctx.content).harvestJobs.has(job);
}

/** Who `building` employs by `tally`. */
function heldAt(ctx: SystemContext, tally: StaffingTally, building: Entity): HeldStaff {
  let operators = 0;
  let carriers = 0;
  const jobs = tally.get(building);
  if (jobs === undefined) return { operators, carriers };
  // keys() plus get: destructured entries would allocate a pair per job of every building asked.
  for (const job of jobs.keys()) {
    const count = jobs.get(job) ?? 0;
    if (isCarrierJob(ctx, job)) carriers += count;
    else if (isOperatorJob(ctx, job)) operators += count;
  }
  return { operators, carriers };
}

/**
 * Hand back as builders the carriers a built workplace or store employs beyond its plan's highest carrier
 * tier, as after an upgrade into a tier that plans fewer, once a supply carrier's goods are plentiful again,
 * or while the seat is too small for store carriers.
 */
export function releaseSurplusCarriers(
  world: World,
  ctx: SystemContext,
  seat: SeatStaffing,
  tally: StaffingTally,
  builderJob: number | null,
): PlayerCommand[] {
  return releaseSurplus(
    world,
    ctx,
    seat,
    tally,
    builderJob,
    (job) => isCarrierJob(ctx, job),
    (plan) => plan.carrierSurplus ?? plan.carrierTarget,
  );
}

/**
 * Hand back as builders the operators a built workplace employs beyond the highest tier its plan staffs,
 * as once a product-gated second craftsman's goods are plentiful or a workshop's products all lie at glut
 * ({@link buildingStaffing}).
 */
export function releaseSurplusOperators(
  world: World,
  ctx: SystemContext,
  seat: SeatStaffing,
  tally: StaffingTally,
  builderJob: number | null,
): PlayerCommand[] {
  return releaseSurplus(
    world,
    ctx,
    seat,
    tally,
    builderJob,
    (job) => isOperatorJob(ctx, job),
    // A store or a barracks staffs transport only, so its hunters, fishers and trainees are not the plan's
    // to release.
    (plan, type) =>
      type.kind !== 'workplace'
        ? Number.POSITIVE_INFINITY
        : Math.max(plan.operatorMin, plan.operatorTarget, plan.operatorSurplus ?? 0),
  );
}

/** One trade's staff at a workplace, in the canonical settler walk's order. */
interface StaffRow {
  readonly job: number;
  readonly staff: Entity[];
}

/**
 * Hand back as builders each built building's staff of the `role` trades beyond the plan's `keep` count,
 * per trade. The most experienced on the trade's general track keep their posts, the lowest id on a tie,
 * so the kept set is deterministic. A man mid-action or holding a load is left until he is free, since
 * the trade change would cancel the one or drop the other.
 */
function releaseSurplus(
  world: World,
  ctx: SystemContext,
  seat: SeatStaffing,
  tally: StaffingTally,
  builderJob: number | null,
  role: (job: number) => boolean,
  keep: (plan: BuildingStaffing, type: BuildingType) => number,
): PlayerCommand[] {
  if (builderJob === null) return [];
  const index = contentIndex(ctx.content);
  // Insertion follows the canonical settler walk, so the kept posts and the command order are deterministic.
  // A workplace employs a trade or two, so its staff rows are a list scanned by job.
  const workplaces: Entity[] = [];
  const staffByWorkplace = new Map<Entity, StaffRow[]>();
  for (const e of ownedSettlers(world, seat.player)) {
    const workplace = world.tryGet(e, JobAssignment)?.workplace;
    const job = world.get(e, Settler).jobType;
    if (workplace === undefined || job === null || !role(job)) continue;
    let rows = staffByWorkplace.get(workplace);
    if (rows === undefined) {
      rows = [];
      staffByWorkplace.set(workplace, rows);
      workplaces.push(workplace);
    }
    let r = 0;
    while (r < rows.length && (rows[r] as StaffRow).job !== job) r++;
    if (r < rows.length) (rows[r] as StaffRow).staff.push(e);
    else rows.push({ job, staff: [e] });
  }
  const commands: PlayerCommand[] = [];
  for (const workplace of workplaces) {
    if (!isBuilt(world, workplace)) continue;
    const type = index.buildings.get(world.get(workplace, Building).buildingType);
    if (type === undefined) continue;
    const plan = buildingStaffing(world, ctx, seat, workplace, type, heldAt(ctx, tally, workplace));
    if (plan === null) continue;
    for (const { job, staff } of staffByWorkplace.get(workplace) ?? []) {
      const kept = keep(plan, type);
      if (staff.length <= kept) continue;
      for (const e of byExperience(staff, experienceRank(world, ctx, job)).slice(kept)) {
        if (world.has(e, CurrentAtomic) || world.has(e, Carrying)) continue;
        if (seat.apprentices?.has(e) ?? false) continue; // earning a discovery at this post
        commands.push({ kind: 'setJob', entity: e, jobType: builderJob });
      }
    }
  }
  return commands;
}

/**
 * Claim up to `cap` pool men as builders, existing builders first so the crew does not churn. Claiming
 * rather than posting leaves the later tiers only the surplus beyond the reserve; the cap is one-way and
 * never demotes a man. Among the existing builders and again among the fresh men, the reserve takes the
 * least experienced in other trades first ({@link tradeExperience}), so a released veteran waiting in the
 * pool as a builder stays free for his trade's next post. `reserved` lists the claimed men in claim order.
 */
export function reserveBuilders(
  world: World,
  force: SpareForce,
  builderJob: number | null,
  cap: number,
  ctx: SystemContext,
): { readonly commands: PlayerCommand[]; readonly reserved: readonly Entity[] } {
  const reserved: Entity[] = [];
  if (builderJob === null) return { commands: [], reserved };
  const commands: PlayerCommand[] = [];
  const greenFirst = (e: Entity): number => -tradeExperience(world, ctx, e);
  while (reserved.length < cap) {
    const keep = force.take((e) => world.get(e, Settler).jobType === builderJob, greenFirst);
    if (keep === null) break;
    reserved.push(keep);
  }
  while (reserved.length < cap) {
    const spare = force.take(undefined, greenFirst);
    if (spare === null) break;
    commands.push({ kind: 'setJob', entity: spare, jobType: builderJob });
    reserved.push(spare);
  }
  return { commands, reserved };
}
