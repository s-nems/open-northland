import { Building, Carrying, MoveGoal, Person, Position, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { interactionNode } from '../footprint/index.js';
import { assignedWorkers } from './assigned-workers.js';

// Who is working a workplace right now: which of its declared slots (./workplace.ts) operate the craft,
// and which settlers stand at the door filling them.

/** The operator jobs of a workplace, the content index's `operatorJobsByBuilding` row for its type. */
function operatorJobsOf(world: World, ctx: SystemContext, building: Entity): ReadonlySet<number> {
  const b = world.tryGet(building, Building);
  if (b === undefined) return EMPTY_JOBS;
  return contentIndex(ctx.content).operatorJobsByBuilding.get(b.buildingType) ?? EMPTY_JOBS;
}

const EMPTY_JOBS: ReadonlySet<number> = new Set<number>();

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
  const present: Entity[] = [];
  return scanPresent(world, ctx, building, jobs, present) > 0
    ? { kind: 'staffed', operators: present }
    : DESERTED;
}

/** {@link presentOperators} counted through {@link operatorCountOf}, listing nobody. */
export function presentOperatorCount(world: World, ctx: SystemContext, building: Entity): number {
  const jobs = operatorJobsOf(world, ctx, building);
  if (jobs.size === 0) return UNSTAFFED_OPERATOR_COUNT;
  return scanPresent(world, ctx, building, jobs, undefined);
}

/** How many operators stand on station, each pushed onto `present` when given. */
function scanPresent(
  world: World,
  ctx: SystemContext,
  building: Entity,
  jobs: ReadonlySet<number>,
  present: Entity[] | undefined,
): number {
  const at = interactionNode(world, ctx, building);
  if (at === null) return 0; // a placed-but-position-less workplace can't be stood on
  const cap = operatorSlotHeadcount(world, ctx, building, jobs);
  const workers = assignedWorkers(world, building);
  let count = 0;
  for (let i = 0; i < workers.length && count < cap; i++) {
    // Ascending ids, so the clamp keeps the lowest.
    const e = workers[i] as Entity;
    if (!world.has(e, Person) || world.has(e, MoveGoal) || world.has(e, Carrying)) continue;
    const p = world.tryGet(e, Position);
    if (p === undefined || nodeHxOfPosition(p.x, p.y) !== at.x || nodeHyOfPosition(p.y) !== at.y) continue;
    const jobType = world.tryGet(e, Settler)?.jobType;
    if (jobType === null || jobType === undefined || !jobs.has(jobType)) continue;
    present?.push(e);
    count++;
  }
  return count;
}

const UNSTAFFED: WorkplaceOperators = { kind: 'unstaffed' };
const DESERTED: WorkplaceOperators = { kind: 'staffed', operators: [] };

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
