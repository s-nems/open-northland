import type { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { SpriteAtlas } from '../../../../src/data/sprites/index.js';
import { pushComposedCharacterLayers } from '../../../../src/gpu/sprite-pool/layers/character.js';
import { LayerBuffer } from '../../../../src/gpu/sprite-pool/layers/resolved-layer.js';
import type { SettlerCharacter, SpriteSheet } from '../../../../src/index.js';
import { drawItem } from '../../../support/fixtures.js';

const source = {} as TextureSource;
const BOB = 0;
const GHOST_ALPHA = 128 / 256;
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
const look: SettlerCharacter = {
  body: { source, atlas },
  heads: [{ source, atlas }],
  binding: { idle: BOB },
};

function figureAlphas(translucent: boolean): (number | undefined)[] {
  const out = new LayerBuffer();
  const item = drawItem('settler', translucent ? { translucent: true } : {});
  pushComposedCharacterLayers(out, sheet, look, look.binding, undefined, item, 0, 0);
  return out
    .finish()
    .filter((layer) => layer.shadow !== true)
    .map((layer) => layer.alpha);
}

describe('ghost figure', () => {
  it('draws body and head half transparent, and a solid figure of the same frame stays opaque', () => {
    expect(figureAlphas(true)).toEqual([GHOST_ALPHA, GHOST_ALPHA]);
    expect(figureAlphas(false)).toEqual([undefined, undefined]);
  });
});
