import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../../src/data/scene/index.js';
import { resolveSettlerBobId } from '../../src/data/sprites/settler.js';
import { type AtomicPoseTrack, atomicPose } from '../../src/gpu/sprite-pool/atomic-pose.js';

const idle: DrawItem = { kind: 'settler', ref: 1, x: 20, y: 30, depth: 0, state: 'idle', facing: 0 };
const swing: DrawItem = { ...idle, state: 'acting', atomicId: 39, elapsed: 14, facing: 4 };
const binding = { idle: 0, moving: 1, byAtomic: { 39: { start: 100, dirs: 8, stride: 15 } } };
const fresh = (): AtomicPoseTrack => ({ tick: -1, item: undefined });

describe('atomic completion pose', () => {
  it('plays the final swing frame across the planner gap without standing or turning away', () => {
    const track = fresh();
    const frames = [
      atomicPose(swing, 14, track),
      atomicPose(idle, 15, track),
      atomicPose({ ...swing, elapsed: 1 }, 16, track),
    ].map((item) => resolveSettlerBobId(binding, item, 1000));
    expect(frames).toEqual([173, 174, 160]);
    expect(idle).toEqual({ kind: 'settler', ref: 1, x: 20, y: 30, depth: 0, state: 'idle', facing: 0 });
  });

  it('keeps the same completion frame through redraws but returns to idle after one sim tick', () => {
    const track = fresh();
    atomicPose(swing, 14, track);
    for (let frame = 0; frame < 10; frame++) {
      expect(atomicPose(idle, 15, track).elapsed).toBe(15);
    }
    expect(atomicPose(idle, 16, track)).toBe(idle);
    expect(track.item).toBeUndefined();
  });

  it.each<Partial<DrawItem>>([
    { state: 'moving' },
    { state: 'acting', atomicId: 1, elapsed: 1 },
    { x: 21 },
    { jobType: 3 },
    { carrying: true },
    { inHouse: true },
    { frozen: true },
    { ghost: true },
    { weaponGood: 2 },
  ])('honours a new action, movement, appearance or visibility immediately: %j', (change) => {
    const track = fresh();
    atomicPose(swing, 14, track);
    const next = { ...idle, ...change };
    expect(atomicPose(next, 15, track)).toBe(next);
  });

  it('does not revive an old action after skipped ticks or rewinding', () => {
    for (const tick of [13, 14, 17]) {
      const track = fresh();
      atomicPose(swing, 14, track);
      expect(atomicPose(idle, tick, track)).toBe(idle);
    }
  });
});
