/**
 * Inter-tick motion interpolation for pooled sprites: 20 Hz sim steps draw as continuous frame-rate
 * motion. Pure mutation of plain data + testable without a GPU — the interpolation decision split out
 * from the Pixi mutation, like {@link import('./reconcile.js').reconcileSprites}.
 */

/**
 * World-px jump between two consecutive tick anchors past which the motion track SNAPS instead of
 * lerping — a spawn/teleport, not a walk. The fastest legit case is a multi-tick catch-up frame of a
 * running unit (≈ 5 ticks × 17 px); real teleports jump hundreds of px, so the band between is safe.
 */
const SNAP_DISTANCE = 128;

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
}

/**
 * Advance a {@link MotionTrack} to this frame's (tick, anchor) and stamp the DRAWN position onto it
 * IN PLACE (`drawX`/`drawY`): the previous tick anchor lerped toward the current one by `alpha` (the
 * fixed-timestep fraction, clamped to [0,1]). A new tick rolls current→previous; a first sighting or
 * a jump past {@link SNAP_DISTANCE} (a spawn/teleport, not a walk) snaps both anchors so nothing
 * glides across the map. Writes into the caller's track instead of returning a fresh point so the
 * per-frame reconcile stays allocation-free in the steady state (the retained-pool contract).
 */
export function trackMotion(m: MotionTrack, tick: number, x: number, y: number, alpha: number): void {
  if (m.tick === -1 || Math.abs(x - m.x) > SNAP_DISTANCE || Math.abs(y - m.y) > SNAP_DISTANCE) {
    m.tick = tick;
    m.x = x;
    m.y = y;
    m.prevX = x;
    m.prevY = y;
  } else if (m.tick !== tick) {
    m.prevX = m.x;
    m.prevY = m.y;
    m.x = x;
    m.y = y;
    m.tick = tick;
  }
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  m.drawX = m.prevX + (m.x - m.prevX) * a;
  m.drawY = m.prevY + (m.y - m.prevY) * a;
}
