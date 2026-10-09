import { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { PalettedSprite } from '../src/gpu/paletted-sprite/index.js';
import { syntheticHumanLut } from './support/human-palettes.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

useHeadlessShaderContext();

/** A tilted frame turns its quad about its bottom-centre, so a borrowed head tips about its neck. */
describe('a tilted paletted frame', () => {
  const lut = syntheticHumanLut();
  const source = new TextureSource({ width: 32, height: 32, scaleMode: 'nearest' });
  const frame = { x: 0, y: 0, width: 16, height: 24, offsetX: -8, offsetY: -24 };
  const corners = (tilt?: number): number[] => {
    const sprite = new PalettedSprite(lut.source, lut.colours);
    sprite.setFrame(source, { ...frame, ...(tilt !== undefined ? { tilt } : {}) }, 32, 32);
    return [...sprite.geometry.positions].map((v) => Math.round(v * 1000) / 1000 + 0);
  };

  it('keeps the upright quad, and turns a quarter turn clockwise about the bottom-centre', () => {
    expect(corners()).toEqual([-8, -24, 8, -24, 8, 0, -8, 0]);
    // The pivot sits at (0, 0): top-left (-8, -24) lands at (24, -8), bottom-right (8, 0) at (0, 8).
    expect(corners(Math.PI / 2)).toEqual([24, -8, 24, 8, 0, 8, 0, -8]);
  });
});
