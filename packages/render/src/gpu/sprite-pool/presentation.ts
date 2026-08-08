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
 * The animation clock a drawn item runs on. A frozen `0` holds a still frame: an animating fog ghost would
 * leak that a building is still manned, and an indoor portrait subject must stand motionless.
 */
export function animationClock(item: DrawItem, tick: number): number {
  return item.ghost === true || item.frozen === true ? 0 : tick;
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
  if (kind !== 'settler' || item.state !== 'moving') return item;
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
