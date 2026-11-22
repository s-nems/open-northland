import { describe, expect, it } from 'vitest';
import type { Viewport } from '../../../src/data/projection/index.js';
import { indexedQuadsReach, packedQuadsReach } from '../../../src/gpu/world-batch/quad-reach.js';

const VIEW: Viewport = { minX: 100, minY: 100, maxX: 200, maxY: 200 };
/** Floats a test vertex holds: its position and one more, so a stride mistake reads the wrong float. */
const VERTEX_FLOATS = 3;
const QUAD_FLOATS = 4 * VERTEX_FLOATS;
const FILLER = 150;

type Corner = readonly [number, number];
/** An axis-aligned quad's corners. */
function box(minX: number, minY: number, maxX: number, maxY: number): Corner[] {
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

/** Quads packed back to back, a filler float after each position that lies inside the view. */
function pack(...quads: Corner[][]): Float32Array {
  return new Float32Array(quads.flatMap((quad) => quad.flatMap(([x, y]) => [x, y, FILLER])));
}

const reaches = (...quads: Corner[][]): boolean =>
  packedQuadsReach(pack(...quads), VERTEX_FLOATS, quads.length * QUAD_FLOATS, VIEW, 0);

describe('packedQuadsReach', () => {
  it('finds a quad overlapping the view over any edge, and none among quads past one', () => {
    expect(
      reaches(box(0, 0, 99, 300), box(201, 0, 300, 300), box(0, 0, 300, 99), box(0, 201, 300, 300)),
    ).toBe(false);
    expect(reaches(box(0, 120, 100, 130))).toBe(true);
    expect(reaches(box(200, 120, 300, 130))).toBe(true);
    expect(reaches(box(120, 0, 130, 100))).toBe(true);
    expect(reaches(box(120, 200, 130, 300))).toBe(true);
  });

  it('counts a quad that covers the view with every corner outside it', () => {
    expect(reaches(box(0, 0, 300, 300))).toBe(true);
    // A sheared quad's corners straddle the view across and down.
    expect(
      reaches([
        [50, 250],
        [150, 250],
        [250, 50],
        [150, 50],
      ]),
    ).toBe(true);
  });

  it('grows the view by the pad', () => {
    const near = pack(box(0, 120, 98, 130));
    expect(packedQuadsReach(near, VERTEX_FLOATS, QUAD_FLOATS, VIEW, 1)).toBe(false);
    expect(packedQuadsReach(near, VERTEX_FLOATS, QUAD_FLOATS, VIEW, 2)).toBe(true);
  });

  it('reads only the floats in use', () => {
    const packed = pack(box(0, 0, 50, 50), box(120, 120, 130, 130));
    expect(packedQuadsReach(packed, VERTEX_FLOATS, QUAD_FLOATS, VIEW, 0)).toBe(false);
    expect(packedQuadsReach(packed, VERTEX_FLOATS, 2 * QUAD_FLOATS, VIEW, 0)).toBe(true);
  });
});

describe('indexedQuadsReach', () => {
  /** Six indices over the quad in slot `slot`, as the still mesh writes them. */
  const quadIndices = (slot: number): number[] => {
    const first = slot * 4;
    return [first, first + 1, first + 2, first, first + 2, first + 3];
  };

  it('reads the quads the indices name, wherever their slots lie', () => {
    const store = pack(box(120, 120, 130, 130), box(0, 0, 50, 50), box(0, 0, 60, 60));
    const missing = new Uint32Array([...quadIndices(2), ...quadIndices(1)]);
    expect(indexedQuadsReach(store, VERTEX_FLOATS, missing, missing.length, VIEW, 0)).toBe(false);
    const reaching = new Uint32Array([...quadIndices(1), ...quadIndices(0)]);
    expect(indexedQuadsReach(store, VERTEX_FLOATS, reaching, reaching.length, VIEW, 0)).toBe(true);
    // Indices past the count belong to an earlier, longer build.
    expect(indexedQuadsReach(store, VERTEX_FLOATS, reaching, 6, VIEW, 0)).toBe(false);
  });
});
