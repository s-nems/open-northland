import { JobAssignment, Production, type ProductionCycle, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { religionAllowsAtomic } from '../../lifecycle/needs/religion.js';
import { emptyNeedSubject, needSubjectInto, settlerMeetsNeed } from '../../progression/index.js';
import { productionAtomic } from '../../readviews/production-atomic.js';
import { isWorkplaceOperator } from '../../stores/operators.js';

/** The assignment of a present operator no batch is executable for. */
export const FREE_SEAT = -1;

/** The batch each present operator works ({@link claimInto}), or {@link FREE_SEAT}. A suspended batch
 * retains its paid materials and progress without blocking a different product or a replenished coworker. */
export function productionAssignments(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operators: readonly Entity[],
): number[] {
  return productionAssignmentsInto(world, ctx, building, operators, []);
}

/**
 * {@link productionAssignments} written over `out`, so a per-tick caller can reuse one list. Written by
 * index rather than emptied first: an emptied array drops its storage, so each pass would allocate it
 * again; an empty `operators` still answers, at that cost.
 */
export function productionAssignmentsInto(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operators: readonly Entity[],
  out: number[],
): number[] {
  const cycles = world.tryGet(building, Production)?.cycles ?? NO_CYCLES;
  for (let i = 0; i < operators.length; i++) {
    out[i] = claimInto(world, ctx, building, cycles, operators[i] as Entity, out, i);
  }
  if (out.length !== operators.length) out.length = operators.length;
  return out;
}

/** The batch of `cycles` that `operator` works and none of the first `taken` entries of `claims` holds: its
 *  own oldest it may craft, else the oldest one {@link leftOpenTo} it. */
function claimInto(
  world: World,
  ctx: SystemContext,
  building: Entity,
  cycles: readonly Readonly<ProductionCycle>[],
  operator: Entity,
  claims: readonly number[],
  taken: number,
): number {
  for (let sweep = OWN_SWEEP; sweep <= OPEN_SWEEP; sweep++) {
    const open = sweep === OPEN_SWEEP;
    for (let index = 0; index < cycles.length; index++) {
      const cycle = cycles[index];
      if (
        cycle === undefined ||
        heldBy(claims, taken, index) ||
        !worksBatch(world, ctx, building, operator, cycle, open)
      )
        continue;
      return index;
    }
  }
  return FREE_SEAT;
}

function heldBy(claims: readonly number[], taken: number, index: number): boolean {
  for (let i = 0; i < taken; i++) if (claims[i] === index) return true;
  return false;
}

const NO_CYCLES: readonly Readonly<ProductionCycle>[] = [];
const NO_CLAIMS: readonly number[] = [];

/** The two sweeps an operator makes over a workplace's batches: its own first, then the ones left open. */
const OWN_SWEEP = 0;
const OPEN_SWEEP = 1;

/** Claim the batch `operator` works ({@link claimInto}) for a production or planner pass. */
export function claimProductionCycle(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  claimed: Set<number>,
): number {
  const cycles = world.tryGet(building, Production)?.cycles ?? NO_CYCLES;
  for (let sweep = OWN_SWEEP; sweep <= OPEN_SWEEP; sweep++) {
    const open = sweep === OPEN_SWEEP;
    for (let index = 0; index < cycles.length; index++) {
      const cycle = cycles[index];
      if (
        cycle === undefined ||
        claimed.has(index) ||
        !worksBatch(world, ctx, building, operator, cycle, open)
      )
        continue;
      claimed.add(index);
      return index;
    }
  }
  return FREE_SEAT;
}

/** The batch `operator` works at `building` while no colleague holds one ({@link claimInto}). */
export function batchWorkedBy(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
): Readonly<ProductionCycle> | undefined {
  const cycles = world.tryGet(building, Production)?.cycles ?? NO_CYCLES;
  return cycles[claimInto(world, ctx, building, cycles, operator, NO_CLAIMS, 0)];
}

/** Whether `operator` works `cycle` now that its religion allows the craft: one of its own, or on the `open`
 *  sweep one {@link leftOpenTo} it. */
function worksBatch(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  cycle: Readonly<ProductionCycle>,
  open: boolean,
): boolean {
  const own = cycle.operator === operator;
  if (open ? own || !leftOpenTo(world, ctx, building, operator, cycle) : !own) return false;
  return mayCraft(world, ctx, operator, cycle);
}

/**
 * Whether `operator` may take over a colleague's `cycle`. One whose operator left `building`, or an
 * anonymous one, is anyone's, so its paid inputs are not lost. One whose operator still works here but may
 * not craft it now passes only to a colleague whose trade has earned that ware, whatever it was set to make.
 */
function leftOpenTo(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  cycle: Readonly<ProductionCycle>,
): boolean {
  const owner = cycle.operator;
  if (owner === null || !worksAt(world, ctx, building, owner)) return true;
  if (mayCraft(world, ctx, owner, cycle)) return false;
  return settlerMeetsNeed(
    world,
    ctx,
    needSubjectInto(world, operator, subjectScratch),
    'good',
    cycle.goodType,
  );
}

/** The need subject {@link leftOpenTo} reads, rewritten per call. */
const subjectScratch = emptyNeedSubject();

/** Whether `operator`'s religion lets it advance `cycle` now. */
function mayCraft(
  world: World,
  ctx: SystemContext,
  operator: Entity,
  cycle: Readonly<ProductionCycle>,
): boolean {
  const atomic = productionAtomic(ctx.content, world.get(operator, Settler), cycle.goodType);
  return religionAllowsAtomic(world, ctx, operator, atomic, cycle.elapsed);
}

/** Whether `operator` is still posted to `building` in one of its operator trades. */
function worksAt(world: World, ctx: SystemContext, building: Entity, operator: Entity): boolean {
  if (world.tryGet(operator, JobAssignment)?.workplace !== building) return false;
  const jobType = world.tryGet(operator, Settler)?.jobType;
  return jobType !== null && jobType !== undefined && isWorkplaceOperator(world, ctx, building, jobType);
}
