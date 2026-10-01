import { TILE_HALF_H, TILE_HALF_W } from '../projection/iso.js';
import {
  FIELD_COVER,
  FIELD_FOREST,
  FIELD_LAND_B,
  FIELD_LAND_R,
  FIELD_ORE,
  FIELD_ORE_R,
  FIELD_STRIDE,
  FIELD_WATER,
  FIELD_WATER_B,
  FIELD_WATER_R,
} from './minimap-cells.js';

/** A sample holds the cell field's lanes at their `FIELD_*` indices. */
export const SAMPLE_LANES = FIELD_STRIDE;

/**
 * Sample the cell field at world px `(x, y)` into `out`: barycentric over the triangle between the three
 * cell centres around the point, the same tessellation the ground mesh draws, so the picture has no
 * row-wise smear. Land and ore lanes are weighted by each cell's squared raw land share and water
 * colours by its squared water share, so only the smoothed coverage decides which side shows; a side
 * with no weight reads as zeros, which the coverage then hides.
 */
export function sampleField(
  field: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  out: Float64Array,
): void {
  const fr = y / TILE_HALF_H;
  const r0 = Math.floor(fr);
  const t = fr - r0;
  const parity = r0 & 1;
  // Half-cell units along the row, with row r0's centres on the even values and row r0+1's on the odd.
  const a = x / TILE_HALF_W - parity;
  const k = Math.floor(a / 2 + 0.5);
  const top = clampIndex(r0, height) * width;
  const bottom = clampIndex(r0 + 1, height) * width;
  const d = a - 2 * k;
  let o0: number;
  let o1: number;
  let o2: number;
  let k0: number;
  let k1: number;
  let k2: number;
  if (Math.abs(d) <= t) {
    // △ from row r0's centre 2k down to row r0+1's centres 2k±1.
    o0 = cellOffset(top, k, width);
    o1 = cellOffset(bottom, k - 1 + parity, width);
    o2 = cellOffset(bottom, k + parity, width);
    k0 = 1 - t;
    k1 = (t - d) / 2;
    k2 = (t + d) / 2;
  } else {
    // ▽ from two row-r0 centres down to the row-r0+1 centre between them.
    const left = d > 0 ? k : k - 1;
    const e = a - 2 * left;
    o0 = cellOffset(top, left, width);
    o1 = cellOffset(top, left + 1, width);
    o2 = cellOffset(bottom, left + parity, width);
    k0 = (2 - t - e) / 2;
    k1 = (e - t) / 2;
    k2 = t;
  }
  const w0 = field[o0 + FIELD_WATER] ?? 0;
  const w1 = field[o1 + FIELD_WATER] ?? 0;
  const w2 = field[o2 + FIELD_WATER] ?? 0;
  let l0 = k0 * (1 - w0) * (1 - w0);
  let l1 = k1 * (1 - w1) * (1 - w1);
  let l2 = k2 * (1 - w2) * (1 - w2);
  const landW = l0 + l1 + l2;
  const landNorm = landW > 0 ? 1 / landW : 0;
  l0 *= landNorm;
  l1 *= landNorm;
  l2 *= landNorm;
  let v0 = k0 * w0 * w0;
  let v1 = k1 * w1 * w1;
  let v2 = k2 * w2 * w2;
  const waterW = v0 + v1 + v2;
  const waterNorm = waterW > 0 ? 1 / waterW : 0;
  v0 *= waterNorm;
  v1 *= waterNorm;
  v2 *= waterNorm;
  out[FIELD_COVER] = blend(field, o0, o1, o2, FIELD_COVER, k0, k1, k2);
  out[FIELD_FOREST] = blend(field, o0, o1, o2, FIELD_FOREST, k0, k1, k2);
  for (let lane = FIELD_LAND_R; lane <= FIELD_LAND_B; lane++)
    out[lane] = blend(field, o0, o1, o2, lane, l0, l1, l2);
  for (let lane = FIELD_ORE_R; lane <= FIELD_ORE; lane++)
    out[lane] = blend(field, o0, o1, o2, lane, l0, l1, l2);
  for (let lane = FIELD_WATER_R; lane <= FIELD_WATER_B; lane++)
    out[lane] = blend(field, o0, o1, o2, lane, v0, v1, v2);
}

function blend(
  field: Float32Array,
  o0: number,
  o1: number,
  o2: number,
  lane: number,
  k0: number,
  k1: number,
  k2: number,
): number {
  return k0 * (field[o0 + lane] ?? 0) + k1 * (field[o1 + lane] ?? 0) + k2 * (field[o2 + lane] ?? 0);
}

function cellOffset(rowStart: number, col: number, width: number): number {
  return (rowStart + clampIndex(col, width)) * FIELD_STRIDE;
}

function clampIndex(i: number, size: number): number {
  return i < 0 ? 0 : i >= size ? size - 1 : i;
}
