import {
  AtomicClock,
  Carrying,
  type CurrentAtomic,
  FishSwarm,
  Settler,
} from '../../../../../components/index.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import {
  FISH_CAST_ATOMIC,
  FISH_CAUGHT_ATOMIC,
  FISH_FAILED_ATOMIC,
  takeFishNear,
} from '../../../../economy/fish.js';
import { wearWornTool } from '../../../../equipment/index.js';
import { grantWorkExperience } from '../../../../progression/index.js';
import { atomicDuration } from '../../../../readviews/animations.js';
import { edibleGoodFormOf } from '../../../../readviews/food.js';

type RunningAtomic = NonNullable<(typeof CurrentAtomic)['__value']>;
type FishingEffect = Extract<RunningAtomic['effect'], { kind: 'fish' }>;

/**
 * Advance cast -> failed retry -> cast, then finish on the caught/failed result clip. Original
 * behavior: atomics 36/38 on each retry, then 37 on success.
 */
export function advanceFishingAtomic(
  world: World,
  ctx: SystemContext,
  fisher: Entity,
  atomic: RunningAtomic,
  effect: FishingEffect,
): boolean {
  if (effect.phase === 'result') return false;
  // A cast wears the rod's tool, hit or miss.
  if (effect.phase === 'cast') wearWornTool(world, ctx, fisher);
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
  const waterContinent = ctx.terrain?.waterContinents?.[effect.water] ?? swarm?.continent;
  const caughtFrom =
    waterContinent !== undefined && ctx.terrain !== undefined && !world.has(fisher, Carrying)
      ? takeFishNear(world, ctx.terrain, effect.water, waterContinent)
      : null;
  const caught = caughtFrom !== null;
  if (caught) {
    // The original catch puts good 16 (`food_simple`) in the fisher's hands, while the raw fish
    // id remains the work/experience specialization. Resolve by slug so modded numeric ids stay valid.
    world.add(fisher, Carrying, { goodType: edibleGoodFormOf(ctx.content, effect.goodType), amount: 1 });
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
  world.mut(fisher, AtomicClock).elapsed = 0;
  atomic.duration = atomicDuration(ctx.content, settler, atomicId);
  atomic.effect = effect;
}
