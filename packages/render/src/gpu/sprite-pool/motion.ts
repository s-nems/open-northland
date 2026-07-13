/**
 * Inter-tick motion interpolation for pooled sprites: 20 Hz sim steps draw as continuous frame-rate
 * motion. Pure mutation of plain data + testable without a GPU — the interpolation decision split out
 * from the Pixi mutation, like {@link import('./reconcile.js').reconcileSprites}.
 */
import { WALK_TICKS_PER_CELL } from '@open-northland/sim';
import { TILE_HALF_W } from '../../data/iso.js';
import { clamp01, lerp } from '../../data/math.js';

/**
 * World-px jump between two consecutive tick anchors past which the motion track SNAPS instead of
 * lerping — a spawn/teleport, not a walk. The fastest legit case is a multi-tick catch-up frame of a
 * running unit (≈ 5 ticks × 17 px); real teleports jump hundreds of px, so the band between is safe.
 */
const SNAP_DISTANCE = 128;

/**
 * World px a FULL walking gait covers per sim tick — one cell (`2·TILE_HALF_W`, read at call time:
 * the pitch is a live `?pitch=` knob) over the sim's {@link WALK_TICKS_PER_CELL}-tick walk cycle
 * (the sim's world metric makes every heading cover the same on-screen length per tick). The
 * {@link MotionTrack.gaitPhase} denominator: an anchor that advanced this much in a tick plays its
 * walk cycle at the authored one-frame-per-tick cadence and the feet grip the ground exactly as
 * before; anything slower (braking, acceleration, being body-pressed in a crowd) advances the cycle
 * proportionally less, so feet never skate in place (the reported treadmill look).
 */
function fullGaitPxPerTick(): number {
  return (2 * TILE_HALF_W) / WALK_TICKS_PER_CELL;
}

/**
 * Cap on the gait-cycle rate in cycles-per-tick — covers the legit fast case (a data-paced animal
 * whose `movespeed` beats the universal 12-ticks-per-cell walk, e.g. movespeed 8 reads 1.5×) with
 * headroom, while a mistracked jump below the snap threshold can't spin the legs cartoonishly.
 * No run/sprint gait exists, so nothing legit approaches the cap.
 */
const MAX_GAIT_RATE = 2.5;

/** An entity's inter-tick motion track: the current and previous TICK anchors (world px), plus the
 *  DRAWN anchor the last {@link trackMotion} computed from them. */
export interface MotionTrack {
  /** The tick `x`/`y` belong to; −1 = never tracked (the next update snaps both anchors). */
  tick: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  /** The anchor to DRAW at this frame — `prev` lerped toward `curr` by the frame alpha. */
  drawX: number;
  drawY: number;
  /**
   * The accumulated WALK-CYCLE clock, in tick units: advanced per sim tick by the fraction of a full
   * gait the anchor ACTUALLY covered ({@link fullGaitPxPerTick}), so the walk animation's frame
   * (`floor(gaitPhase)`, consumed by the pool's moving-state resolve) tracks ground covered, not wall
   * ticks. At full cruise it advances exactly 1/tick — the authored feet-per-cell sync is untouched —
   * and a body-pressed or braking walker's legs slow with it instead of jogging in place.
   */
  gaitPhase: number;
}

/**
 * Advance a {@link MotionTrack} to this frame's (tick, anchor) and stamp the DRAWN position onto it
 * IN PLACE (`drawX`/`drawY`): the previous tick anchor lerped toward the current one by `alpha` (the
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
    const rate = Math.min(MAX_GAIT_RATE, dist / (fullGaitPxPerTick() * dt));
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
