import { describe, expect, it } from 'vitest';
import { ShelfPacker } from '../src/hud/tool-panel/messages/figure-frames.js';

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
