import { needsEnabled, Residence, Settler, type SettlerIdentity } from '../../../../components/index.js';
import type { AtomicEffect } from '../../../../core/atomic-effect.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { homeQualityUseFor, spendHomeQuality } from '../../../family/home-quality.js';
import { applyNeedUnits, carriesNeeds } from '../../../lifecycle/needs/index.js';
import {
  atomicAnimationByName,
  atomicClipName,
  atomicClipNameAtHome,
} from '../../../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL, jobIgnoresHomeHouse } from '../../../readviews/index.js';
import { isInsideOwnHome } from '../../indoors.js';

// The need half of an atomic: the extracted `atomicanimations.ini` `event <at> <channel> <delta>` tuples,
// applied at the frame each names. Work drains, meals, rest and prayer all reach a settler's bars through
// here, so a clip's own data decides what an action is worth and an interrupted clip keeps the pulses it
// already played.

/**
 * Apply the need events the clip `e` is playing carries at its current frame, for a settler whose bars move
 * at all ({@link carriesNeeds}).
 *
 * A meal or a nap under the settler's own roof is worth what the data's at-home twin of the clip says, not
 * the one it plays in the field. Rest *gained* counts half out in the open unless the trade is one
 * `jobtypes.ini` marks `ignoresHomeHouseFlag` - an approximation, like the levels the bars are read
 * against.
 */
export function applyAtomicNeedEvents(
  world: World,
  ctx: SystemContext,
  e: Entity,
  atomic: { readonly atomicId: number; readonly elapsed: number; readonly effect: AtomicEffect },
): void {
  if (!needsEnabled(world) || !carriesNeeds(world, ctx.content, e)) return;
  // A draught is drunk on the borrowed eat gesture, but what it restores is the bottle's, not the clip's.
  if (atomic.effect.kind === 'drink') return;
  const settler = world.get(e, Settler);
  const atHome = isInsideOwnHome(world, e);
  const clip = clipPlayedBy(ctx, settler, atomic.atomicId, atHome);
  const animation = clip === undefined ? undefined : atomicAnimationByName(ctx.content, clip);
  if (animation === undefined) return;

  let rest = 0;
  let food = 0;
  let company = 0;
  let piety = 0;
  const frame = clipFrameAt(atomic.elapsed, animation.length);
  for (const event of animation.events) {
    if (event.at !== frame) continue;
    const delta = event.value ?? 0;
    if (delta === 0) continue;
    if (event.type === ATOMIC_EVENT_CHANNEL.REST) rest += delta;
    else if (event.type === ATOMIC_EVENT_CHANNEL.HUNGER) food += delta;
    else if (event.type === ATOMIC_EVENT_CHANNEL.LEISURE) company += delta;
    else if (event.type === ATOMIC_EVENT_CHANNEL.PIETY) piety += delta;
  }
  if (rest === 0 && food === 0 && company === 0 && piety === 0) return;

  // Only rest gained counts half: a swing costs its worker the same wherever it is swung.
  if (rest > 0 && !atHome && !jobIgnoresHomeHouse(ctx.content, settler.jobType)) {
    rest = Math.trunc(rest / 2);
  }
  if (rest > 0 && atHome) {
    const home = world.tryGet(e, Residence)?.home;
    const furnishing = homeQualityUseFor(ctx, 'rest');
    if (
      home !== undefined &&
      furnishing !== undefined &&
      spendHomeQuality(world, home, 'rest', furnishing.useCost)
    )
      rest *= 2;
  }

  const s = world.mut(e, Settler);
  if (rest !== 0) s.fatigue = applyNeedUnits(s.fatigue, rest);
  if (food !== 0) s.hunger = applyNeedUnits(s.hunger, food);
  if (company !== 0) s.enjoyment = applyNeedUnits(s.enjoyment, company);
  if (piety !== 0) s.piety = applyNeedUnits(s.piety, piety);
}

/**
 * The clip frame `elapsed` ticks into an atomic. A clip shorter than the atomic running it replays, so a
 * multi-stroke harvest or a long crank at a well pays its drain once per playthrough. Only frames `1` to
 * `length` are ever reached, so an event authored outside that window never fires.
 */
function clipFrameAt(elapsed: number, length: number): number {
  return length > 0 ? ((elapsed - 1) % length) + 1 : elapsed;
}

/** The clip whose events count: the at-home twin while the settler is indoors at home, else its own. */
function clipPlayedBy(
  ctx: SystemContext,
  settler: SettlerIdentity,
  atomicId: number,
  atHome: boolean,
): string | undefined {
  return atHome
    ? atomicClipNameAtHome(ctx.content, settler, atomicId)
    : atomicClipName(ctx.content, settler, atomicId);
}
