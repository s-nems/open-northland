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
    it(`keeps an original ${tribe === 8 ? 'animal' : 'human'} on its tick anchor with the setting on or off`, () => {
      for (const environmentMotion of [false, true]) {
        const pe = createPooled('settler', undefined);
        presentEntity(pe, { ...walker, tribe }, { ...frame, environmentMotion }, sheet);
        const moved = { ...walker, tribe, x: 12 };
        presentEntity(pe, moved, { ...frame, tick: 11, environmentMotion }, sheet);
        expect(pe.container.x).toBe(12);
        presentEntity(pe, moved, { ...frame, tick: 11, alpha: 0.75, environmentMotion }, sheet);
        expect(pe.container.x).toBe(12);
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

  it('paces uphill and downhill gaits by ground travel while drawing on the slope', () => {
    const flat = createPooled('settler', undefined);
    const hill = createPooled('settler', undefined);
    for (let tick = 0; tick <= 12; tick++) {
      const item = { ...walker, y: 20 + tick * 2 };
      // On the uphill half the projected feet stay level despite real north/south travel.
      const lift = tick <= 6 ? tick * 2 : (12 - tick) * 2;
      presentEntity(flat, item, { ...frame, tick }, sheet);
      presentEntity(hill, { ...item, lift }, { ...frame, tick }, sheet);
      expect(hill.motion.gaitPhase).toBeCloseTo(flat.motion.gaitPhase);
      expect(hill.motion.stillTicks).toBe(0);
      expect(hill.container.y).toBe(item.y - lift);
    }
    flat.container.destroy();
    hill.container.destroy();
  });

  it('keeps turns and changing speeds on the authoritative anchor without restarting the gait', () => {
    for (const tribe of [0, 8]) {
      const pe = createPooled('settler', undefined);
      const steps = [
        { x: 0, y: 0, facing: 4 },
        { x: 4, y: 0, facing: 4 },
        { x: 6, y: 2, facing: 5 },
        { x: 5, y: 3, facing: 0 },
        { x: 4.75, y: 3.25, facing: 0 },
      ];
      let phase = 0;
      for (const [tick, step] of steps.entries()) {
        const item = { ...walker, tribe, ...step };
        presentEntity(pe, item, { ...frame, tick, alpha: 0 }, sheet);
        expect(pe.motion.gaitPhase).toBeGreaterThanOrEqual(phase);
        phase = pe.motion.gaitPhase;
        for (const alpha of [0.25, 0.75, 1]) {
          presentEntity(pe, item, { ...frame, tick, alpha }, sheet);
          expect(pe.container.x).toBe(step.x);
          expect(pe.container.y).toBe(step.y);
          expect(pe.motion.gaitPhase).toBe(phase);
        }
      }
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
