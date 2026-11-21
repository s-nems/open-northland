import type { ContentSet } from '@open-northland/data';
import {
  Building,
  ownerOf,
  Settler,
  type SettlerIdentity,
  SettlerProgress,
  sameSide,
  TrainingOrder,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { goodEnabled, jobEnabled, type NeedSubject, typeAllowed } from '../progression/index.js';
import { ATOMIC_EVENT_TYPE_GET_TRAINING, atomicClip, atomicDuration } from '../readviews/animations.js';
import { isFighterJob, isSchoolType } from '../readviews/index.js';
import { EXERCISE_ATOMIC_ID } from '../settlers/atomics/start.js';
import { mayChangeTrade } from './guards.js';
import { mayWalkToDrill, startDrill } from './training.js';

/** The repetition a finished course ends on, played after the last point was earned. */
const CLOSING_REPETITIONS = 1;

/** A `train` row's lesson points for one job or good, undefined when the tribe teaches it no lesson. */
function trainPoints(
  content: ContentSet,
  tribeId: number,
  target: 'job' | 'good',
  typeId: number,
): number | undefined {
  let points: number | undefined;
  for (const row of contentIndex(content).tribes.get(tribeId)?.jobRequirements ?? []) {
    if (row.requirement !== 'train' || row.target !== target || row.targetId !== typeId) continue;
    points = Math.max(points ?? 0, row.amount);
  }
  return points;
}

/** Whether the school holds courses in `jobType`: the trade or one of its goods carries a `train` row. */
function schoolTeachesTrade(content: ContentSet, tribeId: number, jobType: number): boolean {
  if (isFighterJob(content, jobType)) return false;
  if (trainPoints(content, tribeId, 'job', jobType) !== undefined) return true;
  const tribe = contentIndex(content).tribes.get(tribeId);
  return (tribe?.jobEnables ?? []).some(
    (edge) =>
      edge.kind === 'good' &&
      edge.jobType === jobType &&
      trainPoints(content, tribeId, 'good', edge.targetId) !== undefined,
  );
}

/**
 * A course's cost in lesson points, undefined when the school holds no such course. A good is taught with
 * its producer trade ({@link schoolMethodJob}) and costs the trade's `trainforjob` plus its own
 * `trainforgood`; a good without a row adds nothing, and the trade is charged whether or not the pupil
 * already holds it. Original behavior, unconfirmed against the running original. Authored: a good whose
 * course would cost nothing has no course, since there is nothing to teach.
 */
export function schoolCoursePoints(
  content: ContentSet,
  tribeId: number,
  target: 'job' | 'good',
  typeId: number,
  current: number | null,
): number | undefined {
  if (target === 'job') return trainPoints(content, tribeId, 'job', typeId);
  const job = schoolMethodJob(content, tribeId, typeId, current);
  if (job === undefined) return undefined;
  const points =
    (trainPoints(content, tribeId, 'job', job) ?? 0) + (trainPoints(content, tribeId, 'good', typeId) ?? 0);
  return points > 0 ? points : undefined;
}

/**
 * How long a course of `points` keeps its pupil inside, in ticks: each exercise repetition earns the clip's
 * `GET_TRAINING` value, and the course ends on the repetition after the points are in. Original behavior,
 * unconfirmed against the running original; it ends the course at that repetition's event frame, an
 * approximation here to the repetition's end.
 */
export function schoolLessonTicks(content: ContentSet, pupil: SettlerIdentity, points: number): number {
  let perRepetition = 0;
  for (const event of atomicClip(content, pupil, EXERCISE_ATOMIC_ID)?.events ?? [])
    if (event.type === ATOMIC_EVENT_TYPE_GET_TRAINING) perRepetition += event.value ?? 0;
  const repetitions = Math.ceil(points / Math.max(1, perRepetition)) + CLOSING_REPETITIONS;
  return repetitions * atomicDuration(content, pupil, EXERCISE_ATOMIC_ID);
}

/** A school, standing or still a foundation: a pupil may be sent to one before it stands. */
export function isSchoolOrFoundation(world: World, ctx: SystemContext, house: Entity): boolean {
  const building = world.tryGet(house, Building);
  if (building === undefined) return false;
  const type = contentIndex(ctx.content).buildings.get(building.buildingType);
  return type !== undefined && isSchoolType(type);
}

export function learn(world: World, ctx: SystemContext, command: Extract<Command, { kind: 'learn' }>): void {
  const { entity, house, target, typeId } = command;
  if (target === 'job' && isFighterJob(ctx.content, typeId)) return;
  if (
    !mayChangeTrade(world, ctx.content, entity) ||
    !isSchoolOrFoundation(world, ctx, house) ||
    !sameSide(world, entity, house)
  )
    return;
  const settler = world.get(entity, Settler);
  const known = { jobType: settler.jobType, learned: world.get(entity, SettlerProgress).learned };
  if (knowsCourse(ctx.content, settler.tribe, known, target, typeId)) return;
  const owner = ownerOf(world, entity);
  if (!(target === 'job' ? jobEnabled : goodEnabled)(world, ctx, owner, settler.tribe, typeId)) return;
  const points = schoolCoursePoints(ctx.content, settler.tribe, target, typeId, settler.jobType);
  if (points === undefined) return;
  if (target === 'good') {
    const job = schoolMethodJob(ctx.content, settler.tribe, typeId, settler.jobType);
    if (job === undefined || !typeAllowed(world, ctx, owner, settler.tribe, 'job', job)) return;
  }
  const pending = world.tryGet(entity, TrainingOrder);
  if (pending?.house === house && pending.lesson?.kind === target && pending.lesson.typeId === typeId) return;
  if (pending?.house !== house && !mayWalkToDrill(world, ctx, entity, house)) return;
  startDrill(world, ctx, entity, house, schoolLessonTicks(ctx.content, settler, points));
  world.mut(entity, TrainingOrder).lesson = { kind: target, typeId };
}

/**
 * Whether a settler already holds a course, so a lesson in it would buy nothing: a trade it learned or
 * practises now, a good it learned, or a good without a lesson of its own whose trade it holds.
 */
export function knowsCourse(
  content: ContentSet,
  tribeId: number,
  settler: Pick<NeedSubject, 'learned'> & { readonly jobType: number | null },
  target: 'job' | 'good',
  typeId: number,
): boolean {
  const holdsJob = (job: number): boolean =>
    settler.jobType === job || settler.learned?.job.includes(job) === true;
  if (target === 'job') return holdsJob(typeId);
  if (settler.learned?.good.includes(typeId) === true) return true;
  if (trainPoints(content, tribeId, 'good', typeId) !== undefined) return false;
  const job = schoolMethodJob(content, tribeId, typeId, settler.jobType);
  return job !== undefined && holdsJob(job);
}

/** Whether the school teaches `jobType`'s trade more than one good, so a course in one was picked from a
 *  list rather than being the trade's only course. */
export function schoolTeachesMethodChoice(content: ContentSet, tribeId: number, jobType: number): boolean {
  const tribe = contentIndex(content).tribes.get(tribeId);
  if (tribe === undefined || !schoolTeachesTrade(content, tribeId, jobType)) return false;
  const methods = new Set<number>();
  for (const edge of tribe.jobEnables)
    if (edge.kind === 'good' && edge.jobType === jobType) methods.add(edge.targetId);
  return methods.size > 1;
}

/** School course policy: a method teaches its producer trade as well. Preserve a matching trade; otherwise the lowest
 * declared civilian producer wins if content shares a method across trades. */
export function schoolMethodJob(
  content: ContentSet,
  tribeId: number,
  good: number,
  current: number | null,
): number | undefined {
  const tribe = contentIndex(content).tribes.get(tribeId);
  let chosen: number | undefined;
  const enables = tribe?.jobEnables ?? [];
  for (let i = 0; i < enables.length; i++) {
    const edge = enables[i];
    if (edge === undefined) continue;
    if (edge.kind !== 'good' || edge.targetId !== good || isFighterJob(content, edge.jobType)) continue;
    if (edge.jobType === current) return current;
    if (chosen === undefined || edge.jobType < chosen) chosen = edge.jobType;
  }
  return chosen;
}
