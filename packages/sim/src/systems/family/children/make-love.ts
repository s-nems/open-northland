import {
  AssistantChildOrder,
  ChildOrder,
  consumeAssistantCounter,
  MakingLove,
  Marriage,
  ownerOf,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { CIVILIST_JOB, WOMAN_JOB } from '../../lifecycle/ageclass.js';
import { atomicDurationForName, boundAtomicAnimation } from '../../readviews/animations.js';
import { stepOut } from '../../settlers/indoors.js';
import { spawnNewborn } from '../../spawn/index.js';

/** The make-love atomic id (`logicdefines.inc` `MAKE_LOVE = 78`), used to resolve the hearts phase's
 *  duration from the tribe's bound animation. */
const MAKE_LOVE_ATOMIC_ID = 78;

/** Hearts-phase length (ticks) when no make_love animation resolves from content: the viking
 *  `viking_civilist_make_love` `length 200` (`atomicanimations.ini`), pinned as the fallback. */
const MAKE_LOVE_DURATION_FALLBACK = 200;

/** How long the couple makes love: the longer of the tribe's two bound make_love clips, or the pinned
 *  fallback when neither resolves. */
export function makeLoveDuration(ctx: SystemContext, tribe: number): number {
  const durations = [WOMAN_JOB, CIVILIST_JOB]
    .map((jobType) => boundAtomicAnimation(ctx.content, { tribe, jobType }, MAKE_LOVE_ATOMIC_ID))
    .filter((name): name is string => name !== undefined)
    .map((name) => atomicDurationForName(ctx.content, name));
  return durations.length > 0 ? Math.max(...durations) : MAKE_LOVE_DURATION_FALLBACK;
}

/** The birth: the newborn joins the family, linked to both parents, and the family steps back outside.
 *  Emits `settlerBorn` (the original's `DM_MUSIC_TYPE_JINGLE_BIRTH` moment). Named approximation: the
 *  give_birth atomic (`logicdefines.inc` 80) is never played, because no birth animation is bound. */
export function birth(
  world: World,
  ctx: SystemContext,
  mother: Entity,
  father: Entity,
  home: Entity,
  sex: 'female' | 'male',
): void {
  const baby = spawnNewborn(world, ctx.content, mother, home, sex);
  world.mut(mother, Marriage).child = baby;
  world.mut(father, Marriage).child = baby;
  // A counter-funded order pays its assistant counter the moment the child exists.
  if (world.has(mother, AssistantChildOrder)) {
    consumeAssistantCounter(world, ownerOf(world, mother), sex === 'female' ? 'extraWomen' : 'extraMen');
    world.remove(mother, AssistantChildOrder);
  }
  world.remove(mother, ChildOrder);
  world.remove(home, MakingLove);
  stepOut(world, mother);
  stepOut(world, father);
  ctx.events.emit({ kind: 'settlerBorn', entity: baby });
}
