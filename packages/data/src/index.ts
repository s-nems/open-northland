export * from './fnv.js';
export * from './footprint.js';
export * from './job-atomics.js';
export * from './lookup.js';
export * from './schema/index.js';
export * from './terrain-fingerprint.js';

import { validateCrossReferences } from './cross-references.js';
import { ContentSet, TerrainMapFile } from './schema/index.js';

/** Parse and validate one assembled content set; throws a zod error with a readable path. */
export function parseContentSet(raw: unknown): ContentSet {
  const set = ContentSet.parse(raw);
  validateCrossReferences(set);
  return set;
}

/**
 * Parse and validate one decoded terrain grid file (`content/maps/<id>.json`). The loader boundary:
 * the `typeIds.length === width * height` invariant is checked here, outside the pure sim, so a
 * malformed file fails at load rather than as an out-of-bounds read in `buildTerrainGraph`.
 */
export function parseTerrainMap(raw: unknown): TerrainMapFile {
  return TerrainMapFile.parse(raw);
}
