import { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../../src/data/scene/index.js';
import { createPooled } from '../../src/gpu/sprite-pool/pooled-entity.js';
import { presentEntity } from '../../src/gpu/sprite-pool/present-entity.js';
import type { PoolFrame } from '../../src/gpu/sprite-pool/sprite-pool.js';
import type { SpriteSheet } from '../../src/gpu/sprite-sheet.js';
import { snapshotOf } from '../support/fixtures.js';

const body = {
  source: Texture.WHITE.source,
  atlas: {
    width: 1,
    height: 1,
    frames: new Map([[0, { x: 0, y: 0, width: 1, height: 1, offsetX: 0, offsetY: 0 }]]),
  },
};
const original = { body, binding: { idle: 0, moving: 0 } };
const sheet: SpriteSheet = {
  ...body,
  bindings: { settler: 0, building: 0, resource: 0, fish: { layer: 'fish', bobs: [0], ticksPerFrame: 1 } },
  families: { fish: body },
  characters: { default: original, byJob: {}, animals: { tribes: new Set([8]), byTribe: { 8: original } } },
};
const frame: PoolFrame = {
  snapshot: snapshotOf([]),
  viewport: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  tick: 10,
  camera: { offsetX: 0, offsetY: 0 },
  screenW: 100,
  screenH: 100,
  elevation: { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 },
  alpha: 0.25,
};
const walker: DrawItem = { kind: 'settler', ref: 1, x: 0, y: 20, depth: 0, state: 'moving' };

describe('environment animation setting', () => {
  it('preserves authored own-art interpolation with the setting disabled', () => {
    const own: SpriteSheet = {
      ...sheet,
      characters: { default: { ...original, interpolateMotion: true }, byJob: {} },
    };
    const pe = createPooled('settler', undefined);
    presentEntity(pe, walker, { ...frame, environmentMotion: false }, own);
    presentEntity(pe, { ...walker, x: 12 }, { ...frame, tick: 11, environmentMotion: false }, own);
    expect(pe.container.x).toBe(3);
    pe.container.destroy();
  });

  for (const tribe of [0, 8]) {
    it(`interpolates original ${tribe === 8 ? 'animal' : 'human'} only when enabled`, () => {
      for (const environmentMotion of [false, true]) {
        const pe = createPooled('settler', undefined);
        presentEntity(pe, { ...walker, tribe }, { ...frame, environmentMotion }, sheet);
        const moved = { ...walker, tribe, x: 12 };
        presentEntity(pe, moved, { ...frame, tick: 11, environmentMotion }, sheet);
        expect(pe.container.x).toBe(environmentMotion ? 3 : 12);
        presentEntity(pe, moved, { ...frame, tick: 11, alpha: 0.75, environmentMotion }, sheet);
        expect(pe.container.x).toBe(environmentMotion ? 9 : 12);
        presentEntity(
          pe,
          { ...moved, state: 'acting', x: 16, atomicId: 25, elapsed: 1 },
          { ...frame, tick: 12, environmentMotion },
          sheet,
        );
        expect(pe.container.x).toBe(16);
        presentEntity(pe, { ...moved, x: 500 }, { ...frame, tick: 13, environmentMotion }, sheet);
        expect(pe.container.x).toBe(500);
        pe.motion.tick = -1; // the pool's existing cull/re-entry reset
        presentEntity(pe, { ...moved, x: 550 }, { ...frame, tick: 14, environmentMotion }, sheet);
        expect(pe.container.x).toBe(550);
        pe.container.destroy();
      }
    });
  }

  it('places an original walker by the chosen curve, own art by its binding', () => {
    const own: SpriteSheet = {
      ...sheet,
      characters: { default: { ...original, interpolateMotion: true }, byJob: {} },
    };
    const moved = { ...walker, x: 12 };
    const expected = { anchor: [12, 12], linear: [3, 9.6], window: [0, 0.5 * 12] } as const;
    for (const [walkPlacement, [quarter, atEighty]] of Object.entries(expected)) {
      const pe = createPooled('settler', undefined);
      const at = { ...frame, environmentMotion: true, walkPlacement } as PoolFrame;
      presentEntity(pe, walker, at, sheet);
      presentEntity(pe, moved, { ...at, tick: 11 }, sheet);
      expect(pe.container.x).toBe(quarter);
      presentEntity(pe, moved, { ...at, tick: 11, alpha: 0.8 }, sheet);
      expect(pe.container.x).toBeCloseTo(atEighty);
      pe.container.destroy();
      const smooth = createPooled('settler', undefined);
      presentEntity(smooth, walker, at, own);
      presentEntity(smooth, moved, { ...at, tick: 11 }, own);
      expect(smooth.container.x).toBe(3);
      smooth.container.destroy();
    }
  });

  it('keeps remembered and frozen anchors still between ticks', () => {
    for (const held of [{ ghost: true }, { frozen: true }]) {
      const pe = createPooled('settler', undefined);
      presentEntity(pe, walker, { ...frame, environmentMotion: true }, sheet);
      const item = { ...walker, x: 12, ...held };
      presentEntity(pe, item, { ...frame, tick: 11, environmentMotion: true }, sheet);
      expect(pe.container.x).toBe(12);
      presentEntity(pe, item, { ...frame, tick: 11, alpha: 0.75, environmentMotion: true }, sheet);
      expect(pe.container.x).toBe(12);
      pe.container.destroy();
    }
  });

  it('moves fish inside a tick and freezes their local swimming under fog', () => {
    const pe = createPooled('fish', undefined);
    const item: DrawItem = { kind: 'fish', ref: 1, x: 20, y: 20, depth: 0, swarmCount: 1 };
    const pose = (alpha: number, environmentMotion: boolean, ghost = false) =>
      presentEntity(pe, { ...item, ghost }, { ...frame, alpha, environmentMotion }, sheet)?.[0]?.dx;
    expect(pose(0.25, false)).toBe(pose(0.75, false));
    expect(pose(0.25, true)).not.toBe(pose(0.75, true));
    expect(pose(0.25, true, true)).toBe(pose(0.75, true, true));
    const held = (alpha: number) =>
      presentEntity(pe, { ...item, frozen: true }, { ...frame, alpha, environmentMotion: true }, sheet)?.[0]
        ?.dx;
    expect(held(0.25)).toBe(held(0.75));
    pe.container.destroy();
  });
});
