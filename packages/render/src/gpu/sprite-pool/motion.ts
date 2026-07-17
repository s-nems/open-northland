/**
 * Inter-tick motion interpolation for pooled sprites: 12 Hz sim steps draw as continuous frame-rate
 * motion. Pure mutation of plain data + testable without a GPU — the interpolation decision split out
 * from the Pixi mutation, like {@link import('./reconcile.js').reconcileSprites}.
 */
import { WALK_TICKS_PER_CELL } from '@open-northland/sim';
import { clamp01, lerp } from '../../data/math.js';
import { TILE_HALF_W } from '../../data/projection/index.js';

/** Frames in one authored human walk cycle per facing (`mapmoveableanimations/animations.ini`). */
const WALK_CYCLE_FRAMES = 12;
/** User-tuned cadence: play the cycle in 17 ticks while the body still takes 18 ticks per cell. */
const WALK_ANIMATION_TICKS_PER_CYCLE = 17;
const WALK_ANIMATION_RATE = WALK_TICKS_PER_CELL / WALK_ANIMATION_TICKS_PER_CYCLE;

/**
 * World-px jump between two consecutive tick anchors past which the motion track snaps instead of
 * lerping — a spawn/teleport, not a walk. The fastest legit case is a multi-tick catch-up frame of a
 * running unit (≈ 5 ticks × 17 px); real teleports jump hundreds of px, so the band between is safe.
 */
export const SNAP_DISTANCE = 128;

/**
 * World px the feet cover per authored walk frame — one cell (`2·TILE_HALF_W`, read at call time:
 * the pitch is a live `?pitch=` knob) over the 12-frame cycle. Dividing actual travel by this distance
 * makes the frame clock follow the body's pace; {@link WALK_ANIMATION_RATE} adds the requested slight
 * animation-only lead without changing movement distance.
 */
function walkFrameTravelPx(): number {
  return (2 * TILE_HALF_W) / WALK_CYCLE_FRAMES;
}

/**
 * Cap on the gait-clock rate in frames per tick — covers the legit fast case (a data-paced animal
 * whose `movespeed` beats the universal 18-ticks-per-cell walk, e.g. movespeed 8 reads 2.25×) with
 * headroom, while a mistracked jump below the snap threshold can't spin the legs cartoonishly.
 * No run/sprint gait exists, so nothing legit approaches the cap.
 */
const MAX_GAIT_RATE = 2.5;

/** An entity's inter-tick motion track: the current and previous tick anchors (world px), plus the
 *  drawn anchor the last {@link trackMotion} computed from them. */
export interface MotionTrack {
  /** The tick `x`/`y` belong to; −1 = untracked, so the next update snaps both anchors: never sighted, or
   *  reset by the pool when the entity re-enters the draw list after an absence (its anchor is stale). */
  tick: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  /** The anchor to draw at this frame — `prev` lerped toward `curr` by the frame alpha. */
  drawX: number;
  drawY: number;
  /**
   * The accumulated walk-cycle clock, in tick units: advanced per sim tick by the fraction of a full
   * gait the anchor actually covered ({@link walkFrameTravelPx}), so the walk animation's frame
   * (`floor(gaitPhase)`, consumed by the pool's moving-state resolve) tracks ground covered, not wall
   * ticks. At the calibrated full cruise it advances 12/17 of a frame per tick, playing one cycle in
   * 17 ticks while the body crosses a cell in 18; a body-pressed or braking walker's legs slow with it too.
   */
  gaitPhase: number;
}

/**
 * Advance a {@link MotionTrack} to this frame's (tick, anchor) and stamp the drawn position onto it
 * in place (`drawX`/`drawY`): the previous tick anchor lerped toward the current one by `alpha` (the
 * fixed-timestep fraction, clamped to [0,1]). A new tick rolls current→previous and advances the
 * {@link MotionTrack.gaitPhase} walk-cycle clock by the distance actually covered; a first sighting or
 * a jump past {@link SNAP_DISTANCE} (a spawn/teleport, not a walk) snaps both anchors so nothing
 * glides across the map (and leaves the gait clock alone — a teleport is not strides). Writes into the
 * caller's track instead of returning a fresh point so the per-frame reconcile stays allocation-free
 * in the steady state (the retained-pool contract).
 */
export function trackMotion(m: MotionTrack, tick: number, x: number, y: number, alpha: number): void {
  if (m.tick === -1 || Math.abs(x - m.x) > SNAP_DISTANCE || Math.abs(y - m.y) > SNAP_DISTANCE) {
    m.tick = tick;
    m.x = x;
    m.y = y;
    m.prevX = x;
    m.prevY = y;
  } else if (m.tick !== tick) {
    const dt = tick - m.tick;
    const dist = Math.hypot(x - m.x, y - m.y);
    const rate = Math.min(MAX_GAIT_RATE, (dist * WALK_ANIMATION_RATE) / (walkFrameTravelPx() * dt));
    m.gaitPhase += rate * dt;
    m.prevX = m.x;
    m.prevY = m.y;
    m.x = x;
    m.y = y;
    m.tick = tick;
  }
  const a = clamp01(alpha);
  m.drawX = lerp(m.prevX, m.x, a);
  m.drawY = lerp(m.prevY, m.y, a);
}
