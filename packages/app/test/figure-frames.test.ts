import { describe, expect, it } from 'vitest';
import { indexedPixels, recolourPixels, ShelfPacker } from '../src/hud/figures/figure-frames.js';

const PAGE = 64;
const GUTTER = 1;

describe('figure frame shelf packer', () => {
  it('places frames left to right with a gutter, then opens a shelf under the tallest one', () => {
    const packer = new ShelfPacker(PAGE, PAGE, GUTTER);
    expect(packer.place(20, 30)).toEqual({ x: 0, y: 0 });
    expect(packer.place(20, 10)).toEqual({ x: 21, y: 0 });
    expect(packer.place(20, 5)).toEqual({ x: 42, y: 0 });
    expect(packer.place(20, 5)).toEqual({ x: 0, y: 31 });
  });

  it('refuses a frame the page cannot take until it is reset', () => {
    const packer = new ShelfPacker(PAGE, PAGE, GUTTER);
    expect(packer.place(PAGE, 40)).toEqual({ x: 0, y: 0 });
    expect(packer.place(10, 30)).toBeNull();
    packer.reset();
    expect(packer.place(10, 30)).toEqual({ x: 0, y: 0 });
  });

  it('refuses a frame larger than an empty page', () => {
    const packer = new ShelfPacker(PAGE, PAGE, GUTTER);
    expect(packer.place(PAGE + 1, 1)).toBeNull();
    expect(packer.place(1, PAGE + 1)).toBeNull();
  });
});

describe('figure frame recolour', () => {
  const COVERED = 255;
  const PALETTE_INDICES = 256;
  const RGB = 3;
  const RED_INDEX = 2;
  /** `RED_INDEX` maps to RGB (10, 20, 30); every other index to black. */
  const colours = new Uint8Array(PALETTE_INDICES * RGB);
  colours.set([10, 20, 30], RED_INDEX * RGB);

  it('keeps each atlas pixel as its palette index and coverage', () => {
    const rgba = new Uint8ClampedArray([RED_INDEX, 9, 9, COVERED, 5, 9, 9, 0]);
    expect([...indexedPixels(rgba)]).toEqual([RED_INDEX, COVERED, 5, 0]);
  });

  it('paints covered pixels through the palette and leaves uncovered ones clear', () => {
    const out = new Uint8ClampedArray(8);
    recolourPixels(new Uint8Array([RED_INDEX, COVERED, RED_INDEX, 0]), colours, out);
    expect([...out]).toEqual([10, 20, 30, COVERED, 0, 0, 0, 0]);
  });
});
