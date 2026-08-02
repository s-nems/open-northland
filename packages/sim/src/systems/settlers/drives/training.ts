import {
  AssistantRecruit,
  consumeAssistantCounter,
  JobAssignment,
  ownerOf,
  Settler,
  type SettlerIdentity,
  TrainingOrder,
} from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { reidleAsJob } from '../../orders/work/index.js';
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
 * {@link serveDrillRepetition}, so the last one always overruns. Every recruit serves this ONE
 * standard drill and exits unarmed - arming is a separate later step (user rule 2026-08-01).
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
 * failed-goal memo must not already name it. The `trainSoldier` handler and the assistant's dispatch
 * gate (`mayDrillAt`) refuse on a false, so a walled-off barracks cannot be re-ordered and
 * re-abandoned every beat - each acceptance cancels whatever the recruit was doing.
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
 * One finished drill repetition: charge its `ticks` against the errand's remaining time. Nothing else
 * accrues (the no-XP rule - `progression/experience.ts`'s TRAINING bucket states it). Called from
 * the atomic executor, so a repetition cut short (a stagger, a re-issued order) costs the recruit no
 * time. The charge takes the executor's own floor of one tick per repetition, so a zero-length clip
 * cannot stall the drill forever.
 */
export function serveDrillRepetition(world: World, e: Entity, ticks: number): void {
  const order = world.tryGet(e, TrainingOrder);
  if (order === undefined) return; // the errand was called off mid-repetition - it counts nothing
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
 * unconditionally - the served term IS the qualification. Why no stat accrues and why the `trainfor*`
 * rows still gate every OTHER door is stated once, on `progression/experience.ts`'s TRAINING bucket.
 * A settler that already holds a fighter trade keeps it - his drill is a plain no-op (the original's
 * paid barracks retraining is deliberately not implemented). A tribe whose data names no soldier
 * class gets its settler back out unchanged.
 *
 * The only trade change made from inside the planner sweep: `reidleAsJob` destroys the recruit's work flag
 * and may drop a ground pile, so a list `beginPlannerPass` holds must not index either (today it indexes
 * neither).
 */
function enlist(world: World, ctx: SystemContext, e: Entity): void {
  if (isFighterJob(ctx.content, world.get(e, Settler).jobType)) return;
  const jobType = baseSoldierJobType(ctx.content);
  if (jobType === null) return;
  world.remove(e, JobAssignment); // re-employed by the JobSystem, as on any profession change
  reidleAsJob(world, ctx, e, jobType);
  // A counter-funded recruit pays its counter here if the base class was the whole ask; a weapon-class
  // booking is paid by the arming step instead (`planner/recruit-arming.ts`), so it stays marked.
  if (world.tryGet(e, AssistantRecruit)?.intent === 'trainSoldiers') {
    consumeAssistantCounter(world, ownerOf(world, e), 'trainSoldiers');
    world.remove(e, AssistantRecruit);
  }
}
