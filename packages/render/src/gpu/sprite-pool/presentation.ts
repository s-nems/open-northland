import { clamp, clamp01, lerp } from '../../data/math.js';
import type { DrawItem } from '../../data/scene/index.js';
import type { SpriteKind } from '../../data/sprites/index.js';
import { isStalled, type MotionTrack } from './motion.js';

/**
 * Per-frame easing factor for the construction bottom-up reveal: the displayed reveal moves this fraction
 * of the remaining distance toward the sim's reported progress each frame. Tuned so the rise glides across
 * the sim's per-swing `built` steps (~15 ticks per swing) without a catch-up snap.
 */
const CONSTRUCTION_REVEAL_EASE = 0.06;

/** The highest whole percent an in-progress site presents: completion is signalled by the progress field
 *  disappearing (the sim swaps in the finished body), never by the eased value rounding up to 100. */
const MAX_IN_PROGRESS_PCT = 99;

/**
 * Per-entity phase step in ticks. Prime, so consecutive entity ids land far apart in any cycle length.
 * Approximation: the original's per-entity idle scheduling is unobserved.
 */
const ENTITY_PHASE_STEP = 37;

/**
 * The animation clock a drawn item runs on. A frozen `0` holds a still frame: an animating fog ghost would
 * leak that a building is still manned, and an indoor portrait subject must stand motionless. The free tick
 * clock is global, so a live settler's clock, and that of a goodless pile (the delivery flag's wave), is
 * offset by its entity id: standing crowds don't breathe, and a row of flags doesn't wave, in unison.
 * Actions and gaits are unaffected, as they run on the atomic's own clock and the motion track.
 */
export function animationClock(item: DrawItem, tick: number): number {
  if (item.ghost === true || item.frozen === true) return 0;
  const waves = item.kind === 'stockpile' && item.goodType === undefined;
  return item.kind === 'settler' || waves ? tick + item.ref * ENTITY_PHASE_STEP : tick;
}

export function motionClocks(
  item: DrawItem,
  tick: number,
  alpha: number,
  motion: MotionTrack,
  smooth: boolean,
  continuousAnimation = false,
) {
  if (item.ghost === true || item.frozen === true) return { animation: 0, gait: 0 };
  const clock = smooth
    ? Math.max(0, tick - 1 + clamp01(alpha))
    : continuousAnimation
      ? tick + clamp01(alpha)
      : tick;
  return {
    animation: animationClock(item, clock),
    gait:
      item.inHouse === true
        ? clock
        : smooth
          ? lerp(motion.prevGaitPhase, motion.gaitPhase, clamp01(alpha))
          : Math.floor(motion.gaitPhase),
  };
}

/**
 * Retain a settler's or vehicle's heading through a route gap or arrival, and present idle after a
 * blocked route stops making progress. Wildlife has no persisted human turn heading to supply its idle
 * facing.
 */
export function walkPose(
  item: DrawItem,
  kind: SpriteKind,
  motion: Readonly<MotionTrack>,
  lastFacing: number | undefined,
): DrawItem {
  // An in-house walk is authored, not tracked: its slow shuffle would read as stalled and freeze the
  // worker mid-stride, and its facing comes from the program rather than from a heading.
  if (
    (kind !== 'settler' && kind !== 'vehicle') ||
    item.inHouse === true ||
    (item.state !== 'moving' && item.state !== 'idle')
  )
    return item;
  const state = item.state === 'moving' && isStalled(motion) ? 'idle' : item.state;
  const facing = item.facing ?? lastFacing;
  if (state === item.state && facing === item.facing) return item;
  return { ...item, state, ...(facing !== undefined ? { facing } : {}) };
}

/**
 * Ease the displayed construction (or upgrade) reveal one frame toward the sim's reported progress, or
 * clear it when nothing is in progress. A first-seen site initialises straight to its target, so a
 * mid-build house scrolling into view does not grow from zero.
 */
export function easeReveal(
  displayed: number | undefined,
  progressPct: number | undefined,
): number | undefined {
  if (progressPct === undefined) return undefined;
  const target = clamp01(progressPct / 100);
  return displayed === undefined ? target : lerp(displayed, target, CONSTRUCTION_REVEAL_EASE);
}

/**
 * Write the eased reveal back over whichever field carried the progress, as the whole percent the stage
 * windows are keyed by, so stage selection and the per-pixel reveal ride one value and cannot disagree.
 */
export function revealedItem(item: DrawItem, reveal: number | undefined): DrawItem {
  if (reveal === undefined) return item;
  const pct = clamp(Math.round(reveal * 100), 0, MAX_IN_PROGRESS_PCT);
  return item.builtPct !== undefined ? { ...item, builtPct: pct } : { ...item, upgradePct: pct };
}
