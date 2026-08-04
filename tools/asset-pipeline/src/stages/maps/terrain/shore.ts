import { findChunk, unpackMapLayer } from '../../../decoders/mapdat/index.js';
import type { DecodedMap } from './lane.js';

/**
 * Decodes the `lmms` max moveable-unit-size lane, stored at `2W x 2H` half-cell resolution, to one
 * value per cell by sampling each cell's centre node `(2x + (y & 1), 2y)`: a named approximation that
 * halves the lane's resolution. Emitted as the `shore` lane, which no renderer consumes yet. Returns
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
