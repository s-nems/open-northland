import { TextureSource } from 'pixi.js';
import { afterEach, expect, it, vi } from 'vitest';
import { PalettedSprite } from '../../src/gpu/paletted-sprite/index.js';
import * as alphaMask from '../../src/gpu/sprite-pool/alpha-mask.js';
import { pixelHit } from '../../src/gpu/sprite-pool/pick.js';
import { createPooled } from '../../src/gpu/sprite-pool/pooled-entity.js';
import { syntheticHumanLut } from '../support/human-palettes.js';
import { useHeadlessShaderContext } from '../support/shader-context.js';

useHeadlessShaderContext();
afterEach(() => vi.restoreAllMocks());

const PAGE = 16;
const FRAME_ID = 1;

it('picks a tilted vehicle frame where it lies turned, not where it would stand', () => {
  const lut = syntheticHumanLut();
  const page = new TextureSource({ width: PAGE, height: PAGE });
  vi.spyOn(alphaMask, 'alphaMaskOf').mockReturnValue(
    alphaMask.buildAlphaMask(new Uint8Array(PAGE * PAGE * 4).fill(255), PAGE, PAGE),
  );
  const pe = createPooled('vehicle', lut);
  if (!pe.paletted) throw new Error('Expected an indexed vehicle');
  pe.boundsFrame = FRAME_ID;
  // A 2 x 10 post standing on the anchor, turned a quarter clockwise so it lies along +x.
  const body = new PalettedSprite(lut.source, lut.colours);
  body.setFrame(
    page,
    { x: 0, y: 0, width: 2, height: 10, offsetX: -1, offsetY: -10, tilt: Math.PI / 2 },
    PAGE,
    PAGE,
  );
  pe.sprites.push(body);
  pe.container.addChild(body);
  expect(pixelHit(pe, FRAME_ID, 5, -0.5)).toBe(true);
  expect(pixelHit(pe, FRAME_ID, 0, -5)).toBe(false);
  pe.container.destroy({ children: true });
  page.destroy();
  lut.source.destroy();
});
