/** How a pooled sprite is drawn between two 12 Hz sim steps: per-kind anchors, snap bands, and gait. */
import { clamp01, lerp } from '../../data/math.js';
import { TILE_HALF_W } from '../../data/projection/index.js';
import type { SpriteKind } from '../../data/sprites/index.js';

/** Frames in one authored human walk cycle per facing (`mapmoveableanimations/animations.ini`). */
const WALK_CYCLE_FRAMES = 12;
/** The travel the clip clock calls one frame per tick: a cell in 18 ticks. Observation of the original's
 *  cadence against its walk; a faster sim walk (a shod walker on a road covers a cell in 12) turns the
 *  clip proportionally faster, slower cadences read as foot-skating next to the original. */
const WALK_CLOCK_TICKS_PER_CELL = 18;
/** Tick-locked cadence: one authored frame per sim tick at the calibrated travel. */
const WALK_ANIMATION_TICKS_PER_CYCLE = WALK_CYCLE_FRAMES;
const WALK_ANIMATION_RATE = WALK_CLOCK_TICKS_PER_CELL / WALK_ANIMATION_TICKS_PER_CYCLE;

/**
 * World-px jump between two consecutive tick anchors past which the motion track snaps instead of
 * lerping - a spawn or teleport, not a walk. The fastest legit case is a multi-tick catch-up frame
 * (≈ 5 ticks × 17 px); a real teleport jumps hundreds of px.
 */
export const SNAP_DISTANCE = 128;

/**
 * The snap band a kind's track runs under, resolved once per entity. A projectile must never snap
 * mid-flight: a multi-tick catch-up frame would trip {@link SNAP_DISTANCE} and stutter an ordinary
 * flight at the tick rate. It has no teleport to guard against - it lives launch-to-impact.
 */
export function snapDistanceForKind(kind: SpriteKind): number {
  return kind === 'projectile' ? Number.POSITIVE_INFINITY : SNAP_DISTANCE;
}

/** Original settlers use tick anchors; authored smooth clips opt into between-tick placement. */
export function drawAlphaForKind(kind: SpriteKind, frameAlpha: number, interpolate = false): number {
  return kind === 'settler' && !interpolate ? 1 : frameAlpha;
}

/** World px the feet cover per authored walk frame - one cell (`2·TILE_HALF_W`) over the 12-frame cycle.
 *  Dividing actual travel by it makes the frame clock follow the body's pace. */
const WALK_FRAME_TRAVEL_PX = (2 * TILE_HALF_W) / WALK_CYCLE_FRAMES;

/** Guard on the gait clock in frames per tick, above ordinary walking rates. It keeps a mistracked
 *  jump below the snap threshold from spinning the legs. */
const MAX_GAIT_RATE = 3.5;

/** Ticks without ground travel before a pending or blocked route presents an idle pose. */
export const STALL_TICKS_TO_IDLE = 4;

/** An entity's inter-tick motion track: the current and previous tick anchors (world px), plus the
 *  drawn anchor the last {@link trackMotion} computed from them. */
export interface MotionTrack {
  /** The tick `x`/`y` belong to; −1 = untracked, so the next update snaps both anchors. The pool resets it
   *  when an entity re-enters the draw list after an absence, whose anchor is stale. */
  tick: number;
  x: number;
  y: number;
  /** Vertical projection offset; gait measures travel before terrain lift or a flight arc. */
  lift: number;
  prevX: number;
  prevY: number;
  /** The anchor to draw at this frame - `prev` lerped toward `curr` by the frame alpha. */
  drawX: number;
  drawY: number;
  /** Projectile angle at the current and previous tick anchors, plus the angle drawn this frame. Other
   *  kinds never supply a rotation, so these remain inert. Angles may unwrap past +/-PI to preserve the
   *  shortest path across the branch cut. */
  rotation: number;
  prevRotation: number;
  drawRotation: number;
  /** Clip clock in tick units, advanced by measured travel or the original gait calibration. */
  gaitPhase: number;
  prevGaitPhase: number;
  /** Consecutive ticks without ground travel. Reset by real travel and by snaps -
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
export function trackMotion(
  m: MotionTrack,
  tick: number,
  x: number,
  y: number,
  alpha: number,
  gaitTicksPerPixel?: number,
  rotation?: number,
  lift = 0,
): void {
  if (m.tick === -1 || Math.abs(x - m.x) > m.snapDistance || Math.abs(y - m.y) > m.snapDistance) {
    m.tick = tick;
    m.x = x;
    m.y = y;
    m.lift = lift;
    m.prevX = x;
    m.prevY = y;
    m.stillTicks = 0;
    m.prevGaitPhase = m.gaitPhase;
    if (rotation !== undefined) {
      m.rotation = rotation;
      m.prevRotation = rotation;
    }
  } else if (m.tick !== tick) {
    const dt = tick - m.tick;
    const dist = Math.hypot(x - m.x, y + lift - (m.y + m.lift));
    const rate =
      gaitTicksPerPixel === undefined
        ? Math.min(MAX_GAIT_RATE, (dist * WALK_ANIMATION_RATE) / (WALK_FRAME_TRAVEL_PX * dt))
        : (dist * gaitTicksPerPixel) / dt;
    m.prevGaitPhase = m.gaitPhase;
    m.gaitPhase += rate * dt;
    m.stillTicks = dist === 0 ? m.stillTicks + dt : 0;
    m.prevX = m.x;
    m.prevY = m.y;
    m.x = x;
    m.y = y;
    m.lift = lift;
    m.tick = tick;
    if (rotation !== undefined) {
      m.prevRotation = m.rotation;
      m.rotation += Math.atan2(Math.sin(rotation - m.rotation), Math.cos(rotation - m.rotation));
    }
  }
  const a = clamp01(alpha);
  m.drawX = lerp(m.prevX, m.x, a);
  m.drawY = lerp(m.prevY, m.y, a);
  m.drawRotation = lerp(m.prevRotation, m.rotation, a);
}
