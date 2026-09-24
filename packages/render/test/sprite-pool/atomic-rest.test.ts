import { describe, expect, it } from 'vitest';
import { buildScene } from '../../src/data/scene/index.js';
import { resolveSettlerBobId } from '../../src/data/sprites/settler.js';
import type { SpriteFrameRef } from '../../src/data/sprites/settler-bindings.js';
import {
  type AtomicPoseTrack,
  atomicPose,
  interpolateAtomicPose,
} from '../../src/gpu/sprite-pool/atomic-pose.js';
import { entity, FLAT_3x2, snapshotOf } from '../support/fixtures.js';

const mining: SpriteFrameRef = {
  start: 100,
  dirs: 8,
  stride: 16,
  subtick: true,
  frameDurations: [6, 6, 6, 6, 20, 5, 5, 5, 5, 6, 2, 3, 33, 3, 3, 2].map((n) => n / 4),
};

function scene(elapsed: number, restTail?: boolean) {
  const items = buildScene(
    snapshotOf([
      entity(1, 1, 1, {
        Settler: { tribe: 0 },
        CurrentAtomic: { atomicId: 25, restTail },
        AtomicClock: { elapsed },
      }),
    ]),
    FLAT_3x2,
  );
  const item = items.find((item) => item.kind === 'settler');
  if (item === undefined) throw new Error('Missing settler');
  return { ...item, facing: 0 };
}

describe('harvest rest presentation', () => {
  it.each<SpriteFrameRef>([
    mining,
    { start: 100, dirs: 8, stride: 29 },
    { start: 100, frameLists: [Array.from({ length: 29 }, (_, i) => i)] },
  ])('holds the ready pose through a rest tail and resumes the next swing: %j', (clip) => {
    const binding = { idle: 0, byAtomic: { 25: clip } };
    for (let elapsed = 29; elapsed < 44; elapsed++) {
      const item = scene(elapsed, true);
      expect(item.atomicRest).toBe(true);
      for (const alpha of [0, 0.5, 0.99]) {
        expect(resolveSettlerBobId(binding, interpolateAtomicPose(item, alpha), 1000)).toBe(100);
      }
    }
    const resumed = scene(18);
    expect(resumed.atomicRest).toBeUndefined();
    expect(resolveSettlerBobId(binding, resumed, 1000)).toBeGreaterThan(100);
    expect(resolveSettlerBobId(binding, scene(1), 1000)).toBe(100);
  });

  it('preserves the rest pose through a planner gap without leaking it into a successor', () => {
    const track: AtomicPoseTrack = { tick: -1, item: undefined };
    const resting = scene(43, true);
    const idle = {
      kind: 'settler' as const,
      ref: 1,
      x: resting.x,
      y: resting.y,
      depth: resting.depth,
      state: 'idle' as const,
      tribe: 0,
    };
    atomicPose(resting, 43, track);
    const gap = atomicPose(idle, 44, track);
    expect(gap.atomicRest).toBe(true);
    expect(resolveSettlerBobId({ idle: 0, byAtomic: { 25: mining } }, gap, 44)).toBe(100);
    expect(atomicPose(scene(1), 45, track).atomicRest).toBeUndefined();
  });
});
