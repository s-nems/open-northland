import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../../src/data/scene/index.js';
import {
  type MotionTrack,
  STALL_TICKS_TO_IDLE,
  snapDistanceForKind,
} from '../../src/gpu/sprite-pool/motion.js';
import {
  animationClock,
  easeReveal,
  motionClocks,
  revealedItem,
  walkPose,
} from '../../src/gpu/sprite-pool/presentation.js';

const TICK = 100;
const LAST_FACING = 5;
const ANCHOR = { ref: 1, x: 0, y: 0, depth: 0 } as const;

const WALKER: DrawItem = { ...ANCHOR, kind: 'settler', state: 'moving', facing: 3 };
/** A re-pathing walker: still `moving`, but with no heading to read this tick. */
const HEADINGLESS_WALKER: DrawItem = { ...ANCHOR, kind: 'settler', state: 'moving' };
const IDLE_SETTLER: DrawItem = { ...ANCHOR, kind: 'settler', state: 'idle' };
/** A non-settler in the state the settler rules would rewrite - isolates the kind guard. */
const MOVING_BUILDING: DrawItem = { ...ANCHOR, kind: 'building', state: 'moving' };
const SITE: DrawItem = { ...ANCHOR, kind: 'building', state: 'idle', builtPct: 90 };
const UPGRADE_SITE: DrawItem = { ...ANCHOR, kind: 'building', state: 'idle', upgradePct: 90 };

function motion(stillTicks: number): MotionTrack {
  return {
    tick: 0,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    drawX: 0,
    drawY: 0,
    rotation: 0,
    prevRotation: 0,
    drawRotation: 0,
    gaitPhase: 0,
    prevGaitPhase: 0,
    stillTicks,
    snapDistance: snapDistanceForKind('settler'),
  };
}

const WALKING = motion(0);
const STALLED = motion(STALL_TICKS_TO_IDLE);

describe('interpolated character clocks', () => {
  it('keeps the gait between the same anchors as the moving body', () => {
    const track = { ...WALKING, prevGaitPhase: 4, gaitPhase: 6 };
    expect(motionClocks(WALKER, 10, 0.25, track, true).gait).toBe(4.5);
    expect(motionClocks(WALKER, 10, 0.75, track, true).gait).toBe(5.5);
    expect(motionClocks(WALKER, 10, 0.25, track, false).gait).toBe(6);
    expect(motionClocks(IDLE_SETTLER, 10, 0.25, track, true).animation).toBe(46.25);
    expect(motionClocks({ ...IDLE_SETTLER, frozen: true }, 10, 0.25, track, true).animation).toBe(0);
    expect(motionClocks({ ...WALKER, frozen: true }, 10, 0.75, track, true).gait).toBe(0);
    expect(motionClocks({ ...WALKER, ghost: true }, 10, 0.25, track, true).gait).toBe(0);
    expect(motionClocks(SITE, 10, 0.25, track, false, true).animation).toBe(10.25);
  });
});

describe('walkPose', () => {
  it('presents the idle pose for a settler whose anchor has sat still while state reads moving', () => {
    expect(walkPose(WALKER, 'settler', STALLED, undefined).state).toBe('idle');
  });

  it('keeps the stall guard ahead of the sticky facing, so a stalled unit never substitutes a heading', () => {
    const posed = walkPose(HEADINGLESS_WALKER, 'settler', STALLED, LAST_FACING);
    expect(posed.state).toBe('idle');
    expect(posed.facing).toBeUndefined();
  });

  it('reuses the last real facing across the one-tick heading gap of a re-pathing walker', () => {
    expect(walkPose(HEADINGLESS_WALKER, 'settler', WALKING, LAST_FACING).facing).toBe(LAST_FACING);
  });

  it('returns a normally walking settler untouched, so the hot path allocates nothing', () => {
    expect(walkPose(WALKER, 'settler', WALKING, LAST_FACING)).toBe(WALKER);
  });

  it('passes an idle settler through untouched, so it draws the default idle facing', () => {
    expect(walkPose(IDLE_SETTLER, 'settler', WALKING, LAST_FACING)).toBe(IDLE_SETTLER);
  });

  it('never re-poses a non-settler, even in a state the settler rules would rewrite', () => {
    expect(walkPose(MOVING_BUILDING, 'building', STALLED, LAST_FACING)).toBe(MOVING_BUILDING);
  });
});

describe('animationClock', () => {
  it('runs on the free sim tick for a normally drawn non-settler item', () => {
    expect(animationClock(SITE, TICK)).toBe(TICK);
  });

  it('offsets a settler by its entity id, so standing crowds do not idle in unison', () => {
    const a = animationClock({ ...IDLE_SETTLER, ref: 1 }, TICK);
    const b = animationClock({ ...IDLE_SETTLER, ref: 2 }, TICK);
    expect(a).not.toBe(b);
    // The offset is a constant phase, not a speed change: the clock still advances 1 per tick.
    expect(animationClock({ ...IDLE_SETTLER, ref: 1 }, TICK + 1)).toBe(a + 1);
  });

  it('offsets a delivery flag by its entity id, so a row of flags does not wave in unison', () => {
    const pile = { kind: 'stockpile', ref: 1, x: 0, y: 0, depth: 0 } as const;
    const flag = { ...pile, isFlag: true } as const;
    const a = animationClock(flag, TICK);
    expect(a).not.toBe(animationClock({ ...flag, ref: 2 }, TICK));
    expect(animationClock(flag, TICK + 1)).toBe(a + 1);
    // A held pile draws its heap, not the wave, so it keeps the shared clock.
    expect(animationClock({ ...pile, goodType: 5 }, TICK)).toBe(TICK);
    expect(animationClock({ ...flag, ghost: true }, TICK)).toBe(0);
  });

  it('freezes a fog ghost, so an animating mill cannot leak that the building is still manned', () => {
    expect(animationClock({ ...SITE, ghost: true }, TICK)).toBe(0);
  });

  it('freezes a frozen indoor portrait subject to a standing pose', () => {
    expect(animationClock({ ...WALKER, frozen: true }, TICK)).toBe(0);
  });
});

describe('easeReveal', () => {
  it('initialises a first-seen site straight to its target instead of growing from zero', () => {
    expect(easeReveal(undefined, 40)).toBeCloseTo(0.4);
  });

  it('moves a fraction of the remaining distance per frame and converges upward', () => {
    const first = easeReveal(0.4, 80) as number;
    expect(first).toBeGreaterThan(0.4);
    expect(first).toBeLessThan(0.8);
    expect(easeReveal(first, 80) as number).toBeGreaterThan(first);
  });

  it('clears the reveal once no progress is reported', () => {
    expect(easeReveal(0.5, undefined)).toBeUndefined();
  });

  it('clamps a progress value outside 0..100 into the reveal fraction range', () => {
    expect(easeReveal(undefined, 140)).toBe(1);
    expect(easeReveal(undefined, -20)).toBe(0);
  });
});

describe('revealedItem', () => {
  it('writes the eased reveal back over the field that carried the progress', () => {
    expect(revealedItem(SITE, 0.5).builtPct).toBe(50);
    expect(revealedItem(UPGRADE_SITE, 0.5).upgradePct).toBe(50);
  });

  it('leaves the upgrade field alone while a from-scratch build is in progress', () => {
    expect(revealedItem(SITE, 0.5).upgradePct).toBeUndefined();
  });

  it('never presents an in-progress site as complete - completion is the sim dropping the field', () => {
    expect(revealedItem(SITE, 1).builtPct).toBe(99);
  });

  it('passes an item with no reveal through untouched', () => {
    expect(revealedItem(SITE, undefined)).toBe(SITE);
  });
});
