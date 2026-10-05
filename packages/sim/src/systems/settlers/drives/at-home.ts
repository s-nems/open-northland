import {
  Marriage,
  needsEnabled,
  Settler,
  type SettlerIdentity,
  SettlerNeeds,
} from '../../../components/index.js';
import type { AtomicEffect } from '../../../core/atomic-effect.js';
import { ZERO } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { homeQualityActive } from '../../family/home-quality.js';
import { homeUsedBy } from '../../family/households.js';
import { carriesNeeds, mutNeeds, NEED_SATED_THRESHOLD, needLevel } from '../../lifecycle/needs/index.js';
import { atomicClipName, atomicDuration, atomicEventChannelDelta } from '../../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL, jobNeedsReligion } from '../../readviews/index.js';
import type { SupplyTally } from '../../stores/index.js';
import { MEAL_UNITS } from '../atomics/effects/goods/index.js';
import { mealAtomicId, PRAY_ATOMIC_ID, SLEEP_ATOMIC_ID, startAtomic } from '../atomics/start.js';
import { heldIndoors, isInside } from '../indoors.js';
import { storedFoodGood } from '../targets/index.js';

const { REST, HUNGER, PIETY } = ATOMIC_EVENT_CHANNEL;

// The at-home top-up: a settler that came home for one need serves the rest before going back out, so it
// leaves rested and fed rather than making a second trip for each bar. Approximation: the chain and its
// NEED_SATED target are authored. It plays the same clips as anywhere else; being at home only scales what
// they pay (`applyAtomicNeedEvents`).

/** One round of the at-home chain: the atomic to run, what it does, and what it faces. */
interface HomeRound {
  readonly atomicId: number;
  readonly effect: AtomicEffect;
  readonly target: Entity;
}

/**
 * The round the at-home chain serves `e` next, rest first, then a meal off the family larder, then a
 * prayer; null when `e` is not indoors in a home it uses, another system holds it there, or no bar it
 * can still top up. A round whose clip moves no bar is skipped, or the chain would hold the settler in its
 * house for good.
 */
function nextHomeRound(world: World, ctx: SystemContext, supply: SupplyTally, e: Entity): HomeRound | null {
  if (!needsEnabled(world) || !carriesNeeds(world, ctx.content, e)) return null;
  if (heldIndoors(world, e)) return null;
  const settler = world.tryGet(e, Settler);
  if (settler === undefined) return null;
  const home = homeUsedBy(world, ctx, e);
  if (home === undefined || !isInside(world, e, home)) return null;
  const needs = world.get(e, SettlerNeeds);
  if (
    needLevel(needs, 'fatigue', ctx.tick) > NEED_SATED_THRESHOLD &&
    homeClipServes(ctx, settler, SLEEP_ATOMIC_ID, REST)
  ) {
    return { atomicId: SLEEP_ATOMIC_ID, effect: { kind: 'sleep' }, target: e };
  }
  if (needLevel(needs, 'hunger', ctx.tick) > NEED_SATED_THRESHOLD) {
    const goodType = storedFoodGood(world, ctx, home, supply);
    if (goodType !== null) {
      const atomicId = mealAtomicId(ctx.content, settler, goodType);
      if (homeClipServes(ctx, settler, atomicId, HUNGER))
        return { atomicId, effect: { kind: 'eat', goodType, from: home }, target: home };
    }
  }
  if (
    needs.piety > NEED_SATED_THRESHOLD &&
    jobNeedsReligion(ctx.content, settler.jobType) &&
    homeClipServes(ctx, settler, PRAY_ATOMIC_ID, PIETY) &&
    homeQualityActive(world, ctx, home, 'piety')
  ) {
    return { atomicId: PRAY_ATOMIC_ID, effect: { kind: 'pray' }, target: home };
  }
  return null;
}

/** Whether the clip this settler plays for `atomicId` pays anything into `channel`. */
export function homeClipServes(
  ctx: SystemContext,
  settler: SettlerIdentity,
  atomicId: number,
  channel: number,
): boolean {
  const clip = atomicClipName(ctx.content, settler, atomicId);
  return clip !== undefined && atomicEventChannelDelta(ctx.content, clip, channel) > 0;
}

/** Whether `e` has an at-home round left to serve. The planner keeps such a settler inside instead of
 *  stepping it back out between rounds. */
export function topsUpAtHome(world: World, ctx: SystemContext, supply: SupplyTally, e: Entity): boolean {
  return nextHomeRound(world, ctx, supply, e) !== null;
}

/**
 * Serve one round of the at-home chain. A married settler's company bar is filled outright rather than
 * paid out by a clip - the approximation standing in for a chat with the spouse under the same roof,
 * which no clip in the data covers.
 */
export function planHomeTopUp(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  supply: SupplyTally,
): boolean {
  const round = nextHomeRound(world, ctx, supply, e);
  if (round === null) return false;
  // The meal starts at once, but a housemate walking home for the same last unit must see it taken.
  if (round.effect.kind === 'eat' && round.effect.from !== null) {
    supply.stampPickupClaim(e, {
      source: round.effect.from,
      goodType: round.effect.goodType,
      amount: MEAL_UNITS,
    });
  }
  if (world.has(e, Marriage) && needLevel(world.get(e, SettlerNeeds), 'enjoyment', ctx.tick) !== ZERO)
    mutNeeds(world, e, ctx.tick).enjoyment = ZERO;
  startAtomic(
    world,
    e,
    round.atomicId,
    round.effect,
    atomicDuration(ctx.content, settler, round.atomicId),
    round.target,
  );
  return true;
}
