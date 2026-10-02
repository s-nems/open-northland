import { needsEnabled, Residence, Settler } from '../../../../components/index.js';
import type { AtomicEffect } from '../../../../core/atomic-effect.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { homeQualityUseFor, spendHomeQuality } from '../../../family/home-quality.js';
import { applyNeedUnits, carriesNeeds, mutNeeds } from '../../../lifecycle/needs/index.js';
import { atomicAnimationByName, atomicClipName, clipFrameAt } from '../../../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL, jobIgnoresHomeHouse } from '../../../readviews/index.js';
import { isAtOwnHome } from '../../indoors.js';

// The need half of an atomic: the extracted `atomicanimations.ini` `event <at> <channel> <delta>` tuples,
// applied at the frame each names. Work drains, meals, rest and prayer all reach a settler's bars through
// here, so a clip's own data decides what an action is worth and an interrupted clip keeps the pulses it
// already played.

/** How much more a rest or food event counts at home: a meal there, or rest on a furnished bed. */
const AT_HOME_FACTOR = 2;
/** How much a rest event counts away from home, for a trade that goes home at all. */
const AWAY_REST_DIVISOR = 2;

/**
 * Apply the need events the clip `e` is playing carries at its current frame, for a settler whose bars move
 * at all ({@link carriesNeeds}). Original behavior, for either sign of an event:
 * - rest counts half away from home ({@link isAtOwnHome}) unless the trade is one `jobtypes.ini` marks
 *   `ignoresHomeHouseFlag`; at home every rest event spends one use of the home's rest furnishing and
 *   counts double when that use was paid;
 * - food counts double at home;
 * - company and piety count as authored.
 */
export function applyAtomicNeedEvents(
  world: World,
  ctx: SystemContext,
  e: Entity,
  atomic: { readonly atomicId: number; readonly effect: AtomicEffect },
  elapsed: number,
): void {
  if (!needsEnabled(world) || !carriesNeeds(world, ctx.content, e)) return;
  const settler = world.get(e, Settler);
  const clip = atomicClipName(ctx.content, settler, atomic.atomicId);
  const animation = clip === undefined ? undefined : atomicAnimationByName(ctx.content, clip);
  if (animation === undefined) return;

  let rest = 0;
  let food = 0;
  let company = 0;
  let piety = 0;
  let atHome: boolean | undefined;
  const frame = clipFrameAt(elapsed, animation.length);
  for (const event of animation.events) {
    if (event.at !== frame) continue;
    const delta = event.value ?? 0;
    if (delta === 0) continue;
    if (event.type === ATOMIC_EVENT_CHANNEL.REST) {
      atHome ??= isAtOwnHome(world, ctx, e);
      rest += atHome
        ? homeRestDelta(world, ctx, e, delta)
        : jobIgnoresHomeHouse(ctx.content, settler.jobType)
          ? delta
          : Math.trunc(delta / AWAY_REST_DIVISOR);
    } else if (event.type === ATOMIC_EVENT_CHANNEL.HUNGER) {
      atHome ??= isAtOwnHome(world, ctx, e);
      food += atHome ? delta * AT_HOME_FACTOR : delta;
    } else if (event.type === ATOMIC_EVENT_CHANNEL.LEISURE) company += delta;
    else if (event.type === ATOMIC_EVENT_CHANNEL.PIETY) piety += delta;
  }
  if (rest === 0 && food === 0 && company === 0 && piety === 0) return;

  const s = mutNeeds(world, e, ctx.tick);
  if (rest !== 0) s.fatigue = applyNeedUnits(s.fatigue, rest);
  if (food !== 0) s.hunger = applyNeedUnits(s.hunger, food);
  if (company !== 0) s.enjoyment = applyNeedUnits(s.enjoyment, company);
  if (piety !== 0) s.piety = applyNeedUnits(s.piety, piety);
}

/** One rest event at home: it spends a use of the rest furnishing whatever its sign, and counts double when
 *  that use was paid. */
function homeRestDelta(world: World, ctx: SystemContext, e: Entity, delta: number): number {
  const home = world.get(e, Residence).home;
  const furnishing = homeQualityUseFor(ctx, 'rest');
  const paid = furnishing !== undefined && spendHomeQuality(world, home, 'rest', furnishing.useCost);
  return paid ? delta * AT_HOME_FACTOR : delta;
}
