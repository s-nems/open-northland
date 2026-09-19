import { FOG_STATE } from '@open-northland/sim';
import { Container, Sprite, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { MapObjectLayer, type MapObjectSprite } from '../../src/gpu/map-objects/index.js';
import { resolveLayers } from '../../src/gpu/sprite-pool/resolve-layers.js';
import type { SpriteSheet } from '../../src/gpu/sprite-sheet.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { castShadowShear, vegetationShear } from '../../src/gpu/vegetation-sway.js';
import { WIDE } from './support.js';

const frame = { x: 0, y: 0, width: 8, height: 8, offsetX: -4, offsetY: -7 };
const TREE_SWAY = 0.01;
const tree: MapObjectSprite = {
  x: 20,
  y: 40,
  source: Texture.WHITE.source,
  frames: [frame],
  scale: 0.5,
  decor: false,
  phase: 0,
  sway: TREE_SWAY,
};

describe('own vegetation breeze', () => {
  it('smooths only enabled breeze between ticks and restores the baseline immediately', () => {
    const container = new Container();
    const layer = new MapObjectLayer(container, new TextureCache());
    // Keep an authored multi-frame sequence beside the breeze: fractional time must not select frames.
    layer.set([{ ...tree, frames: [frame, { ...frame, x: 8 }] }]);
    layer.update(WIDE, 20, undefined, undefined, 20);
    const sprite = container.children[0];
    if (!(sprite instanceof Sprite)) throw new Error('Missing tree');
    const baselineX = sprite.x;
    const baselineTexture = sprite.texture;
    layer.update(WIDE, 20, undefined, undefined, 20.5);
    expect(sprite.x).toBe(baselineX);
    layer.setEnvironmentMotion(true);
    layer.update(WIDE, 20, undefined, undefined, 20.5);
    expect(sprite.x).not.toBe(baselineX);
    expect(sprite.texture).toBe(baselineTexture);
    sprite.updateLocalTransform();
    const root = sprite.localTransform.apply({ x: 4, y: 7 });
    expect(root.x).toBeCloseTo(tree.x, 10);
    expect(root.y).toBeCloseTo(tree.y, 10);
    layer.update(WIDE, 20, () => FOG_STATE.EXPLORED, 1, 20.6);
    const frozenX = sprite.x;
    layer.update(WIDE, 20, () => FOG_STATE.EXPLORED, 1, 20.9);
    expect(sprite.x).toBe(frozenX);
    layer.setEnvironmentMotion(false);
    layer.update(WIDE, 20, undefined, undefined, 20.9);
    expect(sprite.x).toBe(baselineX);
    layer.destroy();
  });

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

  it('carries the far edge of the cast shadow with the crown and pins it at the feet', () => {
    const shadowFrame = { x: 0, y: 0, width: 12, height: 3, offsetX: -6, offsetY: -2 };
    const container = new Container();
    const layer = new MapObjectLayer(container, new TextureCache());
    layer.set([{ ...tree, shadow: { source: Texture.WHITE.source, frames: [shadowFrame] } }]);
    layer.update(WIDE, 20, () => FOG_STATE.VISIBLE);
    const [body, shadow] = container.children;
    if (!(body instanceof Sprite) || !(shadow instanceof Sprite)) throw new Error('Missing tree or shadow');
    body.updateLocalTransform();
    shadow.updateLocalTransform();
    const crownShift = body.localTransform.apply({ x: -frame.offsetX, y: 0 }).x - tree.x;
    const farEdgeShift = shadow.localTransform.apply({ x: -shadowFrame.offsetX, y: 0 }).x - tree.x;
    expect(crownShift).not.toBe(0);
    expect(farEdgeShift).toBeCloseTo(crownShift, 10);
    const feet = shadow.localTransform.apply({ x: -shadowFrame.offsetX, y: -shadowFrame.offsetY });
    expect(feet.x).toBeCloseTo(tree.x, 10);
    expect(feet.y).toBeCloseTo(tree.y, 10);
    layer.destroy();
  });

  it('sways art shipped still only while environment motion is on', () => {
    const { sway: _authored, ...still } = tree;
    const container = new Container();
    const layer = new MapObjectLayer(container, new TextureCache());
    layer.set([{ ...still, environmentSway: TREE_SWAY }]);
    layer.update(WIDE, 20, undefined, undefined, 20);
    const sprite = container.children[0];
    if (!(sprite instanceof Sprite)) throw new Error('Missing tree');
    const restX = tree.x + frame.offsetX * tree.scale;
    expect(sprite.x).toBe(restX);
    expect(sprite.skew.x).toBe(0);
    layer.setEnvironmentMotion(true);
    layer.update(WIDE, 20, undefined, undefined, 20);
    expect(sprite.x).not.toBe(restX);
    layer.setEnvironmentMotion(false);
    layer.update(WIDE, 20, undefined, undefined, 20);
    expect(sprite.x).toBe(restX);
    expect(sprite.skew.x).toBe(0);
    layer.destroy();
  });

  it('leaves a silhouette that lies wholly below the feet unsheared', () => {
    expect(castShadowShear(0.02, -100, 0)).toBe(0);
    expect(castShadowShear(0.02, -100, 4)).toBe(0);
  });

  it('bounds the shear of a silhouette far flatter than its caster', () => {
    const projected = castShadowShear(0.02, -120, -20);
    expect(projected).toBeCloseTo(0.12, 10);
    expect(castShadowShear(0.02, -120, -1)).toBeLessThan(projected * 2);
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
    expect(resolveLayers(sheet, item, 20, 20, 20.5)?.[0]?.shear).toBe(
      vegetationShear(20.5, tree.x, tree.y, 0.01),
    );
    expect(resolveLayers(sheet, { ...item, ghost: true }, 20)?.[0]?.shear).toBe(
      vegetationShear(0, tree.x, tree.y, 0.01),
    );
    const stillSheet = { ...sheet, families: { tree: { source: tree.source, atlas } } };
    expect(resolveLayers(stillSheet, item, 20)?.[0]?.shear).toBeUndefined();
    for (let tick = 0; tick < 300; tick++)
      expect(Math.abs(vegetationShear(tick, 20, 40, 0.01))).toBeLessThanOrEqual(0.01);
  });
});
