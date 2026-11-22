import type { Viewport } from '../../data/projection/index.js';

const VERTICES_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;

/** A batcher that tells where the quads it packed stand. */
export interface QuadReaching {
  /**
   * Whether a quad it holds reaches `view` grown by `pad`, read off the packed corners: what moved
   * since they were packed is not seen. Undefined when it holds other geometry than quads.
   */
  quadsReach(view: Viewport, pad: number): boolean | undefined;
}

export function tellsQuadReach(batcher: unknown): batcher is QuadReaching {
  return (
    typeof batcher === 'object' &&
    batcher !== null &&
    typeof (batcher as Partial<QuadReaching>).quadsReach === 'function'
  );
}

/**
 * Whether the quad whose first corner starts at float `at` of `f32` reaches `view` grown by `pad`; a
 * position leads each vertex of `vertexFloats` floats. It misses when all four corners lie past one
 * edge: across first, where a view narrower than the screen parts most quads from it.
 */
function quadReaches(
  f32: Float32Array,
  vertexFloats: number,
  at: number,
  view: Viewport,
  pad: number,
): boolean {
  const second = at + vertexFloats;
  const third = second + vertexFloats;
  const fourth = third + vertexFloats;
  const x0 = f32[at] ?? 0;
  const x1 = f32[second] ?? 0;
  const x2 = f32[third] ?? 0;
  const x3 = f32[fourth] ?? 0;
  const left = view.minX - pad;
  if (x0 < left && x1 < left && x2 < left && x3 < left) return false;
  const right = view.maxX + pad;
  if (x0 > right && x1 > right && x2 > right && x3 > right) return false;
  const y0 = f32[at + 1] ?? 0;
  const y1 = f32[second + 1] ?? 0;
  const y2 = f32[third + 1] ?? 0;
  const y3 = f32[fourth + 1] ?? 0;
  const top = view.minY - pad;
  if (y0 < top && y1 < top && y2 < top && y3 < top) return false;
  const bottom = view.maxY + pad;
  return !(y0 > bottom && y1 > bottom && y2 > bottom && y3 > bottom);
}

/** Whether any of the quads packed back to back in the first `floats` of `f32` reaches the view. */
export function packedQuadsReach(
  f32: Float32Array,
  vertexFloats: number,
  floats: number,
  view: Viewport,
  pad: number,
): boolean {
  const quadFloats = VERTICES_PER_QUAD * vertexFloats;
  for (let at = 0; at + quadFloats <= floats; at += quadFloats) {
    if (quadReaches(f32, vertexFloats, at, view, pad)) return true;
  }
  return false;
}

/** Whether any quad the first `indexCount` of `indices` draw reaches the view: six indices a quad, the
 *  first naming its first corner's vertex. */
export function indexedQuadsReach(
  f32: Float32Array,
  vertexFloats: number,
  indices: Uint32Array,
  indexCount: number,
  view: Viewport,
  pad: number,
): boolean {
  for (let i = 0; i + INDICES_PER_QUAD <= indexCount; i += INDICES_PER_QUAD) {
    if (quadReaches(f32, vertexFloats, (indices[i] ?? 0) * vertexFloats, view, pad)) return true;
  }
  return false;
}
