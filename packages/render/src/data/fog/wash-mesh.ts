import { rowStagger, TILE_HALF_H, TILE_HALF_W, type TileRange } from '../projection/index.js';
import { type ElevationField, terrainLiftAt } from '../terrain/index.js';

/** The fog wash's lifted vertex grid over one band of the one-texel-per-cell fog texture. */
export interface FogWashGeometry {
  /** World px, `[x0, y0, x1, y1, …]`. */
  readonly positions: Float32Array;
  /** Normalized to the whole texture, `[u0, v0, …]`. */
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

/**
 * One vertex per texel centre, cell (c, r) at `(2c·TILE_HALF_W, r·TILE_HALF_H)` raised by the terrain's
 * lift under that point, so the wash rides the hills it darkens: drawn flat, a lifted hill showed the
 * ground of cells rows further south through the wash of cells nearer the viewer, while its objects
 * stayed culled by their own cell. The outer ring sits half a texel beyond the band and repeats the edge
 * texel, covering the same box a flat quad did without sampling past the band.
 *
 * The x lattice ignores the odd-row half-cell stagger (a named approximation, invisible under a
 * cell-wide gradient), so the lift is read where the terrain row actually passes that x.
 */
export function fogWashGeometry(
  band: TileRange,
  texW: number,
  texH: number,
  elevation: ElevationField | undefined,
): FogWashGeometry {
  const bandW = band.maxCol - band.minCol + 1;
  const bandH = band.maxRow - band.minRow + 1;
  const cols = bandW + 2;
  const rows = bandH + 2;
  const positions = new Float32Array(cols * rows * 2);
  const uvs = new Float32Array(cols * rows * 2);
  for (let j = 0; j < rows; j++) {
    const texelY = Math.min(Math.max(j - 1, 0), bandH - 1);
    const row = band.minRow + Math.min(Math.max(j - 1, -0.5), bandH - 0.5);
    const terrainColShift = rowStagger(row) / 2;
    for (let i = 0; i < cols; i++) {
      const texelX = Math.min(Math.max(i - 1, 0), bandW - 1);
      const col = band.minCol + Math.min(Math.max(i - 1, -0.5), bandW - 0.5);
      const v = (j * cols + i) * 2;
      positions[v] = 2 * TILE_HALF_W * col;
      positions[v + 1] = TILE_HALF_H * row - terrainLiftAt(elevation, col - terrainColShift, row);
      uvs[v] = (texelX + 0.5) / texW;
      uvs[v + 1] = (texelY + 0.5) / texH;
    }
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  }
  return { positions, uvs, indices };
}

/** Rows the band must reach past the screen's bottom edge: lifted ground from that far south can rise
 *  into view, and its wash must rise with it. */
export function fogWashLiftRows(elevation: ElevationField | undefined): number {
  return elevation === undefined ? 0 : Math.ceil(elevation.maxLift / TILE_HALF_H);
}
