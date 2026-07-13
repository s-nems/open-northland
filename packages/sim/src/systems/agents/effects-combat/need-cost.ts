import { Settler } from '../../../components/index.js';
import { type Fixed, fx, ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { atomicAnimationName } from '../../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL, atomicEventChannelDelta } from '../../readviews/index.js';

/**
 * The original's per-need **reserve span** the raw `event <at> <channel> <delta>` need tuples move
 * against (~10000 in the source — the scale the needs/eat rows document, e.g. a meal `event 30 2 +4000`
 * refills ~40% of it; see `lifecycle/needs.ts` / `agents/drives-needs.ts`). The sim's 0..ONE need bar maps onto
 * it, so a raw reserve delta `D` becomes a bar delta `D / NEED_EVENT_RESERVE · ONE`. **Approximated**:
 * the exact reserve max isn't readable (source basis) — the combat-swing drain preserves the data's
 * DIRECTION (a drain raises the need) and RELATIVE magnitude (a woman's −100 swing costs 5× a soldier's
 * −20), scaled onto the bar; the general event-driven needs drive stays deferred.
 */
const NEED_EVENT_RESERVE = 10000;

/**
 * Make an attacker pay a completed swing's **need cost** — the attack animation's REST/HUNGER channel
 * drains, applied to the attacker's `fatigue`/`hunger`. Reads the exact animation that just played
 * (resolved through the atomic's `atomicId`) and sums its {@link ATOMIC_EVENT_CHANNEL.REST}/`HUNGER`
 * `event <at> <channel> <delta>` tuples ({@link atomicEventChannelDelta}) — a soldier swing carries
 * `event 2 1 -20` + `event 2 2 -20` (−20 each), a woman/civilist swing −100. The raw RESERVE delta is
 * scaled onto the sim's 0..ONE need bar ({@link NEED_EVENT_RESERVE}) and **subtracted** from the need:
 * a negative reserve delta (a drain) *raises* the need (`fatigue`/`hunger` climb toward the top of the
 * bar), so fighting tires and hungers the attacker. Clamped to `[0, ONE]` (the need-bar invariant).
 *
 * No-ops when the attacker is gone/jobless or its attack animation doesn't resolve / carries no drain
 * (delta 0). The first combat consumer of the extracted event deltas — scoped to combat atomics; the
 * general event-driven needs drive (replacing the approximated per-tick rise/reset) stays deferred
 * (source basis).
 */
export function paySwingNeedCost(world: World, ctx: SystemContext, attacker: Entity, atomicId: number): void {
  const s = world.tryGet(attacker, Settler);
  if (s === undefined) return; // attacker gone
  const animation = atomicAnimationName(ctx.content, s, atomicId);
  if (animation === undefined) return; // no attack animation to read a drain from
  const restDelta = atomicEventChannelDelta(ctx.content, animation, ATOMIC_EVENT_CHANNEL.REST);
  const hungerDelta = atomicEventChannelDelta(ctx.content, animation, ATOMIC_EVENT_CHANNEL.HUNGER);
  s.fatigue = clampNeed(fx.sub(s.fatigue, reserveDeltaToBar(restDelta)));
  s.hunger = clampNeed(fx.sub(s.hunger, reserveDeltaToBar(hungerDelta)));
}

/** Scale a raw need-event RESERVE delta (`event <at> <channel> <delta>`; negative drains the reserve)
 *  onto the sim's 0..ONE need bar — `delta / NEED_EVENT_RESERVE · ONE`. Subtracting the result from a
 *  need turns a reserve drain (negative delta) into a need rise. `fx.div` truncates toward zero. */
function reserveDeltaToBar(reserveDelta: number): Fixed {
  return fx.div(fx.fromInt(reserveDelta), fx.fromInt(NEED_EVENT_RESERVE));
}

/** Clamp a need value to the `[0, ONE]` bar invariant (the same bound `needsSystem` keeps). */
function clampNeed(value: Fixed): Fixed {
  if (value < 0) return fx.fromInt(0);
  if (value > ONE) return ONE;
  return value;
}
