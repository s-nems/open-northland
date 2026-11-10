import { type Sprite, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../../../src/data/scene/index.js';
import { type BindFrame, LayerBinder } from '../../../src/gpu/sprite-pool/bind-layers.js';
import { resolveLayers } from '../../../src/gpu/sprite-pool/layers/resolve.js';
import { createPooled, type PooledEntity } from '../../../src/gpu/sprite-pool/pooled-entity.js';
import type { SpriteSheet } from '../../../src/gpu/textures/sprite-sheet.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';

/**
 * A bind told its inputs hold only places the layers moved from the record their sprite already shows.
 * Each case compares the sprites it leaves with those of a full bind of the same layers on a fresh entity.
 */

const HEADINGS = 18;
const source = new TextureSource({ width: 256, height: 16 });
const atlas = {
  width: 256,
  height: 16,
  frames: new Map(
    Array.from({ length: HEADINGS }, (_, bob) => [
      bob,
      { x: bob * 12, y: 0, width: 10 + (bob % 3), height: 8, offsetX: -5, offsetY: -4 },
    ]),
  ),
};
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 1,
    building: 1,
    resource: 1,
    fish: { layer: 'fishes', bobs: Array.from({ length: HEADINGS }, (_, bob) => bob), ticksPerFrame: 1 },
  },
  families: { fishes: { source, atlas } },
};
const frame: BindFrame = { camera: { offsetX: 0, offsetY: 0 }, screenW: 800, screenH: 600 };
const school: DrawItem = { kind: 'fish', ref: 3, x: 40, y: 60, depth: 0, swarmCount: 12 };
/** Far enough apart for fish of the school to turn onto other headings. */
const TICKS = [0, 7.5, 400, 5000, 5000.25, 90000];

function shown(pe: PooledEntity) {
  return (pe.sprites as readonly Sprite[]).map((sprite) => ({
    texture: sprite.texture,
    x: sprite.x,
    y: sprite.y,
    scaleX: sprite.scale.x,
    scaleY: sprite.scale.y,
    skew: sprite.skew.x,
    alpha: sprite.alpha,
    visible: sprite.visible,
    tint: sprite.tint,
  }));
}

function fullyBound(textures: TextureCache, item: DrawItem, tick: number) {
  const pe = createPooled('fish', undefined);
  new LayerBinder(textures, sheet).bind(pe, item, resolveLayers(sheet, item, tick), frame, 1);
  return { sprites: shown(pe), bounds: { ...pe.bounds } };
}

describe('LayerBinder - layers moved from the record their sprite shows', () => {
  it('leaves a school as a full bind would on every frame, through heading changes', () => {
    const textures = new TextureCache();
    const binder = new LayerBinder(textures, sheet);
    const pe = createPooled('fish', undefined);
    const headings = new Set<Texture>();
    TICKS.forEach((tick, i) => {
      binder.bind(pe, school, resolveLayers(sheet, school, tick), frame, i + 1, i > 0);
      const full = fullyBound(textures, school, tick);
      expect(shown(pe)).toEqual(full.sprites);
      expect(pe.bounds).toEqual(full.bounds);
      for (const sprite of pe.sprites) headings.add(sprite.texture);
    });
    expect(headings.size).toBeGreaterThan(1);
  });

  it('binds a slot in full after the placeholder drew in the layers place', () => {
    const textures = new TextureCache();
    const binder = new LayerBinder(textures, sheet);
    const pe = createPooled('fish', undefined);
    const layers = resolveLayers(sheet, school, 3);
    binder.bind(pe, school, layers, frame, 1);
    binder.bind(pe, school, null, frame, 2);
    expect(pe.sprites.every((sprite) => sprite.texture === Texture.EMPTY)).toBe(true);
    binder.bind(pe, school, resolveLayers(sheet, school, 3.5), frame, 3, true);
    expect(shown(pe)).toEqual(fullyBound(textures, school, 3.5).sprites);
  });

  it('binds a shrunken then regrown school in full where a slot was hidden', () => {
    const textures = new TextureCache();
    const binder = new LayerBinder(textures, sheet);
    const pe = createPooled('fish', undefined);
    binder.bind(pe, school, resolveLayers(sheet, school, 3), frame, 1);
    const fewer = { ...school, swarmCount: 5 };
    binder.bind(pe, fewer, resolveLayers(sheet, fewer, 3.25), frame, 2, true);
    binder.bind(pe, school, resolveLayers(sheet, school, 3.5), frame, 3, true);
    expect(shown(pe)).toEqual(fullyBound(textures, school, 3.5).sprites);
  });
});
