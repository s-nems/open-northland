import {
  Marriage,
  needsEnabled,
  Residence,
  Settler,
  type SettlerIdentity,
} from '../../../components/index.js';
import { type Fixed, ZERO } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { reservedFoodUnits, storedFoodUnits } from '../../family/households.js';
import { NEED_SATED_THRESHOLD } from '../../lifecycle/needs/index.js';
import { atomicClipNameAtHome, atomicEventChannelDelta } from '../../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL } from '../../readviews/index.js';
import { atHomeDuration, EAT_ATOMIC_ID, SLEEP_ATOMIC_ID, startAtomic } from '../atomics/start.js';
import { heldIndoors, isInsideOwnHome } from '../indoors.js';
import { storedFoodGood } from '../targets/index.js';

const { REST, HUNGER } = ATOMIC_EVENT_CHANNEL;

// The at-home top-up: a settler that came home for one need serves the rest before going back out, so it
// leaves rested and fed rather than making a second trip for each bar. Approximation: the data authors the
// at-home clips but not when a settler chains them, so the chain and its NEED_SATED target are authored.

/** The home larder good `e` may eat indoors: the family's own spare food, never the child fund. */
function larderGoodFor(world: World, ctx: SystemContext, e: Entity): number | null {
  const home = world.tryGet(e, Residence)?.home;
  if (home === undefined) return null;
  if (storedFoodUnits(world, ctx, home) <= reservedFoodUnits(world, home)) return null;
  return storedFoodGood(world, ctx, home);
}

/**
 * Whether `e` is indoors at home with a bar this chain can still top up, and no other system holds it
 * there. The planner keeps such a settler inside instead of stepping it back out between rounds.
 */
export function topsUpAtHome(world: World, ctx: SystemContext, e: Entity): boolean {
  if (!needsEnabled(world)) return false;
  if (heldIndoors(world, e) || !isInsideOwnHome(world, e)) return false;
  const settler = world.tryGet(e, Settler);
  if (settler === undefined) return false;
  if (settler.fatigue > NEED_SATED_THRESHOLD && restores(ctx, settler, SLEEP_ATOMIC_ID, REST)) return true;
  return (
    settler.hunger > NEED_SATED_THRESHOLD &&
    restores(ctx, settler, EAT_ATOMIC_ID, HUNGER) &&
    larderGoodFor(world, ctx, e) !== null
  );
}

/** Whether the clip this settler would play indoors pays anything into `channel`. A round that could move
 *  no bar must not start, or the chain would hold the settler in its house for good. */
function restores(ctx: SystemContext, settler: SettlerIdentity, atomicId: number, channel: number): boolean {
  const clip = atomicClipNameAtHome(ctx.content, settler, atomicId);
  return clip !== undefined && atomicEventChannelDelta(ctx.content, clip, channel) > 0;
}

/**
 * Serve one round of the at-home chain: rest first, then a meal off the family larder. A married settler's
 * company bar is filled outright rather than paid out by a clip - the approximation standing in for a chat
 * with the spouse under the same roof, which no clip in the data covers.
 */
export function planHomeTopUp(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity & { fatigue: Fixed; hunger: Fixed; enjoyment: Fixed },
): boolean {
  if (!topsUpAtHome(world, ctx, e)) return false;
  if (world.has(e, Marriage) && settler.enjoyment !== ZERO) world.mut(e, Settler).enjoyment = ZERO;
  const home = world.get(e, Residence).home;
  if (settler.fatigue > NEED_SATED_THRESHOLD) {
    startAtomic(
      world,
      e,
      SLEEP_ATOMIC_ID,
      { kind: 'sleep' },
      atHomeDuration(ctx, settler, SLEEP_ATOMIC_ID),
      e,
    );
    return true;
  }
  const goodType = larderGoodFor(world, ctx, e);
  if (goodType === null) return false;
  startAtomic(
    world,
    e,
    EAT_ATOMIC_ID,
    { kind: 'eat', goodType, from: home },
    atHomeDuration(ctx, settler, EAT_ATOMIC_ID),
    home,
  );
  return true;
}
