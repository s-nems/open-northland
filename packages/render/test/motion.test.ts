import { describe, expect, it } from 'vitest';
import { type MotionTrack, trackMotion } from '../src/gpu/sprite-pool/motion.js';

/**
 * The inter-tick motion track's GAIT PHASE — the walk-cycle clock scaled by ground actually covered
 * (motion.ts `gaitPhase`). What must hold: a full-gait cruise advances exactly one cycle-tick per sim
 * tick (the authored 12-frames-per-cell feet sync is untouched), a body-pressed/braking walker's
 * cycle slows proportionally (no jogging in place — the treadmill look), a stationary tick freezes
 * it, and a snap (first sighting / teleport) contributes no strides.
 */

const FULL_GAIT_PX = 68 / 12; // one 68 px cell over the sim's 12-tick walk cycle

function fresh(): MotionTrack {
  return { tick: -1, x: 0, y: 0, prevX: 0, prevY: 0, drawX: 0, drawY: 0, gaitPhase: 0 };
}

describe('motion gait phase', () => {
  it('advances exactly 1 per tick at the full walking gait (the feet-per-cell sync holds)', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1); // first sighting — snap, no strides
    for (let t = 1; t <= 12; t++) trackMotion(m, t, t * FULL_GAIT_PX, 0, 1);
    expect(m.gaitPhase).toBeCloseTo(12); // one full cycle per cell, as authored
  });

  it('slows proportionally when the anchor advances less than the gait (no walk-in-place)', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1);
    for (let t = 1; t <= 10; t++) trackMotion(m, t, t * FULL_GAIT_PX * 0.2, 0, 1); // pressed to 20%
    expect(m.gaitPhase).toBeCloseTo(2); // legs cycle at 20% too
  });

  it('freezes on a stationary tick and contributes nothing on a snap/teleport', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1);
    trackMotion(m, 1, FULL_GAIT_PX, 0, 1);
    const afterStep = m.gaitPhase;
    trackMotion(m, 2, FULL_GAIT_PX, 0, 1); // stands still
    expect(m.gaitPhase).toBe(afterStep);
    trackMotion(m, 3, FULL_GAIT_PX + 500, 0, 1); // a 500 px teleport — snapped, not strode
    expect(m.gaitPhase).toBe(afterStep);
  });

  it('caps a sub-snap jump so legs never spin cartoonishly', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1);
    trackMotion(m, 1, 100, 0, 1); // 100 px in one tick — under the snap threshold, far over any gait
    expect(m.gaitPhase).toBeLessThanOrEqual(2.5);
  });
});
