import { Carrying, type CurrentAtomic, FishSwarm, Settler } from '../../../../../components/index.js';
import { fx } from '../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import {
  FISH_CAST_ATOMIC,
  FISH_CAUGHT_ATOMIC,
  FISH_FAILED_ATOMIC,
  takeFishNear,
} from '../../../../economy/fish.js';
import { grantWorkExperience } from '../../../../progression/index.js';
import { atomicDuration } from '../../../../readviews/animations.js';

type RunningAtomic = NonNullable<(typeof CurrentAtomic)['__value']>;
type FishingEffect = Extract<RunningAtomic['effect'], { kind: 'fish' }>;

/**
 * Advance cast -> failed retry -> cast, then finish on the caught/failed result clip. Source basis:
 * owned `the original` analysis functions `an original routine`, `Fisher_TryToCollect`,
 * `Fisher_Collect`, and `an original routine` (atomics 36/38 retries, then 37 on success).
 */
export function advanceFishingAtomic(
  world: World,
  ctx: SystemContext,
  fisher: Entity,
  atomic: RunningAtomic,
  effect: FishingEffect,
): boolean {
  if (effect.phase === 'result') return false;
  if (effect.phase === 'retry') {
    transition(world, ctx, fisher, atomic, FISH_CAST_ATOMIC, {
      ...effect,
      phase: 'cast',
    });
    return true;
  }
  if (effect.repeatsLeft > 1) {
    transition(world, ctx, fisher, atomic, FISH_FAILED_ATOMIC, {
      ...effect,
      repeatsLeft: effect.repeatsLeft - 1,
      phase: 'retry',
    });
    return true;
  }

  const swarm = world.tryGet(effect.swarm, FishSwarm);
  const caughtFrom =
    swarm !== undefined && ctx.terrain !== undefined && !world.has(fisher, Carrying)
      ? takeFishNear(world, ctx.terrain, fisher, swarm.continent)
      : null;
  const caught = caughtFrom !== null;
  if (caught) {
    world.add(fisher, Carrying, { goodType: effect.goodType, amount: 1 });
    grantWorkExperience(world, ctx, fisher, effect.goodType, 1);
  }
  transition(world, ctx, fisher, atomic, caught ? FISH_CAUGHT_ATOMIC : FISH_FAILED_ATOMIC, {
    ...effect,
    phase: 'result',
  });
  return true;
}

function transition(
  world: World,
  ctx: SystemContext,
  fisher: Entity,
  atomic: RunningAtomic,
  atomicId: number,
  effect: FishingEffect,
): void {
  const settler = world.get(fisher, Settler);
  atomic.atomicId = atomicId;
  atomic.elapsed = 0;
  atomic.progress = fx.fromInt(0);
  atomic.duration = atomicDuration(ctx.content, settler, atomicId);
  atomic.effect = effect;
}
