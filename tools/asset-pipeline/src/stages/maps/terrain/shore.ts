import { findChunk, unpackMapLayer } from '../../../decoders/mapdat/index.js';
import type { DecodedMap } from './lane.js';

/**
 * Decodes the `lmms` lane: the max moveable-unit size per half-cell node, a distance transform from
 * blocked nodes capped at 7 (meaning per the CulturesNation dat-format documentation; the 0..7 value
 * range is verified across the owned corpus, see `docs/formats/MAPDAT.md`). HALF-CELL resolution
 * (2W x 2H, like `emla`), collapsed to one value per cell by sampling each cell's CENTRE node
 * (`(2x + (y&1), 2y)`, the vertex the ground mesh bakes for the cell) - a named approximation that
 * halves the lane's resolution. Exported as the `shore` lane: no renderer consumes it yet, and as a
 * distance-from-obstruction field it still fits the shore-foam use the name anticipates. Returns
 * undefined when the map lacks the lane; throws on a length mismatch.
 */
export function shoreFromMapDat({ map, size }: DecodedMap): number[] | undefined {
  const chunk = findChunk(map, 'lmms');
  if (chunk === undefined) return undefined;
  const lane = unpackMapLayer(chunk).cells;
  const hw = size.width * 2;
  const expected = hw * size.height * 2;
  if (lane.length !== expected) {
    throw new Error(
      `mapdat: lmms shore lane has ${lane.length} half-cells, expected ${expected} (${size.width}×${size.height} × 4)`,
    );
  }
  const out = new Array<number>(size.width * size.height);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      out[y * size.width + x] = lane[2 * y * hw + 2 * x + (y & 1)] as number;
    }
  }
  return out;
}
