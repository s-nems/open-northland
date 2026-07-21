import { findChunk, unpackMapLayer } from '../../../decoders/mapdat/index.js';
import type { DecodedMap } from './lane.js';

/**
 * Decodes the `lmms` lane. Unlike `lmhe`/`embr` the lane is HALF-CELL resolution (2W × 2H, like
 * `emla` — verified by unpacked length; observed byte values 0..7 across the owned corpus). The band
 * SEMANTICS are unconfirmed — it is NOT a water mask (waterless maps carry the same 1..7 bands, and
 * band 7 sits mostly under land patterns on river maps; probed 2026-07-16), so no renderer consumes it
 * yet — it is carried for the shore-foam follow-up (`docs/tickets/features/water-fx-and-shore.md`).
 * Collapsed to one value per cell by sampling each cell's CENTRE node (`(2x + (y&1), 2y)` — the vertex
 * the ground mesh bakes for the cell), matching the per-cell resolution of the other render lanes (a
 * named approximation that halves the lane's resolution). Returns undefined when the map lacks the
 * lane; throws on a length mismatch.
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
