import { type ContentSet, LEARNED_GOOD_INCLUDES } from '@open-northland/data';
import {
  AssistantRecruit,
  consumeAssistantCounter,
  GraduateWait,
  hasMissionBehaviour,
  JobAssignment,
  MISSION_BEHAVIOUR,
  MoveGoal,
  noteSettlerProgress,
  ownerOf,
  Settler,
  type SettlerIdentity,
  SettlerProgress,
  sameSide,
  TrainingOrder,
  UnderConstruction,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { postGraduate } from '../../assistant/graduates.js';
import { guardPost } from '../../conflict/chase.js';
import type { SystemContext } from '../../context.js';
import { heldGatherGood, holdToGatherGood, jobGathersGood } from '../../economy/gather-goods.js';
import { moveAnchor } from '../../orders/combat.js';
import { isSchoolOrFoundation, schoolMethodJob } from '../../orders/education.js';
import { keepingOrderQueue } from '../../orders/guards.js';
import { rallyNodeOf } from '../../orders/rally-point.js';
import { takeTrainingSeat } from '../../orders/training-seats.js';
import { reidleAsJob } from '../../orders/work/index.js';
import { typeAllowed } from '../../progression/unlocks.js';
import { atomicDuration } from '../../readviews/animations.js';
import {
  baseSoldierJobType,
  isBarracksOrFoundation,
  isFighterJob,
  jobChangesProduction,
} from '../../readviews/index.js';
import type { NavigationLimit } from '../../signposts/index.js';
import { entityNode } from '../../spatial/nodes.js';
import { atOrWalk, EXERCISE_ATOMIC_ID, startAtomic } from '../atomics/start.js';
import { enterBuilding, stepOut } from '../indoors.js';
import type { PlannerContext } from '../planner/context.js';
import type { IdleStands } from '../planner/idle-replan.js';
import { armRecruitInPlace } from '../planner/recruit-arming.js';
import type { PlannerSpacing } from '../planner/spacing.js';
import { interactionCell } from '../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';
import { planDelivery } from './economy/delivery.js';
import { deliveryTargetFor } from './economy/delivery-targets.js';
import { fetchNeededMaterial } from './economy/site-supply.js';
import { loiterCell } from './spacing.js';

/** The goods a school lesson in `good` teaches: the good and those {@link LEARNED_GOOD_INCLUDES} adds
 *  that the content defines. */
function lessonGoods(content: ContentSet, good: number): number[] {
  const goods = [good];
  const slug = contentIndex(content).goods.get(good)?.id;
  for (const included of (slug === undefined ? undefined : LEARNED_GOOD_INCLUDES.get(slug)) ?? []) {
    const id = contentIndex(content).goodTypeBySlug.get(included);
    if (id !== undefined) goods.push(id);
  }
  return goods;
}

/**
 * How long a recruit stays inside the barracks before it comes back out a soldier: 15 s of game time,
 * drawn down per completed repetition, so the last one always overruns. Every recruit serves this one
 * standard drill; a weapon-class recruit takes what gear it can from the barracks' stock on the way out,
 * the rest in a later arming errand. Source basis: authored.
 */
export const BARRACKS_DRILL_TICKS = 15 * TICKS_PER_SECOND;

/**
 * The barracks-drill rung: drive a settler's live `TrainingOrder` one step forward. It walks to the
 * barracks door, steps inside and runs the exercise atomic one repetition at a time until the drill time is
 * served, then steps back out enlisted. A house still under construction is supplied with its missing
 * material, else waited for beside its door, re-checked on the idle beat. The order is abandoned when the house is gone or its door is no longer open
 * to the settler, rather than looping on a dead errand.
 */
export function planTraining(
  plan: PlannerContext,
  settler: SettlerIdentity,
  spacing: PlannerSpacing,
  idle: IdleStands,
  load: { goodType: number; amount: number } | undefined,
): boolean {
  const { world, ctx, terrain, entity: e, here, limit } = plan;
  const order = world.tryGet(e, TrainingOrder);
  if (order === undefined) return false;
  // A script that fixes the trade mid-term ends the errand: the term could only end in a refused change.
  if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.JOB_LOCKED)) return abandonDrill(world, e);
  // A course the seat may no longer teach is refused even when served; the house is checked below.
  if (
    order.lesson !== undefined &&
    !typeAllowed(world, ctx, ownerOf(world, e), settler.tribe, order.lesson.kind, order.lesson.typeId)
  )
    return abandonDrill(world, e);
  if (order.lesson?.kind === 'good') {
    const job = schoolMethodJob(ctx.content, settler.tribe, order.lesson.typeId, settler.jobType);
    if (job === undefined || !typeAllowed(world, ctx, ownerOf(world, e), settler.tribe, 'job', job))
      return abandonDrill(world, e);
  }
  // Time served is served: the enlistment or lesson settles before the house is looked at again, so a
  // barracks or school razed between the last repetition and this planning cannot swallow it. It takes
  // the settler for the tick because the trade changes, and the rungs below were entered with the old one.
  if (order.drillTicksLeft <= 0) {
    abandonDrill(world, e);
    if (order.lesson === undefined) {
      const jobType = keepingOrderQueue(world, e, () => {
        // A plain-soldier counter's recruit is enlisted naked on purpose: the class counters own the
        // arming, so the enlist beat shops for nobody whose booking asked plain soldiers.
        const plain = world.tryGet(e, AssistantRecruit)?.intent === 'trainSoldiers';
        const enlisted = enlist(world, ctx, e);
        // Arming first: the rally walk would only fight the fetch errand a booking still owes.
        if (!plain) armRecruitInPlace(plan, e, order.house);
        if (enlisted !== null) sendToRallyPoint(world, ctx, e, order.house);
        return enlisted;
      });
      if (jobType !== null)
        ctx.events.emit({
          kind: 'settlerTrained',
          entity: e,
          course: 'barracks',
          target: 'job',
          typeId: jobType,
        });
    } else {
      const s = world.get(e, Settler);
      const progress = world.mut(e, SettlerProgress);
      progress.learned ??= { job: [], good: [] };
      const ids = progress.learned[order.lesson.kind];
      const taught =
        order.lesson.kind === 'good' ? lessonGoods(ctx.content, order.lesson.typeId) : [order.lesson.typeId];
      for (const id of taught) if (!ids.includes(id)) ids.push(id);
      ids.sort((a, b) => a - b);
      noteSettlerProgress(world, e);
      const job =
        order.lesson.kind === 'job'
          ? order.lesson.typeId
          : schoolMethodJob(ctx.content, s.tribe, order.lesson.typeId, s.jobType);
      if (job !== undefined) {
        if (!progress.learned.job.includes(job)) {
          progress.learned.job.push(job);
          progress.learned.job.sort((a, b) => a - b);
        }
        if (s.jobType !== job) {
          world.remove(e, JobAssignment);
          keepingOrderQueue(world, e, () => reidleAsJob(world, ctx, e, job));
        }
        // A graduate without a workplace takes a free one if the assistant posts graduates, else waits by
        // the school.
        if (!world.has(e, JobAssignment) && !postGraduate(world, ctx, terrain, e, here, limit, job))
          world.add(e, GraduateWait, { school: order.house });
        // A gatherer taught a good (a collector's iron or gold) leaves school gathering only that good,
        // unless the player already held it to one.
        const good = order.lesson.typeId;
        if (
          order.lesson.kind === 'good' &&
          jobChangesProduction(ctx.content, job) &&
          jobGathersGood(ctx, job, good) &&
          heldGatherGood(world, ctx, e) === undefined
        ) {
          holdToGatherGood(world, ctx, e, job, good);
        }
      }
      ctx.events.emit({
        kind: 'settlerTrained',
        entity: e,
        course: 'school',
        target: order.lesson.kind,
        typeId: order.lesson.typeId,
      });
    }
    return true;
  }
  const teaches = order.lesson === undefined ? isBarracksOrFoundation : isSchoolOrFoundation;
  if (!teaches(world, ctx, order.house) || !sameSide(world, e, order.house)) return abandonDrill(world, e);
  const door = interactionCell(world, ctx, terrain, order.house, here);
  if (!drillDoorOpen(world, ctx, e, door, limit)) return abandonDrill(world, e);
  const foundation = world.has(order.house, UnderConstruction);
  if (foundation && supplyFoundation(plan, spacing, order.house, load)) return true;
  if (!takeTrainingSeat(world, ctx, e) || foundation)
    return waitInYard(world, ctx, terrain, e, here, door, spacing, idle);
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
 * Help raise the school or barracks the settler is enrolled at while it is a foundation: fetch a unit of
 * its missing material and carry it to the site, as a worker posted to a house still going up does. A
 * load the site has no use for is held through the wait. Owner ruling, not observed in the original.
 */
function supplyFoundation(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  house: Entity,
  load: { goodType: number; amount: number } | undefined,
): boolean {
  if (load === undefined || load.amount <= 0) return fetchNeededMaterial(plan, spacing, house);
  if (deliveryTargetFor(plan, load.goodType) !== house) return false;
  planDelivery(plan, spacing, load);
  return true;
}

/**
 * Wait beside the house's door for it to stand or for a free seat, re-checked on the idle beat. The walk
 * goes to a yard cell, not the door, so a failed walk to any yard cell is what tells an unreachable house:
 * the errand is then dropped as it would be at a standing house's door.
 */
function waitInYard(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  door: NodeId,
  spacing: PlannerSpacing,
  idle: IdleStands,
): boolean {
  const failed = unreachableGoals(world, ctx, e);
  if (failed !== null) {
    const yard = spacing.yard(door);
    if (failed.some((goal) => yard.has(goal.cell))) return abandonDrill(world, e);
  }
  idle.stand(e, false);
  atOrWalk(world, e, here, loiterCell(world, terrain, e, here, door, spacing), () => {});
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
 * Post a fresh soldier at its barracks' rally point: the point becomes the anchor its guard walk-back holds,
 * so it leaves the door for the point instead of standing where it stepped out. A barracks with no rally
 * point leaves the soldier anchored at its feet. An assistant recruit starts no walk here: the fetch
 * errand his booking dispatches owns him, and its outing ends on the post (`recruit-arming.ts`). A soldier
 * the player drilled by hand walks to the post at once, armed or not (owner's ruling).
 */
function sendToRallyPoint(world: World, ctx: SystemContext, e: Entity, barracks: Entity): void {
  if (ctx.terrain === undefined) return;
  const rally = rallyNodeOf(world, ctx.terrain, barracks);
  if (rally === undefined) return;
  moveAnchor(world, ctx.content, e, rally);
  if (world.has(e, AssistantRecruit)) return;
  // The post is the anchor, or the open node beside it when something stands on the anchor.
  const here = entityNode(world, ctx.terrain, e);
  const post = guardPost(world, ctx, ctx.terrain, rally, here);
  if (post !== here) world.add(e, MoveGoal, { cell: post });
}

/**
 * Enlist a settler that has served its drill: it takes the base soldier class unconditionally, since the
 * served term is the qualification. A settler that already holds a fighter trade keeps it, and a tribe
 * whose data names no soldier class gets its settler back out unchanged.
 *
 * Like a finished school lesson, a trade change made from inside the planner sweep: `reidleAsJob` destroys
 * the settler's work flag and may drop a ground pile, so a list `beginPlannerPass` holds must not index
 * either.
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
