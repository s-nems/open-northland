import { describe, expect, it } from 'vitest';
// `isVisible` is render-internal (not on the public barrel); the unit test reaches its module directly.
import { isVisible } from '../src/data/viewport.js';
import type { Camera } from '../src/index.js';
import {
  aabbIntersects,
  cameraViewport,
  TILE_HALF_H,
  TILE_HALF_W,
  tileToScreen,
  visibleTileRange,
} from '../src/index.js';

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

describe('aabbIntersects', () => {
  const vp = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  it('is true for a box overlapping the viewport, false for one clear of it', () => {
    expect(aabbIntersects(vp, { minX: 50, minY: 50, maxX: 150, maxY: 150 })).toBe(true);
    expect(aabbIntersects(vp, { minX: 200, minY: 0, maxX: 300, maxY: 100 })).toBe(false); // off to the right
    expect(aabbIntersects(vp, { minX: 0, minY: -300, maxX: 100, maxY: -200 })).toBe(false); // above
  });

  it('counts a touching edge as visible (inclusive bounds, matching the old inline cull)', () => {
    expect(aabbIntersects(vp, { minX: 100, minY: 0, maxX: 200, maxY: 100 })).toBe(true); // shares the right edge
    expect(aabbIntersects(vp, { minX: 101, minY: 0, maxX: 200, maxY: 100 })).toBe(false); // one px clear
  });

  it('is true when the box strictly contains the viewport', () => {
    expect(aabbIntersects(vp, { minX: -50, minY: -50, maxX: 150, maxY: 150 })).toBe(true);
  });
});

describe('visibleTileRange', () => {
  // The world box is expressed in pitch multiples (cell width = 2·TILE_HALF_W, row step =
  // TILE_HALF_H), so the covered band is invariant to the calibrated pitch values: a box spanning
  // ±1 cell width and ±1 row step around the origin.
  const smallBox = {
    minX: -2 * TILE_HALF_W,
    maxX: 2 * TILE_HALF_W,
    minY: -TILE_HALF_H,
    maxY: TILE_HALF_H,
  };

  it('bounds the staggered band for an origin-centred viewport and clamps negatives to 0', () => {
    // Cols: centres at 2c·halfW (even rows) reach ±halfW → cols −2..2 touch the box → clamp to 0..2.
    // Rows: centres at r·halfH reach ±halfH (interlock) → rows −2..2 → clamp to 0..2.
    expect(visibleTileRange(smallBox, 10, 10)).toEqual({ minCol: 0, maxCol: 2, minRow: 0, maxRow: 2 });
    // The tile the box is centred on projects inside it (sanity on the projection direction).
    expect(tileToScreen(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('pads the band by tileMargin (and re-clamps to the grid)', () => {
    expect(visibleTileRange(smallBox, 10, 10, 1)).toEqual({ minCol: 0, maxCol: 3, minRow: 0, maxRow: 3 });
  });

  it('shifts the band as the viewport pans, staying within the grid', () => {
    // Pan the box deep into the grid — the band must move off the origin and stay clamped.
    const vp = {
      minX: 10 * 2 * TILE_HALF_W,
      maxX: 14 * 2 * TILE_HALF_W,
      minY: 8 * TILE_HALF_H,
      maxY: 12 * TILE_HALF_H,
    };
    const range = visibleTileRange(vp, 20, 20);
    expect(range.minCol).toBeGreaterThan(0);
    expect(range.minRow).toBeGreaterThan(0);
    expect(range.maxCol).toBeLessThanOrEqual(19);
    expect(range.maxRow).toBeLessThanOrEqual(19);
  });

  it('clamps a fully off-map viewport to the grid edge (nothing out of range)', () => {
    // y is far below the last row, so the row band clamps to the bottom edge; x spans cols 0..2
    // (100px ≈ 1.5 cell widths + the diamond/stagger slack), well inside the 10-wide grid.
    const vp = { minX: 0, maxX: 100, minY: 100000, maxY: 100100 };
    expect(visibleTileRange(vp, 10, 10)).toEqual({ minCol: 0, maxCol: 2, minRow: 9, maxRow: 9 });
  });
});
