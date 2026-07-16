import { describe, expect, it } from 'vitest';
import { type MotionTrack, trackMotion } from '../src/gpu/sprite-pool/motion.js';

/**
 * The inter-tick motion track's GAIT PHASE — the walk-cycle clock scaled by ground actually covered
 * (motion.ts `gaitPhase`). What must hold: the animation-only tuning plays the authored 12-frame
 * cycle in 17 ticks while movement still takes 18, a body-pressed/braking walker's
 * cycle slows proportionally (no jogging in place — the treadmill look), a stationary tick freezes
 * it, and a snap (first sighting / teleport) contributes no strides.
 */

const WALK_TICKS_PER_CELL = 18;
const FULL_GAIT_PX_PER_TICK = 68 / WALK_TICKS_PER_CELL;

function fresh(): MotionTrack {
  return { tick: -1, x: 0, y: 0, prevX: 0, prevY: 0, drawX: 0, drawY: 0, gaitPhase: 0 };
}

describe('motion gait phase', () => {
  it('plays the walk cycle in 17 ticks without changing the 18-tick cell crossing', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1); // first sighting — snap, no strides
    for (let t = 1; t <= WALK_TICKS_PER_CELL; t++) {
      trackMotion(m, t, t * FULL_GAIT_PX_PER_TICK, 0, 1);
    }
    expect(m.gaitPhase).toBeCloseTo((12 * 18) / 17);
  });

  it('slows proportionally when the anchor advances less than the gait (no walk-in-place)', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1);
    for (let t = 1; t <= 10; t++) {
      trackMotion(m, t, t * FULL_GAIT_PX_PER_TICK * 0.2, 0, 1); // pressed to 20%
    }
    expect(m.gaitPhase).toBeCloseTo(24 / 17); // legs retain 20% of the tuned 12/17-frame cadence
  });

  it('freezes on a stationary tick and contributes nothing on a snap/teleport', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1);
    trackMotion(m, 1, FULL_GAIT_PX_PER_TICK, 0, 1);
    const afterStep = m.gaitPhase;
    trackMotion(m, 2, FULL_GAIT_PX_PER_TICK, 0, 1); // stands still
    expect(m.gaitPhase).toBe(afterStep);
    trackMotion(m, 3, FULL_GAIT_PX_PER_TICK + 500, 0, 1); // a 500 px teleport — snapped, not strode
    expect(m.gaitPhase).toBe(afterStep);
  });

  it('caps a sub-snap jump so legs never spin cartoonishly', () => {
    const m = fresh();
    trackMotion(m, 0, 0, 0, 1);
    trackMotion(m, 1, 100, 0, 1); // 100 px in one tick — under the snap threshold, far over any gait
    expect(m.gaitPhase).toBeLessThanOrEqual(2.5);
  });
});
