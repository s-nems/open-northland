import { findChunk, unpackMapLayer } from '../../../decoders/mapdat/index.js';
import type { DecodedMap } from './lane.js';

/**
 * The `lmpr` walking-roughness lane, one byte per node on the `2W x 2H` half-cell grid: the value the
 * engine packs into each node's word and reads back as `(word >> 3) & 0xf` when a human steps off the
 * node. Every owned map carries it with values 0..5, and every `lmro` road node
 * holds 1, so an authored road is already the fast lane in the data. Undefined when the map lacks the
 * lane (a synthetic fixture; the sim then walks every node at its land default); throws on a length
 * mismatch.
 */
export function roughnessFromMapDat({ map, size }: DecodedMap): number[] | undefined {
  const chunk = findChunk(map, 'lmpr');
  if (chunk === undefined) return undefined;
  const lane = unpackMapLayer(chunk).cells;
  const expected = size.width * size.height * 4;
  if (lane.length !== expected) {
    throw new Error(
      `mapdat: lmpr roughness lane has ${lane.length} half-cells, expected ${expected} (${size.width}×${size.height} × 4)`,
    );
  }
  return [...lane];
}
