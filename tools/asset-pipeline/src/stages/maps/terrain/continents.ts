import { findChunk, unpackMapLayer } from '../../../decoders/mapdat/index.js';
import type { DecodedMap } from './lane.js';

/** Raw `lmco` continent id per node on the `2W x 2H` half-cell grid. */
export function continentsFromMapDat({ map, size }: DecodedMap): number[] | undefined {
  const chunk = findChunk(map, 'lmco');
  if (chunk === undefined) return undefined;
  const lane = unpackMapLayer(chunk).cells;
  const expected = size.width * size.height * 4;
  if (lane.length !== expected) {
    throw new Error(
      `mapdat: lmco continent lane has ${lane.length} half-cells, expected ${expected} (${size.width}×${size.height} × 4)`,
    );
  }
  return [...lane];
}
