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
import { isCarrierJob } from '../../stores/index.js';
import type { ComputerProfile } from '../difficulty.js';
import { LATE_GAME_FROM_TICKS } from '../game-phase.js';
import type { Promotions } from '../technology/promotion.js';
import type { Schooling } from '../technology/schooling.js';
import {
  type BuildingStaffing,
  buildingStaffing,
  type HeldStaff,
  LATE_GAME_CIVILIANS,
  type SeatStaffing,
} from './staffing-plan.js';
import { incrementStaffing, type StaffingTally } from './tally.js';

/** Whichever tier a staffing pass fills toward - see {@link staffBuildings}. */
export type StaffingTier = 'min' | 'target' | 'surplus';

/** The reserve while a build-order placement finds no spot (authored): the few sites the stall leaves
 *  need few hands, and every other man fells and digs the room the placement waits for. */
export const STALLED_BUILDER_CAP = 4;

/** The builder reserve of `profile`'s seat of `civilians` non-fighting settlers deciding at `tick`. */
export function builderCap(profile: ComputerProfile, civilians: number, tick: number): number {
  const { builders } = profile;
  if (tick >= LATE_GAME_FROM_TICKS) return builders.late;
  return civilians >= LATE_GAME_CIVILIANS ? builders.grown : builders.opening;
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
 * open, and a carrier-only workplace (the well, the hive) fills itself, so it needs no staff. Workplaces fill before storage within a tier, and
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
  const ordered = [
    ...seat.owned.filter(
      (e) => index.buildings.get(world.get(e, Building).buildingType)?.kind === 'workplace',
    ),
    ...seat.owned.filter((e) => index.buildings.get(world.get(e, Building).buildingType)?.kind === 'storage'),
  ];
  for (const building of ordered) {
    if (!isBuilt(world, building)) continue;
    const type = index.buildings.get(world.get(building, Building).buildingType);
    if (type === undefined) continue;
    const staffing = buildingStaffing(world, ctx, seat, building, type, heldAt(ctx, tally, building));
    if (staffing === null) continue;
    const operatorWant =
      tier === 'min'
        ? staffing.operatorMin
        : tier === 'target'
          ? staffing.operatorTarget
          : (staffing.operatorSurplus ?? staffing.operatorTarget);
    const carrierWant =
      tier === 'min'
        ? staffing.carrierMin
        : tier === 'target'
          ? staffing.carrierTarget
          : (staffing.carrierSurplus ?? staffing.carrierTarget);
    for (const slot of type.workers) {
      const carrier = isCarrierJob(ctx, slot.jobType);
      if (!carrier && index.harvestJobs.has(slot.jobType)) continue; // gatherer slots stay open
      if (type.kind === 'storage' && !carrier) continue; // storage staffs transport only
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
    // A store staffs transport only, so its hunters and fishers are not the plan's to release.
    (plan, type) =>
      type.kind === 'storage'
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
 * pool as a builder stays free for his trade's next post.
 */
export function reserveBuilders(
  world: World,
  force: SpareForce,
  builderJob: number | null,
  cap: number,
  ctx: SystemContext,
): PlayerCommand[] {
  if (builderJob === null) return [];
  const commands: PlayerCommand[] = [];
  let builders = 0;
  const greenFirst = (e: Entity): number => -tradeExperience(world, ctx, e);
  while (builders < cap) {
    const keep = force.take((e) => world.get(e, Settler).jobType === builderJob, greenFirst);
    if (keep === null) break;
    builders++;
  }
  while (builders < cap) {
    const spare = force.take(undefined, greenFirst);
    if (spare === null) break;
    commands.push({ kind: 'setJob', entity: spare, jobType: builderJob });
    builders++;
  }
  return commands;
}
