import { describe, expect, it } from 'vitest';
import {
  DIAMOND_FAN_INDICES,
  DIAMOND_INDICES,
  TILE_HALF_H,
  TILE_HALF_W,
  TRIANGLE_A_CORNERS,
  TRIANGLE_A_SPLIT_INDICES,
  TRIANGLE_B_CORNERS,
  TRIANGLE_B_SPLIT_INDICES,
  diamondCorners,
  patternSrcRect,
  rectCenterUV,
  rectUVs,
  triangleCorners,
  triangleUVs,
  uvMidpoint,
} from '../src/index.js';

/**
 * The PURE, self-verifiable half of textured terrain (docs/plans/Phase 2 step 4): the diamond
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

  it('subtracts the per-corner elevation lift from each corner y (x untouched), in corner order', () => {
    // lifts = [top, right, bottom, left] world px — raises each corner independently.
    expect(diamondCorners(100, 50, [4, 1, 3, 2])).toEqual([
      100,
      50 - TILE_HALF_H - 4, // top lifted by 4
      100 + TILE_HALF_W,
      50 - 1, // right lifted by 1
      100,
      50 + TILE_HALF_H - 3, // bottom lifted by 3
      100 - TILE_HALF_W,
      50 - 2, // left lifted by 2
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

describe('triangleCorners', () => {
  it('triangle A is the diamond LEFT half in UV-point order (top, bottom, left)', () => {
    expect(triangleCorners(100, 50, TRIANGLE_A_CORNERS)).toEqual([
      100,
      50 - TILE_HALF_H, // top   ↔ UV point 0 (the tile's TL)
      100,
      50 + TILE_HALF_H, // bottom ↔ UV point 1 (BR)
      100 - TILE_HALF_W,
      50, // left  ↔ UV point 2 (BL)
    ]);
  });

  it('triangle B is the diamond RIGHT half in UV-point order (top, right, bottom)', () => {
    expect(triangleCorners(100, 50, TRIANGLE_B_CORNERS)).toEqual([
      100,
      50 - TILE_HALF_H, // top   ↔ UV point 0 (TL)
      100 + TILE_HALF_W,
      50, // right ↔ UV point 1 (TR)
      100,
      50 + TILE_HALF_H, // bottom ↔ UV point 2 (BR)
    ]);
  });

  it('the two halves together cover exactly the diamond (share the top-bottom diagonal)', () => {
    const a = triangleCorners(0, 0, TRIANGLE_A_CORNERS);
    const b = triangleCorners(0, 0, TRIANGLE_B_CORNERS);
    // A ∪ B = the 4 diamond corners; A ∩ B = the top + bottom (the shared split diagonal).
    const points = (flat: readonly number[]): string[] => {
      const out: string[] = [];
      for (let i = 0; i < flat.length; i += 2) out.push(`${flat[i]},${flat[i + 1]}`);
      return out;
    };
    const union = new Set([...points(a), ...points(b)]);
    expect(union.size).toBe(4);
    const shared = points(a).filter((p) => points(b).includes(p));
    expect(shared).toEqual([`0,${-TILE_HALF_H}`, `0,${TILE_HALF_H}`]);
  });
});

describe('triangleUVs', () => {
  it('normalises a pattern triangle`s pixel coords over the page in point order', () => {
    // The canonical coordsA convention (TL, BR, BL of a 64px tile) on a 256×256 page.
    expect(triangleUVs([0, 0, 63, 63, 0, 63], 256, 256)).toEqual([0, 0, 63 / 256, 63 / 256, 0, 63 / 256]);
  });

  it('handles a block tile deeper in the page (the transition-tile case)', () => {
    // "block water shallow 00 03 02" coordsA: (192,128) (255,191) (192,191) on a 256×256 page.
    expect(triangleUVs([192, 128, 255, 191, 192, 191], 256, 256)).toEqual([
      0.75,
      0.5,
      255 / 256,
      191 / 256,
      0.75,
      191 / 256,
    ]);
  });
});

describe('centre-vertex split (the shaded ground path)', () => {
  it('the split triples reference each corner of their triangle plus the shared centre', () => {
    // A's vertex order is [top, bottom, left, centre]; B's [top, right, bottom, centre]. Both split
    // pairs must cover all 4 vertices and put the centre (index 3) in every sub-triangle.
    for (const idx of [TRIANGLE_A_SPLIT_INDICES, TRIANGLE_B_SPLIT_INDICES]) {
      expect(idx.length).toBe(6);
      expect(new Set(idx)).toEqual(new Set([0, 1, 2, 3]));
      expect(idx.slice(0, 3)).toContain(3);
      expect(idx.slice(3)).toContain(3);
    }
  });

  it('the diamond fan covers every corner once per adjacent pair, all through the centre (index 4)', () => {
    expect(DIAMOND_FAN_INDICES.length).toBe(12); // 4 triangles
    for (let t = 0; t < 4; t++) {
      const tri = DIAMOND_FAN_INDICES.slice(t * 3, t * 3 + 3);
      expect(tri).toContain(4); // every fan triangle meets the centre vertex
    }
    // Each outer edge (adjacent corner pair) appears exactly once: corners 0..3 each in two triangles.
    const cornerUses = [0, 1, 2, 3].map((c) => DIAMOND_FAN_INDICES.filter((i) => i === c).length);
    expect(cornerUses).toEqual([2, 2, 2, 2]);
  });

  it('uvMidpoint bisects the split edge in the pattern point order', () => {
    // coordsA convention (TL, BR, BL): the split edge is points (0, 1) — TL↔BR, the tile diagonal.
    const uvs = triangleUVs([0, 0, 63, 63, 0, 63], 256, 256);
    expect(uvMidpoint(uvs, 0, 1)).toEqual([31.5 / 256, 31.5 / 256]);
  });

  it('rectCenterUV is the sub-rect centre in normalised page UV', () => {
    expect(rectCenterUV({ x: 64, y: 128, w: 64, h: 64 }, 256, 256)).toEqual([96 / 256, 160 / 256]);
  });
});
