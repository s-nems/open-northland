import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../../../../src/data/scene/index.js';
import { resolveSettlerBobId } from '../../../../src/data/sprites/settler.js';
import {
  type AtomicPoseTrack,
  atomicPose,
  type InterpolationTrack,
  interpolateAtomicPose,
} from '../../../../src/gpu/sprite-pool/presentation/atomic-pose.js';

const idle: DrawItem = { kind: 'settler', ref: 1, x: 20, y: 30, depth: 0, state: 'idle', facing: 0 };
const swing: DrawItem = { ...idle, state: 'acting', atomicId: 39, elapsed: 14, facing: 4 };
const binding = { idle: 0, moving: 1, byAtomic: { 39: { start: 100, dirs: 8, stride: 15 } } };
const fresh = (): AtomicPoseTrack => ({ tick: -1, item: undefined });

describe('atomic completion pose', () => {
  it('reuses only the presentation pose without changing the snapshot or carrying optional fields into the next tick', () => {
    const track: InterpolationTrack = { source: undefined, pose: undefined };
    const first = interpolateAtomicPose({ ...swing, atomicDuration: 15 }, 0.25, track);
    expect(first.elapsed).toBe(13.25);
    const source = track.source;
    if (source === undefined) throw new Error('acting pose not retained');
    const second = interpolateAtomicPose(source, 0.75, track);
    expect(second).toBe(first);
    expect(second.elapsed).toBe(13.75);
    expect(source.elapsed).toBe(14);
    const next = interpolateAtomicPose({ ...swing, elapsed: 1 }, 0.5, track);
    expect(next).not.toBe(first);
    expect(next.elapsed).toBe(0.5);
    expect(next.atomicDuration).toBeUndefined();
    expect(interpolateAtomicPose(idle, 0.5, track)).toBe(idle);
  });
  it('keeps the swing across the planner gap without standing or turning away', () => {
    const track = fresh();
    const frames = [
      atomicPose(swing, 14, track),
      atomicPose(idle, 15, track),
      atomicPose({ ...swing, elapsed: 0 }, 16, track),
    ].map((item) => resolveSettlerBobId(binding, item, 1000));
    // The final frame draws on its own tick; the gap plays on to the cycle's first, which the successor opens on.
    expect(frames).toEqual([174, 160, 160]);
    expect(idle).toEqual({ kind: 'settler', ref: 1, x: 20, y: 30, depth: 0, state: 'idle', facing: 0 });
  });

  it('keeps one attack variant from the starting tick on when interpolated', () => {
    const variants = {
      idle: 0,
      byAtomicChoices: { 81: [100, 200, 300, 400].map((start) => ({ start, frameLists: [[0]] })) },
    };
    for (let start = 0; start < 40; start++) {
      const picked = new Set<number>();
      for (let elapsed = 0; elapsed < 4; elapsed++) {
        for (const alpha of [0, 0.5]) {
          const pose = interpolateAtomicPose({ ...swing, atomicId: 81, elapsed }, alpha);
          // The smooth presentation clock trails the snapshot tick by the same `1 - alpha`.
          picked.add(resolveSettlerBobId(variants, pose, start + elapsed - 1 + alpha));
        }
      }
      expect(picked.size).toBe(1);
    }
  });

  it('keeps the atomic length on the completion pose, so a swing spanning it ends on its blow', () => {
    const track = fresh();
    atomicPose({ ...swing, atomicDuration: 15 }, 14, track);
    expect(atomicPose(idle, 15, track).atomicDuration).toBe(15);
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
