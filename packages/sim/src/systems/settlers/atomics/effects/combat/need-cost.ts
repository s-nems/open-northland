import { Settler } from '../../../../../components/index.js';
import { type Fixed, fx, ONE } from '../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { atomicAnimationName } from '../../../../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL, atomicEventChannelDelta } from '../../../../readviews/index.js';

/** The per-need reserve span the raw `event <at> <channel> <delta>` need tuples move against; the sim's
 *  0..ONE need bar maps onto it. Approximation: the exact reserve maximum is not readable, but a meal's
 *  `event 30 2 +4000` reads as roughly 40% of a bar, which fixes the scale here. */
const NEED_EVENT_RESERVE = 10000;

/**
 * Charge an attacker its completed swing's need cost: the animation that just played is resolved through
 * `atomicId`, and its REST and HUNGER `event <at> <channel> <delta>` drains are scaled onto the 0..ONE need
 * bar. A negative reserve delta is a drain, so subtracting it raises `fatigue` and `hunger` - a soldier
 * swing carries `event 2 1 -20`, a woman's -100.
 */
export function paySwingNeedCost(world: World, ctx: SystemContext, attacker: Entity, atomicId: number): void {
  const s = world.tryGet(attacker, Settler);
  if (s === undefined) return;
  const animation = atomicAnimationName(ctx.content, s, atomicId);
  if (animation === undefined) return;
  const restDelta = atomicEventChannelDelta(ctx.content, animation, ATOMIC_EVENT_CHANNEL.REST);
  const hungerDelta = atomicEventChannelDelta(ctx.content, animation, ATOMIC_EVENT_CHANNEL.HUNGER);
  s.fatigue = clampNeed(fx.sub(s.fatigue, reserveDeltaToBar(restDelta)));
  s.hunger = clampNeed(fx.sub(s.hunger, reserveDeltaToBar(hungerDelta)));
}

/** Scale a raw need-event reserve delta onto the sim's 0..ONE need bar; `fx.div` truncates toward zero. */
function reserveDeltaToBar(reserveDelta: number): Fixed {
  return fx.div(fx.fromInt(reserveDelta), fx.fromInt(NEED_EVENT_RESERVE));
}

/** Clamp a need value to the `[0, ONE]` bar invariant. */
function clampNeed(value: Fixed): Fixed {
  if (value < 0) return fx.fromInt(0);
  if (value > ONE) return ONE;
  return value;
}
