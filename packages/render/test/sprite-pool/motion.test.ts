import { describe, expect, it } from 'vitest';
import {
  drawAlphaForKind,
  isStalled,
  type MotionTrack,
  SNAP_DISTANCE,
  STALL_TICKS_TO_IDLE,
  snapDistanceForKind,
  trackMotion,
} from '../../src/gpu/sprite-pool/motion.js';

/**
 * The gait phase is a walk-cycle clock scaled by ground actually covered: one authored frame per tick
 * at full cruise, while a cell crossing still takes 18 ticks.
 */

const WALK_TICKS_PER_CELL = 18;
const FULL_GAIT_PX_PER_TICK = 68 / WALK_TICKS_PER_CELL;

function fresh(snapDistance = SNAP_DISTANCE): MotionTrack {
  return {
    tick: -1,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    drawX: 0,
    drawY: 0,
    gaitPhase: 0,
    stillTicks: 0,
    snapDistance,
  };
}

function drawnAt(
  m: MotionTrack,
  tick: number,
  x: number,
  y: number,
  alpha: number,
): { x: number; y: number } {
  trackMotion(m, tick, x, y, alpha);
  return { x: m.drawX, y: m.drawY };
}

describe('drawAlphaForKind - who steps and who glides', () => {
  it('draws a gait-clocked body on its tick anchor whatever the frame carries', () => {
    for (const frameAlpha of [0, 0.25, 0.99]) expect(drawAlphaForKind('settler', frameAlpha)).toBe(1);
  });

  it('leaves every other kind on the frame fraction', () => {
    expect(drawAlphaForKind('projectile', 0.25)).toBe(0.25);
    expect(drawAlphaForKind('building', 0.25)).toBe(0.25);
  });
});

describe('trackMotion - the inter-tick interpolation decision', () => {
  it('snaps both anchors on first sight (no glide in from the origin)', () => {
    const m = fresh();
    expect(drawnAt(m, 5, 100, 50, 0.5)).toEqual({ x: 100, y: 50 });
  });

  it('lerps from the previous tick anchor to the current one by alpha', () => {
    const m = fresh();
    trackMotion(m, 1, 100, 50, 0); // first sight, so it snaps
    expect(drawnAt(m, 2, 108, 50, 0.25)).toEqual({ x: 102, y: 50 });
    expect(drawnAt(m, 2, 108, 50, 0.75)).toEqual({ x: 106, y: 50 });
  });

  it('is continuous across a tick boundary (alpha→1 meets the next tick at alpha 0)', () => {
    const m = fresh();
    trackMotion(m, 1, 100, 0, 0);
    const endOfTick = drawnAt(m, 2, 108, 0, 1);
    const startOfNext = drawnAt(m, 3, 116, 0, 0);
    expect(startOfNext.x).toBe(endOfTick.x); // 108 both ways
  });

  it('clamps alpha outside [0,1]', () => {
    const m = fresh();
    trackMotion(m, 1, 0, 0, 0);
    expect(drawnAt(m, 2, 10, 0, 2).x).toBe(10);
    expect(drawnAt(m, 3, 20, 0, -1).x).toBe(10);
  });

  it('snaps (never lerps) across a teleport-sized jump', () => {
    const m = fresh();
    trackMotion(m, 1, 0, 0, 0);
    // 500 px in one tick is a respawn, not a walk, so both anchors jump and alpha is irrelevant.
    expect(drawnAt(m, 2, 500, 0, 0.5)).toEqual({ x: 500, y: 0 });
  });

  it('keeps lerping over a multi-tick catch-up step (within the snap band)', () => {
    const m = fresh();
    trackMotion(m, 1, 0, 0, 0);
    // Three sim ticks in one frame is ~26 px for a walker, lerped from the last drawn tick.
    expect(drawnAt(m, 4, 26, 0, 0.5)).toEqual({ x: 13, y: 0 });
  });
});

describe('projectile snap policy', () => {
  const CATCH_UP_TICKS = 3;
  /** Travel the walker band rejects outright, as a few ticks of any real flight would. */
  const OVER_BAND_PX = SNAP_DISTANCE * 2;

  it('gives a projectile a wider band than a walker', () => {
    expect(snapDistanceForKind('projectile')).toBeGreaterThan(snapDistanceForKind('settler'));
  });

  it('glides a catch-up frame the walker policy would snap', () => {
    const walker = fresh();
    trackMotion(walker, 1, 0, 0, 0);
    trackMotion(walker, 1 + CATCH_UP_TICKS, OVER_BAND_PX, 0, 0.5);
    expect(walker.drawX).toBe(OVER_BAND_PX); // the walker band reads it as a teleport

    const arrow = fresh(snapDistanceForKind('projectile'));
    trackMotion(arrow, 1, 0, 0, 0);
    trackMotion(arrow, 1 + CATCH_UP_TICKS, OVER_BAND_PX, 0, 0.5);
    expect(arrow.drawX).toBe(OVER_BAND_PX / 2); // the flight stays continuous
  });

  it('still snaps on first sighting (no glide in from the origin)', () => {
    const m = fresh(snapDistanceForKind('projectile'));
    trackMotion(m, 7, 400, 300, 0.5);
    expect({ x: m.drawX, y: m.drawY }).toEqual({ x: 400, y: 300 });
  });
});

describe('motion gait phase', () => {
  it('advances one frame per tick at full cruise without changing the 18-tick cell crossing', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1); // a first sighting snaps, so it adds no strides
    for (let t = 1; t <= WALK_TICKS_PER_CELL; t++) {
      trackMotion(m, t, t * FULL_GAIT_PX_PER_TICK, 0, 1);
    }
    expect(m.gaitPhase).toBeCloseTo(WALK_TICKS_PER_CELL);
  });

  it('slows proportionally when the anchor advances less than the gait (no walk-in-place)', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1);
    for (let t = 1; t <= 10; t++) {
      trackMotion(m, t, t * FULL_GAIT_PX_PER_TICK * 0.2, 0, 1); // pressed to 20%
    }
    expect(m.gaitPhase).toBeCloseTo(2); // legs retain 20% of the one-frame-per-tick cadence
  });

  it('freezes on a stationary tick and contributes nothing on a snap/teleport', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1);
    trackMotion(m, 1, FULL_GAIT_PX_PER_TICK, 0, 1);
    const afterStep = m.gaitPhase;
    trackMotion(m, 2, FULL_GAIT_PX_PER_TICK, 0, 1); // stands still
    expect(m.gaitPhase).toBe(afterStep);
    trackMotion(m, 3, FULL_GAIT_PX_PER_TICK + 500, 0, 1); // a 500 px teleport is snapped, not strode
    expect(m.gaitPhase).toBe(afterStep);
  });

  it('caps a sub-snap jump so legs never spin cartoonishly', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1);
    trackMotion(m, 1, 100, 0, 1); // under the snap threshold, far over any gait
    expect(m.gaitPhase).toBe(3.5); // lands exactly at the cap
  });
});

describe('stall detection - a moving state with no displacement must read idle, not frozen mid-stride', () => {
  it('flags a track stalled after STALL_TICKS_TO_IDLE still ticks, and real travel clears it', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1); // first sight
    trackMotion(m, 1, FULL_GAIT_PX_PER_TICK, 0, 1); // one real step
    for (let t = 2; t < 2 + STALL_TICKS_TO_IDLE; t++) {
      expect(isStalled(m)).toBe(false); // a normal stop must not flicker to idle early
      trackMotion(m, t, FULL_GAIT_PX_PER_TICK, 0, 1); // standing on the same anchor
    }
    expect(isStalled(m)).toBe(true);
    trackMotion(m, 10, FULL_GAIT_PX_PER_TICK * 2, 0, 1);
    expect(isStalled(m)).toBe(false);
  });

  it('does not count a snap/teleport as standing still', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1);
    for (let t = 1; t <= STALL_TICKS_TO_IDLE; t++) trackMotion(m, t, 0, 0, 1); // stalls in place
    expect(isStalled(m)).toBe(true);
    trackMotion(m, 6, 500, 0, 1); // a teleport-sized jump is a fresh anchor, not more standing
    expect(isStalled(m)).toBe(false);
  });
});

/**
 * A multi-tick gap is not on its own a reason to snap: a continuously-drawn walker legitimately crosses
 * several ticks in one frame under catch-up or a raised game speed. Only a first sighting snaps, and the
 * pool reuses that seam to resume a track that sat out frames.
 */
describe('motion interpolation', () => {
  it('glides across a multi-tick catch-up frame rather than jumping to the new anchor', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1);
    trackMotion(m, 1, 10, 0, 1);
    trackMotion(m, 3, 30, 0, 0.5); // two ticks caught up in one frame, drawn halfway through
    expect(m.drawX).toBe(20); // lerp(10, 30, 0.5)
  });

  it('snaps to the new anchor when the track is reset to first-sighting', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1);
    trackMotion(m, 1, 10, 0, 1);
    m.tick = -1; // what the pool's re-entry reset does to a track that sat out frames
    trackMotion(m, 8, 40, 0, 0.5); // a sub-SNAP_DISTANCE offset that would otherwise lerp from 10
    expect(m.drawX).toBe(40);
  });
});
