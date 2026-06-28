import { describe, expect, it } from 'vitest';
import {
  DIAMOND_INDICES,
  TILE_HALF_H,
  TILE_HALF_W,
  diamondCorners,
  patternSrcRect,
  rectUVs,
} from '../src/index.js';

/**
 * The PURE, self-verifiable half of textured terrain (docs/ROADMAP.md Phase 2 step 4): the diamond
 * vertex/UV geometry the GPU mesh build consumes. Pixels stay human-gated (the shot), but the
 * vertex/UV math is unit-tested here so a regression in the projection / UV mapping is caught headless.
 */
describe('patternSrcRect', () => {
  it('returns the bounding box (in texture pixels) of the two UV triangles', () => {
    // A representative full-tile pattern: coordsA + coordsB span the 64×64 top-left tile of the page.
    const rect = patternSrcRect([0, 0, 63, 63, 0, 63], [0, 0, 63, 0, 63, 63]);
    expect(rect).toEqual({ x: 0, y: 0, w: 63, h: 63 });
  });

  it('handles a tile offset within the page (a lower sub-rect)', () => {
    // "sand 01" sat at y=128 in its page (coords [0,128,63,191,0,191] / [0,128,63,128,63,191]).
    const rect = patternSrcRect([0, 128, 63, 191, 0, 191], [0, 128, 63, 128, 63, 191]);
    expect(rect).toEqual({ x: 0, y: 128, w: 63, h: 63 });
  });
});

describe('diamondCorners', () => {
  it('places the 4 corners at center ± the tile half-extents, in top/right/bottom/left order', () => {
    expect(diamondCorners(100, 50)).toEqual([
      100,
      50 - TILE_HALF_H, // top
      100 + TILE_HALF_W,
      50, // right
      100,
      50 + TILE_HALF_H, // bottom
      100 - TILE_HALF_W,
      50, // left
    ]);
  });
});

describe('rectUVs', () => {
  it('normalises the sub-rect corners to 0..1 over the page, matching the corner order', () => {
    // A 64×64 tile at the page origin on a 256×256 page → top-left quarter-ish.
    expect(rectUVs({ x: 0, y: 0, w: 64, h: 64 }, 256, 256)).toEqual([
      0,
      0, // top ↔ TL
      0.25,
      0, // right ↔ TR
      0.25,
      0.25, // bottom ↔ BR
      0,
      0.25, // left ↔ BL
    ]);
  });

  it('offsets u/v for a sub-rect lower in the page', () => {
    expect(rectUVs({ x: 0, y: 128, w: 64, h: 64 }, 256, 256)).toEqual([
      0, 0.5, 0.25, 0.5, 0.25, 0.75, 0, 0.75,
    ]);
  });
});

describe('DIAMOND_INDICES', () => {
  it('triangulates the 4-corner diamond as (top,right,bottom)+(top,bottom,left)', () => {
    expect(DIAMOND_INDICES).toEqual([0, 1, 2, 0, 2, 3]);
  });
});
