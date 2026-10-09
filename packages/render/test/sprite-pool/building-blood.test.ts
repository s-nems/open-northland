import { TextureSource } from 'pixi.js';
import { expect, it } from 'vitest';
import { BLOOD_LIFETIME_TICKS } from '../../src/data/effects/blood.js';
import type { DrawItem } from '../../src/data/scene/index.js';
import { surfaceOf } from '../../src/gpu/blood-surface.js';
import { BloodSurfaces } from '../../src/gpu/overlays/blood-surfaces.js';
import { LayerBinder } from '../../src/gpu/sprite-pool/bind-layers.js';
import { createPooled } from '../../src/gpu/sprite-pool/pooled-entity.js';
import { resolveLayers } from '../../src/gpu/sprite-pool/resolve-layers.js';
import type { SpriteSheet } from '../../src/gpu/sprite-sheet.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';

it.each([false, true])(
  'keeps wall blood and pending impacts when upgrade scaffolds shift its slot (time mask: %s)',
  (withTimes) => {
    const source = new TextureSource({ width: 128, height: 64 });
    const atlas = {
      width: 128,
      height: 64,
      frames: new Map(
        [70, 71, 86].map((bob, i) => [
          bob,
          {
            x: i * 32,
            y: 0,
            width: 32,
            height: 32,
            offsetX: -16,
            offsetY: -32,
          },
        ]),
      ),
    };
    const sheet: SpriteSheet = {
      source,
      atlas,
      families: {
        houses: {
          source,
          atlas,
          ...(withTimes
            ? {
                times: { width: 128, height: 64, values: new Uint8Array(128 * 64) },
              }
            : {}),
        },
      },
      bindings: {
        settler: 1,
        resource: 1,
        building: {
          byType: { 13: { layer: 'houses', bob: 70 } },
          default: 70,
          upgradeTargetByType: { 13: 14 },
          byTribe: {
            2: {
              byType: { 13: { layer: 'houses', bob: 70 }, 14: { layer: 'houses', bob: 71 } },
              constructionByType: {
                14: [
                  { layer: 'houses', bob: 86, fromPct: 0, toPct: 100 },
                  { layer: 'houses', bob: 71, fromPct: 0, toPct: 100 },
                ],
              },
            },
          },
        },
      },
    };
    const textures = new TextureCache();
    const binder = new LayerBinder(textures, sheet);
    const pooled = createPooled('building', undefined);
    const surfaces = new BloodSurfaces();
    const item: DrawItem = { kind: 'building', ref: 1, x: 0, y: 0, depth: 0, typeId: 13, tribe: 2 };
    const frame = { camera: { offsetX: 0, offsetY: 0 }, screenW: 800, screenH: 600 };
    function bind(next: DrawItem) {
      const layers = resolveLayers(sheet, next, 0);
      binder.bind(pooled, next, layers, frame, 0);
      const slot = layers?.findIndex((layer) => layer.groundFoot === 'body') ?? -1;
      const sprite = pooled.sprites[slot];
      const surface = sprite === undefined ? undefined : surfaceOf(sprite);
      if (surface === undefined) throw new Error('missing wall receiver');
      return { slot, sprite, surface };
    }
    try {
      const before = bind(item);
      const contact = { surface: before.surface, x: 0.5, y: 0.9, radius: 5, angle: 0, age: 1 };
      surfaces.stamp(contact, 0);
      surfaces.draw(10);
      const stain = [...before.surface.packed];
      expect(stain[0]).toBeGreaterThan(0);

      const upgraded = bind({ ...item, upgradePct: 50 });
      expect(upgraded.slot).not.toBe(before.slot);
      expect(upgraded.surface.packed).toEqual(new Float32Array(stain));
      expect(surfaceOf(before.sprite ?? null)).toBeUndefined(); // The old slot now draws a shade.

      surfaces.stamp({ ...contact, x: 0.05, y: 0.5, radius: 2 }, 12);
      surfaces.draw(13);
      expect(upgraded.surface.packed[1]).toBeGreaterThan(0);
      const withImpact = [...upgraded.surface.packed];
      const cancelled = bind(item);
      expect(cancelled.surface.packed).toEqual(new Float32Array(withImpact));

      // A completed next tier has its own wall; an old contact must not paint the replacement.
      const completed = bind({ ...item, typeId: 14 });
      surfaces.stamp(contact, 14);
      expect([...completed.surface.packed]).toEqual([0, 0, 0, 0]);
      expect(before.surface.enabled).toBe(false);
      surfaces.draw(12 + BLOOD_LIFETIME_TICKS);
      expect([...before.surface.packed]).toEqual([0, 0, 0, 0]);
    } finally {
      surfaces.clear();
      pooled.container.destroy({ children: true });
      textures.clear();
      source.destroy();
    }
  },
);
