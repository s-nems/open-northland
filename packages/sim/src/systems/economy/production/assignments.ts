import { JobAssignment, Production, type ProductionCycle, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { religionAllowsAtomic } from '../../lifecycle/needs/religion.js';
import { productionAtomic } from '../../readviews/production-atomic.js';
import { isWorkplaceOperator } from '../../stores/operators.js';

/** The assignment of a present operator no batch is executable for. */
export const FREE_SEAT = -1;

/** Oldest executable batch of its own per present operator, or {@link FREE_SEAT}. A suspended batch
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

/** The oldest executable batch of `cycles` for `operator` that none of the first `taken` entries of
 *  `claims` holds. */
function claimInto(
  world: World,
  ctx: SystemContext,
  building: Entity,
  cycles: readonly Readonly<ProductionCycle>[],
  operator: Entity,
  claims: readonly number[],
  taken: number,
): number {
  for (let index = 0; index < cycles.length; index++) {
    const cycle = cycles[index];
    if (
      cycle === undefined ||
      heldBy(claims, taken, index) ||
      !mayAdvanceCycle(world, ctx, building, operator, cycle)
    )
      continue;
    return index;
  }
  return FREE_SEAT;
}

function heldBy(claims: readonly number[], taken: number, index: number): boolean {
  for (let i = 0; i < taken; i++) if (claims[i] === index) return true;
  return false;
}

const NO_CYCLES: readonly Readonly<ProductionCycle>[] = [];

/** Claim the oldest executable batch for a production or planner pass. */
export function claimProductionCycle(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  claimed: Set<number>,
): number {
  const cycles = world.tryGet(building, Production)?.cycles ?? NO_CYCLES;
  for (let index = 0; index < cycles.length; index++) {
    const cycle = cycles[index];
    if (cycle === undefined || claimed.has(index) || !mayAdvanceCycle(world, ctx, building, operator, cycle))
      continue;
    claimed.add(index);
    return index;
  }
  return FREE_SEAT;
}

/** Whether `cycle` at `building` is `operator`'s to work: its own batch, an anonymous one, or one whose
 *  operator no longer works there. */
export function batchOpenTo(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  cycle: Readonly<ProductionCycle>,
): boolean {
  const owner = cycle.operator;
  return owner === null || owner === operator || !worksAt(world, ctx, building, owner);
}

/** {@link batchOpenTo}, while the operator's religion allows the craft. */
function mayAdvanceCycle(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  cycle: Readonly<ProductionCycle>,
): boolean {
  if (!batchOpenTo(world, ctx, building, operator, cycle)) return false;
  const atomic = productionAtomic(ctx.content, world.get(operator, Settler), cycle.goodType);
  return religionAllowsAtomic(world, ctx, operator, atomic, cycle.elapsed);
}

/** Whether `operator` is still posted to `building` in one of its operator trades. */
function worksAt(world: World, ctx: SystemContext, building: Entity, operator: Entity): boolean {
  if (world.tryGet(operator, JobAssignment)?.workplace !== building) return false;
  const jobType = world.tryGet(operator, Settler)?.jobType;
  return jobType !== null && jobType !== undefined && isWorkplaceOperator(world, ctx, building, jobType);
}
