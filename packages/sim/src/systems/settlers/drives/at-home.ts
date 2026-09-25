import {
  Marriage,
  needsEnabled,
  Residence,
  Settler,
  type SettlerIdentity,
} from '../../../components/index.js';
import type { AtomicEffect } from '../../../core/atomic-effect.js';
import { type Fixed, ZERO } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { homeQualityActive } from '../../family/home-quality.js';
import { reservedFoodUnits, storedFoodUnits } from '../../family/households.js';
import { carriesNeeds, NEED_SATED_THRESHOLD } from '../../lifecycle/needs/index.js';
import { atomicClipNameAtHome, atomicEventChannelDelta } from '../../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL, jobNeedsReligion } from '../../readviews/index.js';
import {
  atHomeDuration,
  EAT_ATOMIC_ID,
  PRAY_ATOMIC_ID,
  SLEEP_ATOMIC_ID,
  startAtomic,
} from '../atomics/start.js';
import { heldIndoors, isInside } from '../indoors.js';
import { storedFoodGood } from '../targets/index.js';

const { REST, HUNGER, PIETY } = ATOMIC_EVENT_CHANNEL;

// The at-home top-up: a settler that came home for one need serves the rest before going back out, so it
// leaves rested and fed rather than making a second trip for each bar. Approximation: the data authors the
// at-home clips but not when a settler chains them, so the chain and its NEED_SATED target are authored.

/** The home larder good its residents may eat indoors: the family's own spare food, never the child fund. */
function larderGood(world: World, ctx: SystemContext, home: Entity): number | null {
  if (storedFoodUnits(world, ctx, home) <= reservedFoodUnits(world, home)) return null;
  return storedFoodGood(world, ctx, home);
}

/** One round of the at-home chain: the atomic to run, what it does, and what it faces. */
interface HomeRound {
  readonly atomicId: number;
  readonly effect: AtomicEffect;
  readonly target: Entity;
}

/**
 * The round the at-home chain serves `e` next, rest first, then a meal off the family larder, then a
 * prayer; null when `e` is not indoors at home, another system holds it there, or no bar it can still
 * top up. A round whose clip moves no bar is skipped, or the chain would hold the settler in its house
 * for good.
 */
function nextHomeRound(world: World, ctx: SystemContext, e: Entity): HomeRound | null {
  if (!needsEnabled(world) || !carriesNeeds(world, ctx.content, e)) return null;
  if (heldIndoors(world, e)) return null;
  const home = world.tryGet(e, Residence)?.home;
  const settler = world.tryGet(e, Settler);
  if (home === undefined || settler === undefined || !isInside(world, e, home)) return null;
  if (settler.fatigue > NEED_SATED_THRESHOLD && homeClipServes(ctx, settler, SLEEP_ATOMIC_ID, REST)) {
    return { atomicId: SLEEP_ATOMIC_ID, effect: { kind: 'sleep' }, target: e };
  }
  if (settler.hunger > NEED_SATED_THRESHOLD && homeClipServes(ctx, settler, EAT_ATOMIC_ID, HUNGER)) {
    const goodType = larderGood(world, ctx, home);
    if (goodType !== null)
      return { atomicId: EAT_ATOMIC_ID, effect: { kind: 'eat', goodType, from: home }, target: home };
  }
  if (
    settler.piety > NEED_SATED_THRESHOLD &&
    jobNeedsReligion(ctx.content, settler.jobType) &&
    homeClipServes(ctx, settler, PRAY_ATOMIC_ID, PIETY) &&
    homeQualityActive(world, ctx, home, 'piety')
  ) {
    return { atomicId: PRAY_ATOMIC_ID, effect: { kind: 'pray' }, target: home };
  }
  return null;
}

/** Whether the clip this settler would play indoors pays anything into `channel`. */
export function homeClipServes(
  ctx: SystemContext,
  settler: SettlerIdentity,
  atomicId: number,
  channel: number,
): boolean {
  const clip = atomicClipNameAtHome(ctx.content, settler, atomicId);
  return clip !== undefined && atomicEventChannelDelta(ctx.content, clip, channel) > 0;
}

/** Whether `e` has an at-home round left to serve. The planner keeps such a settler inside instead of
 *  stepping it back out between rounds. */
export function topsUpAtHome(world: World, ctx: SystemContext, e: Entity): boolean {
  return nextHomeRound(world, ctx, e) !== null;
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
  settler: SettlerIdentity & { enjoyment: Fixed },
): boolean {
  const round = nextHomeRound(world, ctx, e);
  if (round === null) return false;
  if (world.has(e, Marriage) && settler.enjoyment !== ZERO) world.mut(e, Settler).enjoyment = ZERO;
  startAtomic(
    world,
    e,
    round.atomicId,
    round.effect,
    atHomeDuration(ctx, settler, round.atomicId),
    round.target,
  );
  return true;
}
