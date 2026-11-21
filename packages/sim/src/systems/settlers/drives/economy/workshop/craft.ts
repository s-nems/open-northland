import {
  addCurrentAtomic,
  Production,
  removeCurrentAtomic,
  Settler,
  workClockTicks,
} from '../../../../../components/index.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { productionAssignmentsInto } from '../../../../economy/production/assignments.js';
import { religionAllowsAtomic } from '../../../../lifecycle/needs/religion.js';
import { productionAtomic } from '../../../../readviews/production-atomic.js';
import { presentOperatorsInto, type StaffedScratch } from '../../../../stores/index.js';

/**
 * Show the batch production gives this operator, its own first, else one left open to it. An empty
 * religion reserve may leave it unassigned or let it work a later, free product.
 *
 * The batch is the clip's clock. A staffed batch lasts the clip its starting operator resolves
 * (`production/rotation.ts`), so the clip plays at its own length; only a recipe-timed fallback batch
 * stretches or compresses it.
 */
export function startCraftAtomic(world: World, ctx: SystemContext, e: Entity, workplace: Entity): void {
  removeCurrentAtomic(world, e);
  const staffing = presentOperatorsInto(world, ctx, workplace, crewScratch);
  if (staffing.kind === 'unstaffed') return;
  // The planner runs ahead of production, so a batch's clock reads as the previous tick left it.
  const batchTick = ctx.tick - 1;
  const batch = productionAssignmentsInto(world, ctx, workplace, staffing.operators, batchScratch, batchTick)[
    staffing.operators.indexOf(e)
  ];
  const cycle = batch === undefined ? undefined : world.tryGet(workplace, Production)?.cycles[batch];
  if (cycle === undefined) return;
  const atomicId = productionAtomic(ctx.content, world.get(e, Settler), cycle.goodType);
  const elapsed = workClockTicks(cycle, batchTick);
  if (atomicId === undefined || !religionAllowsAtomic(world, ctx, e, atomicId, elapsed)) return;
  const duration = Math.max(1, cycle.duration);
  addCurrentAtomic(
    world,
    e,
    {
      atomicId,
      duration,
      effect: { kind: 'produce', recipeOutput: cycle.goodType },
      targetEntity: workplace,
      targetTile: null,
    },
    Math.min(elapsed, duration),
  );
}

// The crew and assignment lists one call reads and drops; no call nests another.
const crewScratch: StaffedScratch = { kind: 'staffed', operators: [] };
const batchScratch: number[] = [];
