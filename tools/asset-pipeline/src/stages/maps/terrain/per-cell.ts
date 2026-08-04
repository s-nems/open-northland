import { findChunk, unpackMapLayer } from '../../../decoders/mapdat/index.js';
import type { DecodedMap } from './lane.js';

/**
 * The shared per-cell byte-lane decode, carried verbatim: one byte per cell, row-major, not the
 * `2W x 2H` half-cell resolution the landscape-object lanes use. Returns undefined when the map lacks
 * the chunk; throws on a dims/length mismatch.
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

/** The raw per-cell terrain height lane (`lmhe`), values 0..250 observed across the corpus. */
export function elevationFromMapDat(decoded: DecodedMap): number[] | undefined {
  return perCellLaneFromMapDat(decoded, 'lmhe', 'height');
}

/** The baked per-cell shading plane (`embr`), 127 neutral, the fade-to-black map border included. */
export function brightnessFromMapDat(decoded: DecodedMap): number[] | undefined {
  return perCellLaneFromMapDat(decoded, 'embr', 'brightness');
}
