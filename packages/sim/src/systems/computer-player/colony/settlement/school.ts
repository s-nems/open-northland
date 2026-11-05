import {
  Building,
  Carrying,
  Female,
  playerPlacementTribes,
  TrainingOrder,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { isBuilt } from '../../../ai-shared/seat-roster.js';
import { isAllocatableMan, SpareForce } from '../../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../../context.js';
import { isAdultSettler } from '../../../family/eligibility.js';
import { buildingEnabled } from '../../../progression/index.js';
import { isSchoolType } from '../../../readviews/index.js';
import { Schooling } from '../../technology/schooling.js';
import type { ColonyEnv } from '../env.js';
import { colonists, colonyBuildings, storeOf } from '../roster.js';
import { atWorkshop, fitsTrade, openCraftSeats } from './craft.js';

/** Whether `e` is one of a colony's men at work or in a school lesson: a pupil is back within seconds, so
 *  the ferry brings no man from home in his place. */
export function colonyHand(world: World, ctx: SystemContext, e: Entity): boolean {
  if (isAllocatableMan(world, ctx, e)) return true;
  const lesson = world.tryGet(e, TrainingOrder)?.lesson;
  return lesson !== undefined && lesson !== null && !world.has(e, Female) && isAdultSettler(world, e);
}

/** Whether `e` is a school, standing or a site. */
function isSchool(env: ColonyEnv, e: Entity): boolean {
  const type = contentIndex(env.ctx.content).buildings.get(env.world.get(e, Building).buildingType);
  return type !== undefined && isSchoolType(type);
}

/** The colony's standing school, or null. */
export function colonySchool(env: ColonyEnv): Entity | null {
  return colonyBuildings(env).find((e) => isSchool(env, e) && isBuilt(env.world, e)) ?? null;
}

/**
 * The school the colony raises, as a plan row, while it has none and its store stands (owner ruling: every
 * colony gets its own school, right after its warehouse). It teaches every workshop trade the seat has
 * discovered in a lesson of seconds, where a trade earned by work takes ten cycles and a ferried tradesman a
 * voyage; its bill is the opening's goods, and it seats no crew.
 */
export function schoolLacking(env: ColonyEnv, buildings: readonly Entity[]): string[] {
  const { world, ctx, seat } = env;
  if (buildings.some((e) => isSchool(env, e))) return [];
  // Its row waits for the store to stand: before then the plan sizes the founding party and its hold.
  const store = storeOf(env, buildings);
  if (store === null || !isBuilt(world, store)) return [];
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const school = ctx.content.buildings.find((type) => isSchoolType(type));
  if (tribe === undefined || school === undefined) return [];
  return buildingEnabled(world, ctx, seat, tribe, school.typeId) ? [school.id] : [];
}

/**
 * The lessons at the colony's school: each craft seat of its standing workshops that no colonist has earned
 * gets a spare man of the colony taught the trade, the least practised first, and its operators learn the
 * listed products they lack (`../../technology/schooling.ts`). Returns the pupils too, so no post takes them
 * in the same decision.
 */
export function colonyLessons(
  env: ColonyEnv,
  men: readonly Entity[],
): { readonly commands: readonly PlayerCommand[]; readonly pupils: ReadonlySet<Entity> } {
  const { world, ctx, seat } = env;
  const none = { commands: [], pupils: new Set<Entity>() };
  const school = colonySchool(env);
  if (school === null) return none;
  const free = men.filter((e) => !atWorkshop(env, e) && !world.has(e, Carrying));
  // A man who has earned a seat's trade takes it at the next posting, and sits no lesson.
  const earned = new Set<Entity>();
  const short = openCraftSeats(env, colonyBuildings(env)).filter((post) => {
    const man = free.find((e) => !earned.has(e) && fitsTrade(env, post.job)(e));
    if (man !== undefined) earned.add(man);
    return man === undefined;
  });
  const schooling = new Schooling(world, ctx, seat, [school], colonists(env));
  const force = new SpareForce(free.filter((e) => !earned.has(e)));
  const commands: PlayerCommand[] = [];
  for (const post of short) {
    const lesson = schooling.enrol(post.job, post.building, force);
    if (lesson.kind === 'learn') commands.push(lesson.command);
  }
  commands.push(...schooling.teachMethods());
  const pupils = new Set<Entity>();
  for (const command of commands) if (command.kind === 'learn') pupils.add(command.entity);
  return { commands, pupils };
}
