import type { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { SpriteAtlas } from '../src/data/sprites/index.js';
import { pushComposedCharacterLayers } from '../src/gpu/sprite-pool/character-layers.js';
import { LayerBuffer } from '../src/gpu/sprite-pool/resolved-layer.js';
import type { SettlerCharacter, SpriteSheet } from '../src/index.js';
import { drawItem } from './support/fixtures.js';

/** A hero's glow: eight silhouette copies of its body, then of its head, painted between its shadow and
 *  its body, offset and faded as the original prints them. */

const source = {} as TextureSource;
const BOB = 0;
const atlas: SpriteAtlas = {
  width: 16,
  height: 16,
  frames: new Map([[BOB, { x: 0, y: 0, width: 4, height: 8, offsetX: -2, offsetY: -8 }]]),
};
const sheet: SpriteSheet = {
  source,
  atlas,
  bindings: { settler: BOB, resource: BOB, building: BOB },
};
const body = { source, atlas };
const head = { source, atlas };
const soldier: SettlerCharacter = { body, heads: [head], binding: { idle: BOB } };
const hero: SettlerCharacter = { ...soldier, glow: 'always' };
const settler = drawItem('settler');
const glowingSettler = drawItem('settler', { glow: true });

function glowCount(char: SettlerCharacter, item = settler): number {
  return layersOf(char, item).filter((layer) => layer.glow !== undefined).length;
}

function layersOf(char: SettlerCharacter, item = settler) {
  const out = new LayerBuffer();
  pushComposedCharacterLayers(out, sheet, char, char.binding, undefined, item, 0, 0);
  return out.finish();
}

describe('hero glow layers', () => {
  it('paints eight faded offset copies of body and head under the body', () => {
    const layers = layersOf(hero);
    const glows = layers.filter((layer) => layer.glow !== undefined);
    expect(glows).toHaveLength(16);
    const firstGlow = layers.findIndex((layer) => layer.glow !== undefined);
    const bodyAt = layers.findIndex((layer) => layer.glow === undefined && layer.shadow !== true);
    expect(firstGlow).toBeLessThan(bodyAt);
    expect(layers.at(-1)?.head).toBe(true);
    expect(glows.slice(0, 8).map(({ dx, dy, glow }) => [dx, dy, glow])).toEqual([
      [-6, 0, 40 / 256],
      [6, 0, 40 / 256],
      [0, -6, 40 / 256],
      [0, 6, 40 / 256],
      [-2, -2, 64 / 256],
      [-2, 2, 64 / 256],
      [2, -2, 64 / 256],
      [2, 2, 64 / 256],
    ]);
    expect(glows.every((layer) => layer.boundsExempt === true && layer.head === undefined)).toBe(true);
  });

  it("lights a plain look only when the settler's behaviour asks, and a refusing look never", () => {
    expect(glowCount(soldier)).toBe(0);
    expect(glowCount(soldier, glowingSettler)).toBe(16);
    expect(glowCount({ ...soldier, glow: 'never' }, glowingSettler)).toBe(0);
  });
});
