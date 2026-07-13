import { encodeMapDat, encodeMapSize, packMapLayer } from '../../src/decoders/mapdat/index.js';

/**
 * Builds a synthetic `map.dat`: an `lsiz` dims chunk + an `lmlt` landscape-object layer (a row-major
 * `2W × 2H` half-cell grid, RLE-packed via the faithful `packMapLayer`). `halfCells` is the raw lane
 * (4 values per cell as a 2×2 block spanning two lane rows). No copyrighted bytes — the encoder
 * round-trips the decoder under test.
 */
export function buildMapDat(width: number, height: number, halfCells: number[]): Uint8Array {
  return encodeMapDat([
    { tag: 'lsiz', version: 1, payload: encodeMapSize({ width, height }) },
    { tag: 'lmlt', version: 1, payload: packMapLayer(Uint8Array.from(halfCells)) },
  ]);
}
