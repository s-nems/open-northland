import { FOG_STATE } from '@open-northland/sim';
import { Container, Sprite, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { MapObjectLayer, type MapObjectSprite } from '../../src/gpu/map-objects/index.js';
import { resolveLayers } from '../../src/gpu/sprite-pool/resolve-layers.js';
import type { SpriteSheet } from '../../src/gpu/sprite-sheet.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { castShadowShear, setVegetationShear, vegetationShear } from '../../src/gpu/vegetation-sway.js';
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

const STILL_AIR = { strength: 0, direction: 1, gust: 1 };
const STORM = { strength: 0.8, direction: 1, gust: 0 };
/** Ticks sampled across several breeze swings. */
const SWING_TICKS = Array.from({ length: 600 }, (_, tick) => tick);

describe('vegetation in weather wind', () => {
  it('sways in still air exactly as without weather', () => {
    for (const tick of [0, 7.5, 123, 4000])
      expect(vegetationShear(tick, 20, 40, TREE_SWAY, STILL_AIR)).toBe(
        vegetationShear(tick, 20, 40, TREE_SWAY),
      );
  });

  it('swings wider in a storm and leans the crown downwind', () => {
    const calm = SWING_TICKS.map((tick) => vegetationShear(tick, 20, 40, TREE_SWAY));
    const storm = SWING_TICKS.map((tick) => vegetationShear(tick, 20, 40, TREE_SWAY, STORM));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(spread(storm)).toBeGreaterThan(1.5 * spread(calm));
    // A negative shear leans the crown right, the way this wind blows.
    expect(mean(storm)).toBeLessThan(-TREE_SWAY);
    expect(Math.max(...storm.map(Math.abs))).toBeLessThan(6 * TREE_SWAY);
    const westerly = { ...STORM, direction: -1 };
    expect(
      mean(SWING_TICKS.map((tick) => vegetationShear(tick, 20, 40, TREE_SWAY, westerly))),
    ).toBeGreaterThan(TREE_SWAY);
  });

  it('bends the crown of a tree downwind and leaves its root', () => {
    const container = new Container();
    const layer = new MapObjectLayer(container, new TextureCache());
    layer.set([tree]);
    const crownShift = (wind?: typeof STORM) => {
      layer.update(WIDE, 20, undefined, undefined, 20, wind);
      const sprite = container.children[0];
      if (!(sprite instanceof Sprite)) throw new Error('Missing tree');
      sprite.updateLocalTransform();
      expect(sprite.localTransform.apply({ x: 4, y: 7 }).x).toBeCloseTo(tree.x, 10);
      return sprite.localTransform.apply({ x: -frame.offsetX, y: 0 }).x;
    };
    const calm = crownShift();
    // Weather wind reaches the trees only under the environment-motion setting.
    expect(crownShift(STORM)).toBe(calm);
    layer.setEnvironmentMotion(true);
    const breeze = crownShift();
    expect(crownShift({ ...STORM, strength: 1 })).toBeGreaterThan(breeze);
    layer.destroy();
  });

  it('bends a pooled resource tree and holds a ghost still', () => {
    const atlas = { width: 8, height: 8, frames: new Map([[0, frame]]) };
    const sheet: SpriteSheet = {
      source: tree.source,
      atlas,
      bindings: { settler: 0, building: 0, resource: { default: { layer: 'tree', bob: 0 }, byGood: {} } },
      families: { tree: { source: tree.source, atlas, sway: TREE_SWAY } },
    };
    const item = { kind: 'resource' as const, ref: 1, x: tree.x, y: tree.y, depth: 0 };
    expect(resolveLayers(sheet, item, 20, 20, 20.5, STORM)?.[0]?.shear).toBe(
      vegetationShear(20.5, tree.x, tree.y, TREE_SWAY, STORM),
    );
    expect(resolveLayers(sheet, { ...item, ghost: true }, 20, 20, 20, STORM)?.[0]?.shear).toBe(
      vegetationShear(0, tree.x, tree.y, TREE_SWAY),
    );
  });
});

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

describe('vegetation shear transform', () => {
  it('restores the unsheared transform after bends in either direction', () => {
    const sprite = new Sprite(Texture.WHITE);
    for (const shear of [0.25, 0, -0.25, 0]) {
      setVegetationShear(sprite, 0.5, shear);
      expect(sprite.skew.x).toBe(Math.atan(shear));
      expect(sprite.scale.x).toBe(0.5);
      expect(sprite.scale.y).toBe(0.5 * Math.hypot(1, shear));
    }
    sprite.destroy();
  });

  it.each([0, -0, 0.5, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'preserves zero-shear numeric scale behavior for %s',
    (scale) => {
      const sprite = new Sprite(Texture.WHITE);
      for (const shear of [0, -0]) {
        // Start away from zero so Pixi observes the signed-zero assignment in either case.
        sprite.skew.x = 0.25;
        setVegetationShear(sprite, scale, shear);
        expect(sprite.skew.x).toBe(Math.atan(shear));
        expect(sprite.scale.x).toBe(scale);
        expect(sprite.scale.y).toBe(scale * Math.hypot(1, shear));
      }
      sprite.destroy();
    },
  );
});
