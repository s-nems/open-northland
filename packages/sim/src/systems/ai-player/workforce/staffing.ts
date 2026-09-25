import { Building, Carrying, CurrentAtomic, JobAssignment, Settler } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isCarrierJob } from '../../stores/index.js';
import { isBuilt, ownedSettlers } from '../seat-roster.js';
import type { SpareForce } from './pool.js';
import { buildingStaffing, LATE_GAME_CIVILIANS, type SeatStaffing } from './staffing-plan.js';
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
    const staffing = buildingStaffing(world, ctx, seat, building, type, carriersAt(ctx, tally, building) > 0);
    if (staffing === null) continue;
    const operatorWant =
      tier === 'min'
        ? staffing.operatorMin
        : tier === 'target'
          ? staffing.operatorTarget
          : (staffing.operatorSurplus ?? staffing.operatorTarget);
    const carrierWant = tier === 'min' ? staffing.carrierMin : staffing.carrierTarget;
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

/** How many transport carriers `building` employs by `tally`. */
function carriersAt(ctx: SystemContext, tally: StaffingTally, building: Entity): number {
  let carriers = 0;
  for (const [job, count] of tally.get(building) ?? []) if (isCarrierJob(ctx, job)) carriers += count;
  return carriers;
}

/**
 * Hand back as builders the carriers a built workplace employs beyond its plan's carrier target, as after
 * an upgrade into a tier that plans fewer or once a supply carrier's goods are plentiful again. The
 * lowest-id carriers keep their posts; a man mid-action or holding a load is left until he is free, since
 * the trade change would cancel the one or drop the other.
 */
export function releaseSurplusCarriers(
  world: World,
  ctx: SystemContext,
  seat: SeatStaffing,
  builderJob: number | null,
): PlayerCommand[] {
  if (builderJob === null) return [];
  const index = contentIndex(ctx.content);
  // Insertion follows the canonical settler walk, so the kept posts and the command order are deterministic.
  const carriersByWorkplace = new Map<Entity, Entity[]>();
  for (const e of ownedSettlers(world, seat.player)) {
    const workplace = world.tryGet(e, JobAssignment)?.workplace;
    const job = world.get(e, Settler).jobType;
    if (workplace === undefined || job === null || !isCarrierJob(ctx, job)) continue;
    const carriers = carriersByWorkplace.get(workplace);
    if (carriers === undefined) carriersByWorkplace.set(workplace, [e]);
    else carriers.push(e);
  }
  const commands: PlayerCommand[] = [];
  for (const [workplace, carriers] of carriersByWorkplace) {
    if (!isBuilt(world, workplace)) continue;
    const type = index.buildings.get(world.get(workplace, Building).buildingType);
    const staffing =
      type === undefined ? null : buildingStaffing(world, ctx, seat, workplace, type, carriers.length > 0);
    if (staffing === null) continue;
    for (const e of carriers.slice(staffing.carrierTarget)) {
      if (world.has(e, CurrentAtomic) || world.has(e, Carrying)) continue;
      commands.push({ kind: 'setJob', entity: e, jobType: builderJob });
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
