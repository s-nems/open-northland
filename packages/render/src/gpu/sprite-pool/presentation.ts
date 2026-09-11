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
 * Per-settler idle desync step in ticks. The free tick clock is global, so without an offset every
 * settler runs its wait program in lockstep. Prime, so consecutive entity ids land far apart in any
 * cycle length. Approximation: the original's per-entity idle scheduling is unobserved.
 */
const IDLE_PHASE_STEP = 37;

/**
 * The animation clock a drawn item runs on. A frozen `0` holds a still frame: an animating fog ghost would
 * leak that a building is still manned, and an indoor portrait subject must stand motionless. A live
 * settler's clock is offset by its entity id so standing crowds don't breathe in unison; actions and
 * gaits are unaffected, as they run on the atomic's own clock and the motion track.
 */
export function animationClock(item: DrawItem, tick: number): number {
  if (item.ghost === true || item.frozen === true) return 0;
  return item.kind === 'settler' ? tick + item.ref * IDLE_PHASE_STEP : tick;
}

export function motionClocks(
  item: DrawItem,
  tick: number,
  alpha: number,
  motion: MotionTrack,
  smooth: boolean,
) {
  const clock = smooth ? Math.max(0, tick - 1 + clamp01(alpha)) : tick;
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
 * The pose a settler presents this frame, covering two gaps a raw `moving` state leaves: an anchor that
 * has sat still (an unserviced route, a stalled chase) and the one-tick heading gap a re-pathing walker
 * shows.
 */
export function walkPose(
  item: DrawItem,
  kind: SpriteKind,
  motion: Readonly<MotionTrack>,
  lastFacing: number | undefined,
): DrawItem {
  // An in-house walk is authored, not tracked: its slow shuffle would read as stalled and freeze the
  // worker mid-stride, and its facing comes from the program rather than from a heading.
  if (kind !== 'settler' || item.state !== 'moving' || item.inHouse === true) return item;
  if (isStalled(motion)) return { ...item, state: 'idle' };
  if (item.facing === undefined && lastFacing !== undefined) return { ...item, facing: lastFacing };
  return item;
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
