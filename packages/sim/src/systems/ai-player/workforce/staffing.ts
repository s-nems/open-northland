import type { BuildingType } from '@open-northland/data';
import { Building, Carrying, CurrentAtomic, JobAssignment, Settler } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isCarrierJob } from '../../stores/index.js';
import { isBuilt, ownedSettlers } from '../seat-roster.js';
import type { SpareForce } from './pool.js';
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

/** How many builders the pool keeps (authored), enough for the build order's two sites at once. Claimed
 *  right after minimum staffing, so construction never starves, and before every top-up tier, so the
 *  surplus ladder distributes only what is beyond the reserve. */
export const BUILDER_CAP = 12;

/** The reserve of a grown settlement, from {@link LATE_GAME_CIVILIANS} civilians on (authored). */
export const LATE_GAME_BUILDER_CAP = 14;

/** The builder reserve for a seat of `civilians` non-fighting settlers. */
export function builderCap(civilians: number): number {
  return civilians >= LATE_GAME_CIVILIANS ? LATE_GAME_BUILDER_CAP : BUILDER_CAP;
}

/**
 * Staff each built workplace and storage toward its plan's tier ({@link buildingStaffing}), where an
 * operator is a non-carrier, non-gatherer slot. Gatherer slots stay open, and a carrier-only workplace
 * (the well, the hive) fills itself, so it needs no staff. Workplaces fill before storage within a tier, and
 * all tiers advance one shared {@link StaffingTally} because the commands apply only next tick.
 */
export function staffBuildings(
  world: World,
  ctx: SystemContext,
  seat: SeatStaffing,
  force: SpareForce,
  tally: StaffingTally,
  tier: StaffingTier,
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
      const held = tally.get(building)?.get(slot.jobType) ?? 0;
      for (let i = held; i < want; i++) {
        const spare = force.take();
        if (spare === null) return commands; // pool dry - the rest waits for grown sons
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
  for (const [job, count] of tally.get(building) ?? []) {
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

/**
 * Hand back as builders each built building's staff of the `role` trades beyond the plan's `keep` count,
 * per trade. The lowest ids keep their posts; a man mid-action or holding a load is left until he is free,
 * since the trade change would cancel the one or drop the other.
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
  const staffByWorkplace = new Map<Entity, Map<number, Entity[]>>();
  for (const e of ownedSettlers(world, seat.player)) {
    const workplace = world.tryGet(e, JobAssignment)?.workplace;
    const job = world.get(e, Settler).jobType;
    if (workplace === undefined || job === null || !role(job)) continue;
    const byJob = staffByWorkplace.get(workplace) ?? new Map<number, Entity[]>();
    staffByWorkplace.set(workplace, byJob);
    const staff = byJob.get(job);
    if (staff === undefined) byJob.set(job, [e]);
    else staff.push(e);
  }
  const commands: PlayerCommand[] = [];
  for (const [workplace, byJob] of staffByWorkplace) {
    if (!isBuilt(world, workplace)) continue;
    const type = index.buildings.get(world.get(workplace, Building).buildingType);
    if (type === undefined) continue;
    const plan = buildingStaffing(world, ctx, seat, workplace, type, heldAt(ctx, tally, workplace));
    if (plan === null) continue;
    for (const staff of byJob.values()) {
      for (const e of staff.slice(keep(plan, type))) {
        if (world.has(e, CurrentAtomic) || world.has(e, Carrying)) continue;
        commands.push({ kind: 'setJob', entity: e, jobType: builderJob });
      }
    }
  }
  return commands;
}

/**
 * Claim up to `cap` pool men as builders, existing builders first so the crew does not churn. Claiming
 * rather than posting leaves the later tiers only the surplus beyond the reserve; the cap is one-way and
 * never demotes a man.
 */
export function reserveBuilders(
  world: World,
  force: SpareForce,
  builderJob: number | null,
  cap: number,
): PlayerCommand[] {
  if (builderJob === null) return [];
  const commands: PlayerCommand[] = [];
  let builders = 0;
  while (builders < cap) {
    const keep = force.take((e) => world.get(e, Settler).jobType === builderJob);
    if (keep === null) break;
    builders++;
  }
  while (builders < cap) {
    const spare = force.take();
    if (spare === null) break;
    commands.push({ kind: 'setJob', entity: spare, jobType: builderJob });
    builders++;
  }
  return commands;
}
