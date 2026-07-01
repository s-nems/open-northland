import { describe, expect, it } from 'vitest';
import type { Camera } from '../src/index.js';
import { cameraViewport, isVisible, tileToScreen, visibleTileRange } from '../src/index.js';

/**
 * Unit tests for the pure viewport-culling math — the "what's on screen" half of scaling to big maps,
 * self-verifiable without a GPU. They pin the two load-bearing properties: `cameraViewport` inverts the
 * camera transform exactly (a world corner maps back to the canvas corner), and `visibleTileRange`
 * bounds the iso diamond correctly and clamps to the grid (so an off-map pan draws nothing out of range).
 */

describe('cameraViewport', () => {
  it('inverts screen = world*scale + offset over the canvas rect', () => {
    const camera: Camera = { offsetX: 100, offsetY: 50, scale: 2 };
    const vp = cameraViewport(camera, 960, 540);
    expect(vp).toEqual({ minX: -50, maxX: 430, minY: -25, maxY: 245 });
    // Round-trip: the world edges map back to the canvas edges (0..W, 0..H).
    expect(vp.minX * 2 + camera.offsetX).toBe(0);
    expect(vp.maxX * 2 + camera.offsetX).toBe(960);
    expect(vp.minY * 2 + camera.offsetY).toBe(0);
    expect(vp.maxY * 2 + camera.offsetY).toBe(540);
  });

  it('defaults scale to 1 when the camera omits it', () => {
    expect(cameraViewport({ offsetX: 0, offsetY: 0 }, 100, 100)).toEqual({
      minX: 0,
      maxX: 100,
      minY: 0,
      maxY: 100,
    });
  });

  it('grows the world rect by the margin on every side', () => {
    expect(cameraViewport({ offsetX: 0, offsetY: 0, scale: 1 }, 100, 100, 10)).toEqual({
      minX: -10,
      maxX: 110,
      minY: -10,
      maxY: 110,
    });
  });
});

describe('isVisible', () => {
  const vp = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  it('is true inside the rect, false outside', () => {
    expect(isVisible(vp, 50, 50)).toBe(true);
    expect(isVisible(vp, -1, 50)).toBe(false);
    expect(isVisible(vp, 105, 50)).toBe(false);
  });

  it('admits a point within `margin` of the edge (the tall-sprite slack)', () => {
    expect(isVisible(vp, -1, 50, 5)).toBe(true);
    expect(isVisible(vp, 105, 50, 10)).toBe(true);
    expect(isVisible(vp, -20, 50, 5)).toBe(false);
  });
});

describe('visibleTileRange', () => {
  it('bounds the iso diamond for an origin-centred viewport and clamps negatives to 0', () => {
    // A ±64×±32 world box around the origin — the diamond spanning tiles (0,0)..(2,2).
    const vp = { minX: -64, maxX: 64, minY: -32, maxY: 32 };
    expect(visibleTileRange(vp, 10, 10)).toEqual({ minCol: 0, maxCol: 2, minRow: 0, maxRow: 2 });
    // The tile the box is centred on projects inside it (sanity on the projection direction).
    expect(tileToScreen(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('pads the band by tileMargin (and re-clamps to the grid)', () => {
    const vp = { minX: -64, maxX: 64, minY: -32, maxY: 32 };
    expect(visibleTileRange(vp, 10, 10, 1)).toEqual({ minCol: 0, maxCol: 3, minRow: 0, maxRow: 3 });
  });

  it('shifts the band as the viewport pans, staying within the grid', () => {
    // Pan the same-size box to world (128±.., 64±..) — the diamond centre moves to tile (col+row) higher.
    const vp = { minX: 64, maxX: 192, minY: 32, maxY: 96 };
    const range = visibleTileRange(vp, 20, 20);
    expect(range.minCol).toBeGreaterThan(0);
    expect(range.minRow).toBeGreaterThanOrEqual(0);
    expect(range.maxCol).toBeLessThanOrEqual(19);
  });

  it('clamps a fully off-map viewport to the grid edge (nothing out of range)', () => {
    const vp = { minX: 100000, maxX: 100100, minY: 100000, maxY: 100100 };
    expect(visibleTileRange(vp, 10, 10)).toEqual({ minCol: 9, maxCol: 9, minRow: 9, maxRow: 9 });
  });
});
