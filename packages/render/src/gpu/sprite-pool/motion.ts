/** Inter-tick interpolation for pooled sprites: 12 Hz sim steps drawn as continuous frame-rate motion. */
import { WALK_TICKS_PER_CELL } from '@open-northland/sim';
import { clamp01, lerp } from '../../data/math.js';
import { TILE_HALF_W } from '../../data/projection/index.js';
import type { SpriteKind } from '../../data/sprites/index.js';

/** Frames in one authored human walk cycle per facing (`mapmoveableanimations/animations.ini`). */
const WALK_CYCLE_FRAMES = 12;
/** Authored cadence: the cycle plays in 17 ticks while the body still takes 18 ticks per cell. */
const WALK_ANIMATION_TICKS_PER_CYCLE = 17;
const WALK_ANIMATION_RATE = WALK_TICKS_PER_CELL / WALK_ANIMATION_TICKS_PER_CYCLE;

/**
 * World-px jump between two consecutive tick anchors past which the motion track snaps instead of
 * lerping - a spawn or teleport, not a walk. The fastest legit case is a multi-tick catch-up frame
 * (≈ 5 ticks × 17 px); a real teleport jumps hundreds of px.
 */
export const SNAP_DISTANCE = 128;

/**
 * The snap band a kind's track runs under, resolved once per entity. A projectile must never snap
 * mid-flight: a multi-tick catch-up frame would trip {@link SNAP_DISTANCE} and stutter an ordinary
 * flight at the tick rate. It has no teleport to guard against - it lives launch-to-impact, and the
 * pool's `tick = -1` reset still snaps first sighting and cull re-entry.
 */
export function snapDistanceForKind(kind: SpriteKind): number {
  return kind === 'projectile' ? Number.POSITIVE_INFINITY : SNAP_DISTANCE;
}

/** World px the feet cover per authored walk frame - one cell (`2·TILE_HALF_W`) over the 12-frame cycle.
 *  Dividing actual travel by it makes the frame clock follow the body's pace. */
const WALK_FRAME_TRAVEL_PX = (2 * TILE_HALF_W) / WALK_CYCLE_FRAMES;

/** Cap on the gait-clock rate in frames per tick. It clears the fastest legit case - a data-paced animal
 *  whose `movespeed` beats the universal 18-ticks-per-cell walk (movespeed 8 reads 2.25×) - while keeping
 *  a mistracked jump below the snap threshold from spinning the legs. */
const MAX_GAIT_RATE = 2.5;

/** Ticks a `moving`-state track must sit still before the pool presents the idle pose instead of a frozen
 *  mid-stride walk frame. Four ticks (⅓ s) clears the slowest legit walk (the brake floor still covers
 *  ~1.9 px/tick) without flickering a normal stop. */
export const STALL_TICKS_TO_IDLE = 4;

/** World px per tick below which a tick's travel counts as standing still (full gait ≈ 3.8 px/tick). */
const STALL_EPSILON_PX = 0.5;

/** An entity's inter-tick motion track: the current and previous tick anchors (world px), plus the
 *  drawn anchor the last {@link trackMotion} computed from them. */
export interface MotionTrack {
  /** The tick `x`/`y` belong to; −1 = untracked, so the next update snaps both anchors. The pool resets it
   *  when an entity re-enters the draw list after an absence, whose anchor is stale. */
  tick: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  /** The anchor to draw at this frame - `prev` lerped toward `curr` by the frame alpha. */
  drawX: number;
  drawY: number;
  /**
   * The walk-cycle clock in tick units, advanced per sim tick by the fraction of a full gait the anchor
   * actually covered ({@link WALK_FRAME_TRAVEL_PX}), so the drawn frame (`floor(gaitPhase)`) tracks
   * ground covered rather than wall ticks. Full cruise advances 12/17 of a frame per tick.
   */
  gaitPhase: number;
  /** Consecutive ticks the anchor moved at most the stall epsilon. Reset by real travel and by snaps -
   *  a teleport is not standing still. */
  stillTicks: number;
  /** World-px jump past which this track snaps instead of lerping. */
  readonly snapDistance: number;
}

export function isStalled(m: MotionTrack): boolean {
  return m.stillTicks >= STALL_TICKS_TO_IDLE;
}

/**
 * Advance a {@link MotionTrack} to this frame's `(tick, x, y)` and stamp `drawX`/`drawY`: the previous
 * tick anchor lerped toward the current one by `alpha`, the fixed-timestep fraction clamped to [0,1]. A
 * first sighting or a jump past {@link MotionTrack.snapDistance} snaps both anchors and leaves the gait
 * clock alone - a teleport is not strides. Writes in place, so the per-frame reconcile allocates nothing.
 */
export function trackMotion(m: MotionTrack, tick: number, x: number, y: number, alpha: number): void {
  if (m.tick === -1 || Math.abs(x - m.x) > m.snapDistance || Math.abs(y - m.y) > m.snapDistance) {
    m.tick = tick;
    m.x = x;
    m.y = y;
    m.prevX = x;
    m.prevY = y;
    m.stillTicks = 0;
  } else if (m.tick !== tick) {
    const dt = tick - m.tick;
    const dist = Math.hypot(x - m.x, y - m.y);
    const rate = Math.min(MAX_GAIT_RATE, (dist * WALK_ANIMATION_RATE) / (WALK_FRAME_TRAVEL_PX * dt));
    m.gaitPhase += rate * dt;
    m.stillTicks = dist <= STALL_EPSILON_PX * dt ? m.stillTicks + dt : 0;
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
