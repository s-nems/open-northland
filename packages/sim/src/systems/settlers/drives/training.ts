import { JobAssignment, Settler, type SettlerIdentity, TrainingOrder } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { reidleAsJob } from '../../orders/work/index.js';
import { grantTrainingExperience, needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { needAtomicDuration } from '../../readviews/animations.js';
import { baseSoldierJobType, isBarracks, isFighterJob } from '../../readviews/index.js';
import type { NavigationLimit } from '../../signposts/index.js';
import { EXERCISE_ATOMIC_ID, startAtomic } from '../atomics/start.js';
import { enterBuilding, stepOut } from '../indoors.js';
import { interactionCell } from '../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';

/**
 * How long a recruit stays inside the barracks before it comes back out a soldier - 15 s of game time
 * (design rule, user-specified 2026-07-27), drawn down per COMPLETED repetition by
 * {@link serveDrillRepetition}, so the last one always overruns. How much schooling that buys is the
 * data's business: see `docs/tickets/features/barracks-training.md`.
 */
export const BARRACKS_DRILL_TICKS = 15 * TICKS_PER_SECOND;

/**
 * The planner's BARRACKS-DRILL rung (called from `./ladder.ts`, which states where it sits): drive a
 * settler's live {@link TrainingOrder} one step forward.
 *
 * The settler walks to the barracks door, steps inside and runs the exercise atomic one repetition at a
 * time until {@link BARRACKS_DRILL_TICKS} are served, then steps back out {@link enlist}ed.
 * The order is abandoned when the barracks is gone/unbuilt or its door is no longer open to the settler -
 * it is handed back to the economy rather than looping on a dead errand.
 */
export function planTraining(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: SettlerIdentity,
  here: NodeId,
  limit: NavigationLimit | null,
): boolean {
  const order = world.tryGet(e, TrainingOrder);
  if (order === undefined) return false;
  // Time served is served: the enlistment is settled before the house is looked at again, so a barracks
  // razed (or walled off) between the last repetition and this planning cannot swallow it. It takes the
  // settler for the tick because `enlist` retires its trade - the rungs below were entered with the old
  // one and would plan its work; the fresh soldier re-plans next tick.
  if (order.drillTicksLeft <= 0) {
    abandonDrill(world, e);
    enlist(world, ctx, e);
    return true;
  }
  if (!isBarracks(world, ctx, order.house)) return abandonDrill(world, e);
  const door = interactionCell(world, ctx, terrain, order.house, here);
  if (!drillDoorOpen(world, ctx, e, door, limit)) return abandonDrill(world, e);
  enterBuilding(world, e, order.house, here, door, () =>
    startAtomic(
      world,
      e,
      EXERCISE_ATOMIC_ID,
      { kind: 'exercise' },
      needAtomicDuration(ctx.content, settler, EXERCISE_ATOMIC_ID),
      order.house,
    ),
  );
  return true;
}

/**
 * Whether `e` may walk to a drill at `door` right now: its signpost area must admit the node and its
 * failed-goal memo must not already name it. The `trainSoldier` handler refuses on a false and the AI's
 * garrison hire picks another man, so a walled-off barracks cannot be re-ordered and re-abandoned every
 * decision - each acceptance cancels whatever the recruit was doing.
 */
export function drillDoorOpen(
  world: World,
  ctx: SystemContext,
  e: Entity,
  door: NodeId,
  limit: NavigationLimit | null,
): boolean {
  if (limit !== null && !limit.allowsNode(door)) return false;
  return !isUnreachableGoal(unreachableGoals(world, ctx, e), door);
}

/**
 * One finished drill repetition: bank the clip's own TRAINING experience and charge its `ticks` against
 * the errand's remaining time. Called from the atomic executor, so a repetition cut short (a stagger, a
 * re-issued order) costs the recruit neither the schooling nor the time. The charge takes the executor's
 * own floor of one tick per repetition, so a zero-length clip cannot stall the drill forever.
 */
export function serveDrillRepetition(
  world: World,
  ctx: SystemContext,
  e: Entity,
  atomicId: number,
  ticks: number,
): void {
  const order = world.tryGet(e, TrainingOrder);
  if (order === undefined) return; // the errand was called off mid-repetition - it schools nothing
  grantTrainingExperience(world, ctx, e, atomicId);
  world.write(e, TrainingOrder, (o) => {
    o.drillTicksLeft -= Math.max(1, ticks);
  });
}

/** Drop the errand and the inside-the-house marker, releasing the settler to the economy (`false`). */
function abandonDrill(world: World, e: Entity): boolean {
  world.remove(e, TrainingOrder);
  stepOut(world, e);
  return false;
}

/**
 * Enlist a settler that has served its drill: it takes the base soldier class ({@link baseSoldierJobType})
 * the schooling it just banked qualifies it for, dropping any workplace post like every other trade change.
 * A settler that already holds a fighter trade keeps it - an old hand only drills, banking TRAINING toward
 * the heavier weapon classes. The qualification is re-read rather than assumed, so a tribe whose data
 * schools no soldier simply gets a settler back out unchanged.
 *
 * The only trade change made from inside the planner sweep: `reidleAsJob` destroys the recruit's work flag
 * and may drop a ground pile, so a list `beginPlannerPass` holds must not index either (today it indexes
 * neither).
 */
function enlist(world: World, ctx: SystemContext, e: Entity): void {
  if (isFighterJob(ctx.content, world.get(e, Settler).jobType)) return;
  const jobType = baseSoldierJobType(ctx.content);
  if (jobType === null) return;
  if (!settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', jobType)) return;
  world.remove(e, JobAssignment); // re-employed by the JobSystem, as on any profession change
  reidleAsJob(world, ctx, e, jobType);
}
