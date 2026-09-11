import { FOG_STATE } from '@open-northland/sim';
import { Container, Sprite, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { MapObjectLayer, type MapObjectSprite } from '../../src/gpu/map-objects/index.js';
import { resolveLayers } from '../../src/gpu/sprite-pool/resolve-layers.js';
import type { SpriteSheet } from '../../src/gpu/sprite-sheet.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { vegetationShear } from '../../src/gpu/vegetation-sway.js';
import { WIDE } from './support.js';

const frame = { x: 0, y: 0, width: 8, height: 8, offsetX: -4, offsetY: -7 };
const tree: MapObjectSprite = {
  x: 20,
  y: 40,
  source: Texture.WHITE.source,
  frames: [frame],
  scale: 0.5,
  decor: false,
  phase: 0,
  sway: 0.01,
};

describe('own vegetation breeze', () => {
  it('moves the crown, fixes the root and freezes under fog', () => {
    const container = new Container();
    const layer = new MapObjectLayer(container, new TextureCache());
    layer.set([tree]);
    layer.update(WIDE, 0, () => FOG_STATE.VISIBLE);
    const sprite = container.children[0];
    if (!(sprite instanceof Sprite)) throw new Error('Missing tree');
    const firstX = sprite.x;
    layer.update(WIDE, 20, () => FOG_STATE.VISIBLE);
    expect(sprite.x).not.toBe(firstX);
    sprite.updateLocalTransform();
    const root = sprite.localTransform.apply({ x: 4, y: 7 });
    expect(root.x).toBeCloseTo(tree.x, 10);
    expect(root.y).toBeCloseTo(tree.y, 10);
    expect(sprite.localTransform.d).toBeCloseTo(tree.scale, 10);
    layer.update(WIDE, 21, () => FOG_STATE.EXPLORED);
    const frozenX = sprite.x;
    layer.update(WIDE, 60, () => FOG_STATE.EXPLORED);
    expect(sprite.x).toBe(frozenX);
    layer.destroy();
  });

  it('retains the same breeze after resource handover and leaves rocks still', () => {
    const atlas = { width: 8, height: 8, frames: new Map([[0, frame]]) };
    const sheet: SpriteSheet = {
      source: tree.source,
      atlas,
      bindings: { settler: 0, building: 0, resource: { default: { layer: 'tree', bob: 0 }, byGood: {} } },
      families: { tree: { source: tree.source, atlas, sway: 0.01 } },
    };
    const item = { kind: 'resource' as const, ref: 1, x: tree.x, y: tree.y, depth: 0 };
    expect(resolveLayers(sheet, item, 20)?.[0]?.shear).toBe(vegetationShear(20, tree.x, tree.y, 0.01));
    expect(resolveLayers(sheet, { ...item, ghost: true }, 20)?.[0]?.shear).toBe(
      vegetationShear(0, tree.x, tree.y, 0.01),
    );
    const stillSheet = { ...sheet, families: { tree: { source: tree.source, atlas } } };
    expect(resolveLayers(stillSheet, item, 20)?.[0]?.shear).toBeUndefined();
    for (let tick = 0; tick < 300; tick++)
      expect(Math.abs(vegetationShear(tick, 20, 40, 0.01))).toBeLessThanOrEqual(0.01);
  });
});
