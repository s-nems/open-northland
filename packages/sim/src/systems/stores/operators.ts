import { Building, Carrying, MoveGoal, Person, Position, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { interactionNode } from '../footprint/index.js';
import { assignedWorkers } from './assigned-workers.js';
import { buildingWorkerJobs, isCarrierJob } from './workplace.js';

// Who is working a workplace right now: which of its declared slots (./workplace.ts) operate the craft,
// and which settlers stand at the door filling them.

/**
 * The operator jobs of a workplace: its worker-slot jobs minus the carrier and gatherer trades, so a
 * gatherer fetching a workshop's raw input never satisfies the production worker-presence gate. A
 * carrier-or-gatherer-only type keeps its slots, since the well's lone carrier is its operator.
 * Approximation: the readable data does not say which slot operates the craft.
 */
function operatorJobsOf(world: World, ctx: SystemContext, building: Entity): ReadonlySet<number> {
  const jobs = buildingWorkerJobs(world, ctx, building);
  if (jobs.size === 0) return jobs;
  const harvest = contentIndex(ctx.content).harvestJobs;
  const operators = new Set<number>();
  for (const job of jobs) if (!isCarrierJob(ctx, job) && !harvest.has(job)) operators.add(job);
  return operators.size > 0 ? operators : jobs;
}

/** Whether `jobType` is one of `building`'s {@link operatorJobsOf}, the trades whose presence runs the craft. */
export function isWorkplaceOperator(
  world: World,
  ctx: SystemContext,
  building: Entity,
  jobType: number,
): boolean {
  return operatorJobsOf(world, ctx, building).has(jobType);
}

/**
 * A workplace's operator staffing: `unstaffed` when the type declares no operator slots, so it works at a
 * base rate with no entity to attribute the work to; `staffed` lists the settlers at the door, empty once
 * they have all walked away.
 */
export type WorkplaceOperators =
  | { readonly kind: 'unstaffed' }
  | { readonly kind: 'staffed'; readonly operators: readonly Entity[] };

/** The base-rate headcount an unstaffed-by-design workplace works at, so a passive fixture keeps running. */
const UNSTAFFED_OPERATOR_COUNT = 1;

/**
 * The operators on station at a workplace: its assigned settlers whose job is one of its
 * {@link operatorJobsOf}, standing on the {@link interactionNode} since the walls themselves are
 * walk-blocked. Listed in ascending id and capped at the type's declared operator-slot headcount, so
 * crowding extra settlers onto the door cannot overclock past the staffing plan.
 */
export function presentOperators(world: World, ctx: SystemContext, building: Entity): WorkplaceOperators {
  const jobs = operatorJobsOf(world, ctx, building);
  if (jobs.size === 0) return UNSTAFFED;
  const at = interactionNode(world, ctx, building);
  if (at === null) return DESERTED; // a placed-but-position-less workplace can't be stood on
  const cap = operatorSlotHeadcount(world, ctx, building, jobs);
  if (cap <= 0) return DESERTED;
  const present: Entity[] = [];
  for (const e of assignedWorkers(world, building)) {
    if (present.length === cap) break; // ascending ids, so the clamp keeps the lowest
    if (!world.has(e, Person) || world.has(e, MoveGoal) || world.has(e, Carrying)) continue;
    const p = world.tryGet(e, Position);
    if (p === undefined || nodeHxOfPosition(p.x, p.y) !== at.x || nodeHyOfPosition(p.y) !== at.y) continue;
    const jobType = world.tryGet(e, Settler)?.jobType;
    if (jobType !== null && jobType !== undefined && jobs.has(jobType)) present.push(e);
  }
  return { kind: 'staffed', operators: present };
}

const UNSTAFFED: WorkplaceOperators = { kind: 'unstaffed' };
const DESERTED: WorkplaceOperators = { kind: 'staffed', operators: Object.freeze([]) };

/**
 * How many operators a {@link presentOperators} result is worth to the production rate: one anonymous
 * operator when the type is unstaffed-by-design, else the settlers on station, and zero pauses the craft.
 * Approximation: one batch advances per operator per tick; the original's staffing rule is unknown.
 */
export function operatorCountOf(operators: WorkplaceOperators): number {
  switch (operators.kind) {
    case 'unstaffed':
      return UNSTAFFED_OPERATOR_COUNT;
    case 'staffed':
      return operators.operators.length;
  }
}

/** The operator seats a workplace type declares, read from content alone with no settler scan. */
export function operatorSlotCapacity(world: World, ctx: SystemContext, building: Entity): number {
  const jobs = operatorJobsOf(world, ctx, building);
  if (jobs.size === 0) return UNSTAFFED_OPERATOR_COUNT;
  return operatorSlotHeadcount(world, ctx, building, jobs);
}

export function presentOperatorCount(world: World, ctx: SystemContext, building: Entity): number {
  return operatorCountOf(presentOperators(world, ctx, building));
}

function operatorSlotHeadcount(
  world: World,
  ctx: SystemContext,
  building: Entity,
  jobs: ReadonlySet<number>,
): number {
  const b = world.tryGet(building, Building);
  if (b === undefined) return 0;
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  let headcount = 0;
  for (const slot of type?.workers ?? []) if (jobs.has(slot.jobType)) headcount += slot.count;
  return headcount;
}
