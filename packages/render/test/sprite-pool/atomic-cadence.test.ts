import type { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../../src/data/scene/index.js';
import { createPooled } from '../../src/gpu/sprite-pool/pooled-entity.js';
import { presentEntity } from '../../src/gpu/sprite-pool/present-entity.js';
import type { PoolFrame } from '../../src/gpu/sprite-pool/sprite-pool.js';
import type { SpriteSheet } from '../../src/gpu/sprite-sheet.js';
import { snapshotOf } from '../support/fixtures.js';

const source = {} as TextureSource;
const body = {
  source,
  atlas: {
    width: 24,
    height: 1,
    frames: new Map(
      Array.from(
        { length: 24 },
        (_, x) => [x, { x, y: 0, width: 1, height: 1, offsetX: 0, offsetY: 0 }] as const,
      ),
    ),
  },
};
const item: DrawItem = {
  kind: 'settler',
  ref: 1,
  x: 20,
  y: 30,
  depth: 0,
  state: 'acting',
  atomicId: 25,
  elapsed: 2,
  facing: 0,
};
const frame: PoolFrame = {
  snapshot: snapshotOf([]),
  viewport: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  tick: 2,
  camera: { offsetX: 0, offsetY: 0 },
  screenW: 100,
  screenH: 100,
  elevation: { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 },
  alpha: 0,
};
function sheet(smooth: boolean): SpriteSheet {
  return {
    ...body,
    bindings: { settler: 0, building: 0, resource: 0 },
    characters: {
      default: {
        body,
        interpolateMotion: smooth,
        binding: {
          idle: 0,
          byAtomic: { 25: { start: 0, dirs: 1, stride: 24, ticksPerFrame: 0.5, subtick: true } },
        },
      },
      byJob: {},
    },
  };
}

describe('subtick work animation presentation', () => {
  it('shows both 24 Hz poses inside one 12 Hz simulation tick without mutating the snapshot item', () => {
    const pooled = createPooled('settler', undefined);
    const frames = [0, 0.25, 0.5, 0.75, 1].map(
      (alpha) => presentEntity(pooled, item, { ...frame, alpha }, sheet(true))?.[0]?.frame.x,
    );
    expect(frames).toEqual([2, 2, 3, 3, 4]);
    expect(item.elapsed).toBe(2);
    expect(pooled.atomicPose.item).toBe(item);
    expect(
      presentEntity(pooled, { ...item, elapsed: 3 }, { ...frame, tick: 3, alpha: 0 }, sheet(true))?.[0]?.frame
        .x,
    ).toBe(4);
  });

  it('preserves original tick cadence and starts a new action on frame zero', () => {
    const pooled = createPooled('settler', undefined);
    for (const alpha of [0, 0.5, 1]) {
      expect(presentEntity(pooled, item, { ...frame, alpha }, sheet(false))?.[0]?.frame.x).toBe(2);
      expect(
        presentEntity(pooled, { ...item, elapsed: 1 }, { ...frame, alpha }, sheet(true))?.[0]?.frame.x,
      ).toBe(alpha * 2);
    }
  });

  it('keeps the last action moving through the planner gap and resets on its successor', () => {
    const pooled = createPooled('settler', undefined);
    presentEntity(pooled, { ...item, elapsed: 11 }, { ...frame, tick: 11, alpha: 1 }, sheet(true));
    const idle: DrawItem = { kind: 'settler', ref: 1, x: 20, y: 30, depth: 0, state: 'idle', facing: 0 };
    expect(
      [0, 0.5].map(
        (alpha) => presentEntity(pooled, idle, { ...frame, tick: 12, alpha }, sheet(true))?.[0]?.frame.x,
      ),
    ).toEqual([22, 23]);
    expect(
      presentEntity(pooled, { ...item, elapsed: 1 }, { ...frame, tick: 13, alpha: 0 }, sheet(true))?.[0]
        ?.frame.x,
    ).toBe(0);
  });
});
