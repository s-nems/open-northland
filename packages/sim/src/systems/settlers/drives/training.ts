import {
  AssistantRecruit,
  consumeAssistantCounter,
  JobAssignment,
  ownerOf,
  Settler,
  type SettlerIdentity,
  sameSide,
  TrainingOrder,
} from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { isSchool } from '../../orders/education.js';
import { reidleAsJob } from '../../orders/work/index.js';
import { typeAllowed } from '../../progression/unlocks.js';
import { atomicDuration } from '../../readviews/animations.js';
import { baseSoldierJobType, isBarracks, isFighterJob } from '../../readviews/index.js';
import type { NavigationLimit } from '../../signposts/index.js';
import { EXERCISE_ATOMIC_ID, startAtomic } from '../atomics/start.js';
import { enterBuilding, stepOut } from '../indoors.js';
import { interactionCell } from '../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';

/**
 * How long a recruit stays inside the barracks before it comes back out a soldier: 15 s of game time,
 * drawn down per completed repetition, so the last one always overruns. Every recruit serves this one
 * standard drill and exits unarmed; arming is a separate later step. Source basis: authored.
 */
export const BARRACKS_DRILL_TICKS = 15 * TICKS_PER_SECOND;

/**
 * The barracks-drill rung: drive a settler's live `TrainingOrder` one step forward. It walks to the
 * barracks door, steps inside and runs the exercise atomic one repetition at a time until the drill time is
 * served, then steps back out enlisted. The order is abandoned when the barracks is gone or unbuilt, or its
 * door is no longer open to the settler, rather than looping on a dead errand.
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
  if (
    order.lesson !== undefined &&
    (!isSchool(world, ctx, order.house) ||
      !sameSide(world, e, order.house) ||
      !typeAllowed(world, ctx, ownerOf(world, e), settler.tribe, order.lesson.kind, order.lesson.typeId))
  )
    return abandonDrill(world, e);
  // Time served is served: the enlistment settles before the house is looked at again, so a barracks razed
  // between the last repetition and this planning cannot swallow it. It takes the settler for the tick
  // because `enlist` retires its trade, and the rungs below were entered with the old one.
  if (order.drillTicksLeft <= 0) {
    abandonDrill(world, e);
    if (order.lesson === undefined) {
      const jobType = enlist(world, ctx, e);
      if (jobType !== null)
        ctx.events.emit({ kind: 'settlerTrained', entity: e, target: 'job', typeId: jobType });
    } else {
      const s = world.mut(e, Settler);
      s.learned ??= { job: [], good: [] };
      const ids = s.learned[order.lesson.kind];
      if (!ids.includes(order.lesson.typeId)) ids.push(order.lesson.typeId);
      ids.sort((a, b) => a - b);
      if (order.lesson.kind === 'job') {
        world.remove(e, JobAssignment);
        reidleAsJob(world, ctx, e, order.lesson.typeId);
      }
      ctx.events.emit({
        kind: 'settlerTrained',
        entity: e,
        target: order.lesson.kind,
        typeId: order.lesson.typeId,
      });
    }
    return true;
  }
  if (!(order.lesson === undefined ? isBarracks : isSchool)(world, ctx, order.house))
    return abandonDrill(world, e);
  const door = interactionCell(world, ctx, terrain, order.house, here);
  if (!drillDoorOpen(world, ctx, e, door, limit)) return abandonDrill(world, e);
  enterBuilding(world, e, order.house, here, door, () =>
    startAtomic(
      world,
      e,
      EXERCISE_ATOMIC_ID,
      { kind: 'exercise' },
      atomicDuration(ctx.content, settler, EXERCISE_ATOMIC_ID),
      order.house,
    ),
  );
  return true;
}

/**
 * Whether `e` may walk to a drill at `door` right now: its signpost area must admit the node and its
 * failed-goal memo must not already name it. The order handlers refuse on a false, so a walled-off barracks
 * cannot be re-ordered and re-abandoned every beat.
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
 * One finished drill repetition charged against the errand's remaining time; no experience accrues. Called
 * from the atomic executor, so a repetition cut short costs the recruit no time, and the charge floors at
 * one tick so a zero-length clip cannot stall the drill forever.
 */
export function serveDrillRepetition(world: World, e: Entity, ticks: number): void {
  const order = world.tryGet(e, TrainingOrder);
  if (order === undefined) return;
  world.mut(e, TrainingOrder).drillTicksLeft -= Math.max(1, ticks);
}

/** Drop the errand and the inside-the-house marker, releasing the settler to the economy (`false`). */
function abandonDrill(world: World, e: Entity): boolean {
  world.remove(e, TrainingOrder);
  stepOut(world, e);
  return false;
}

/**
 * Enlist a settler that has served its drill: it takes the base soldier class unconditionally, since the
 * served term is the qualification. A settler that already holds a fighter trade keeps it, and a tribe
 * whose data names no soldier class gets its settler back out unchanged.
 *
 * The only trade change made from inside the planner sweep: `reidleAsJob` destroys the recruit's work flag
 * and may drop a ground pile, so a list `beginPlannerPass` holds must not index either.
 */
function enlist(world: World, ctx: SystemContext, e: Entity): number | null {
  if (isFighterJob(ctx.content, world.get(e, Settler).jobType)) return null;
  const jobType = baseSoldierJobType(ctx.content);
  if (jobType === null) return null;
  world.remove(e, JobAssignment); // its old post is not a soldier's, and nothing re-posts on its own
  reidleAsJob(world, ctx, e, jobType);
  // A counter-funded recruit pays its counter here if the base class was the whole ask; a weapon-class
  // booking is paid by the arming step instead, so it stays marked.
  if (world.tryGet(e, AssistantRecruit)?.intent === 'trainSoldiers') {
    consumeAssistantCounter(world, ownerOf(world, e), 'trainSoldiers');
    world.remove(e, AssistantRecruit);
  }
  return jobType;
}
