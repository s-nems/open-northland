import {
  Building,
  ownerOf,
  Settler,
  sameSide,
  TrainingOrder,
  UnderConstruction,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { goodEnabled, jobEnabled } from '../progression/index.js';
import { isFighterJob, isSchoolType } from '../readviews/index.js';
import { mayChangeTrade } from './guards.js';
import { mayWalkToDrill, startDrill } from './training.js';

/** Approximation: a lesson point takes one second of completed training atomics. */
export const SCHOOL_LESSON_TICKS = TICKS_PER_SECOND;

export function isSchool(world: World, ctx: SystemContext, house: Entity): boolean {
  const building = world.tryGet(house, Building);
  if (building === undefined || world.has(house, UnderConstruction)) return false;
  const type = contentIndex(ctx.content).buildings.get(building.buildingType);
  return type !== undefined && isSchoolType(type);
}

export function learn(world: World, ctx: SystemContext, command: Extract<Command, { kind: 'learn' }>): void {
  const { entity, house, target, typeId } = command;
  if (target === 'job' && isFighterJob(ctx.content, typeId)) return;
  if (!mayChangeTrade(world, entity) || !isSchool(world, ctx, house) || !sameSide(world, entity, house))
    return;
  const settler = world.get(entity, Settler);
  if (world.get(house, Building).tribe !== settler.tribe || settler.learned?.[target].includes(typeId))
    return;
  const owner = ownerOf(world, entity);
  if (!(target === 'job' ? jobEnabled : goodEnabled)(world, ctx, owner, settler.tribe, typeId)) return;
  const tribe = contentIndex(ctx.content).tribes.get(settler.tribe);
  const requirements =
    tribe?.jobRequirements.filter(
      (r) => r.requirement === 'train' && r.target === target && r.targetId === typeId,
    ) ?? [];
  if (requirements.length === 0) return;
  if (
    target === 'good' &&
    !tribe?.jobEnables.some(
      (r) => r.kind === 'good' && r.targetId === typeId && r.jobType === settler.jobType,
    )
  )
    return;
  const pending = world.tryGet(entity, TrainingOrder);
  const school = contentIndex(ctx.content).buildings.get(world.get(house, Building).buildingType);
  if (school?.schoolSize !== undefined && pending?.house !== house) {
    let occupied = 0;
    for (const student of world.query(TrainingOrder))
      if (world.get(student, TrainingOrder).house === house) occupied++;
    if (occupied >= school.schoolSize) return;
  }
  if (pending?.house === house && pending.lesson?.kind === target && pending.lesson.typeId === typeId) return;
  if (pending?.house !== house && !mayWalkToDrill(world, ctx, entity, house)) return;
  startDrill(world, entity, house, Math.max(...requirements.map((r) => r.amount)) * SCHOOL_LESSON_TICKS);
  world.mut(entity, TrainingOrder).lesson = { kind: target, typeId };
}
