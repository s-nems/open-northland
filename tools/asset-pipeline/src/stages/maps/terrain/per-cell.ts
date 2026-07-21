import { findChunk, unpackMapLayer } from '../../../decoders/mapdat/index.js';
import type { DecodedMap } from './lane.js';

/**
 * The shared per-cell byte-lane decode: unpack the tagged chunk and carry it verbatim, enforcing the
 * one structural invariant these lanes share — one byte per cell (row-major, unpacked length ===
 * width·height, not the `2W × 2H` half-cell resolution the landscape-object lanes use). Returns
 * undefined when the map lacks the chunk (older/foreign saves); throws on a dims/length mismatch.
 */
function perCellLaneFromMapDat({ map, size }: DecodedMap, tag: string, label: string): number[] | undefined {
  const chunk = findChunk(map, tag);
  if (chunk === undefined) return undefined;
  const cells = unpackMapLayer(chunk).cells;
  const expected = size.width * size.height;
  if (cells.length !== expected) {
    throw new Error(
      `mapdat: ${tag} ${label} lane has ${cells.length} cells, expected ${expected} (${size.width}×${size.height}, per-cell)`,
    );
  }
  return Array.from(cells);
}

/**
 * The raw per-cell terrain height (`lmhe`), values 0..250, an observed ceiling across the corpus.
 * Consumed by the render's `TILE_HALF_H/32` elevation lift (`packages/render/src/data/elevation.ts`).
 */
export function elevationFromMapDat(decoded: DecodedMap): number[] | undefined {
  return perCellLaneFromMapDat(decoded, 'lmhe', 'height');
}

/**
 * The baked per-cell shading plane (`embr`). 127 is neutral (flat lit ground); lower values are baked
 * slope shadow, higher baked slope light (up to 255 ≈ 2×), and the map's outermost 2–3 rows/columns
 * hold 0 — the engine's fade-to-black border is in the lane. The render-side response curve
 * (luminance × brightness/127, calibrated against the corpus) lives in
 * `packages/render/src/data/brightness.ts`.
 */
export function brightnessFromMapDat(decoded: DecodedMap): number[] | undefined {
  return perCellLaneFromMapDat(decoded, 'embr', 'brightness');
}
