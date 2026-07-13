import { describe, expect, it } from 'vitest';
import { keyEdgeConnectedNearBlack, outlineOpaqueSilhouette } from '../src/hud/minimap/frame-keying.js';

const grid = (cells: number[][][]): Uint8ClampedArray => new Uint8ClampedArray(cells.flat(2));

describe('keyEdgeConnectedNearBlack', () => {
  const BLACK = [8, 8, 8, 255];
  const WOOD = [180, 140, 90, 255];
  const CLEAR = [0, 0, 0, 0];
  const alphaAt = (rgba: Uint8ClampedArray, width: number, x: number, y: number): number =>
    rgba[(y * width + x) * 4 + 3] ?? -1;

  it('keys the edge-connected near-black outside but keeps enclosed shadows opaque', () => {
    const rgba = grid([
      [BLACK, BLACK, BLACK, BLACK, BLACK],
      [BLACK, WOOD, WOOD, WOOD, BLACK],
      [BLACK, WOOD, BLACK, WOOD, BLACK],
      [BLACK, WOOD, WOOD, WOOD, BLACK],
      [BLACK, BLACK, BLACK, BLACK, BLACK],
    ]);
    keyEdgeConnectedNearBlack(rgba, 5, 5);
    expect(alphaAt(rgba, 5, 0, 0)).toBe(0);
    expect(alphaAt(rgba, 5, 4, 2)).toBe(0);
    expect(alphaAt(rgba, 5, 2, 2)).toBe(255);
    expect(alphaAt(rgba, 5, 1, 1)).toBe(255);
  });

  it('flows through already-transparent pixels into a black region they connect to the edge', () => {
    const rgba = grid([
      [WOOD, CLEAR, WOOD],
      [WOOD, BLACK, WOOD],
      [WOOD, WOOD, WOOD],
    ]);
    keyEdgeConnectedNearBlack(rgba, 3, 3);
    expect(alphaAt(rgba, 3, 1, 1)).toBe(0);
    expect(alphaAt(rgba, 3, 0, 1)).toBe(255);
  });
});

describe('outlineOpaqueSilhouette', () => {
  const WOOD = [180, 140, 90, 255];
  const CLEAR = [0, 0, 0, 0];
  const pixel = (rgba: Uint8ClampedArray, width: number, x: number, y: number): number[] =>
    Array.from(rgba.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

  it('paints a black rim on the transparent side, growing by 4-connected distance', () => {
    const rgba = grid([
      [CLEAR, CLEAR, CLEAR, CLEAR, CLEAR],
      [CLEAR, CLEAR, CLEAR, CLEAR, CLEAR],
      [CLEAR, CLEAR, WOOD, CLEAR, CLEAR],
      [CLEAR, CLEAR, CLEAR, CLEAR, CLEAR],
      [CLEAR, CLEAR, CLEAR, CLEAR, CLEAR],
    ]);
    outlineOpaqueSilhouette(rgba, 5, 5, 1);
    expect(pixel(rgba, 5, 2, 2)).toEqual(WOOD);
    expect(pixel(rgba, 5, 1, 2)).toEqual([0, 0, 0, 255]);
    expect(pixel(rgba, 5, 2, 1)).toEqual([0, 0, 0, 255]);
    expect(pixel(rgba, 5, 1, 1)).toEqual(CLEAR);
    expect(pixel(rgba, 5, 0, 2)).toEqual(CLEAR);
  });

  it('grows the rim to the requested thickness', () => {
    const rgba = grid([
      [CLEAR, CLEAR, CLEAR, CLEAR, CLEAR],
      [CLEAR, CLEAR, CLEAR, CLEAR, CLEAR],
      [CLEAR, CLEAR, WOOD, CLEAR, CLEAR],
      [CLEAR, CLEAR, CLEAR, CLEAR, CLEAR],
      [CLEAR, CLEAR, CLEAR, CLEAR, CLEAR],
    ]);
    outlineOpaqueSilhouette(rgba, 5, 5, 2);
    expect(pixel(rgba, 5, 0, 2)).toEqual([0, 0, 0, 255]);
    expect(pixel(rgba, 5, 1, 1)).toEqual([0, 0, 0, 255]);
    expect(pixel(rgba, 5, 0, 0)).toEqual(CLEAR);
  });
});
