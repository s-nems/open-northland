export * from './cross-references.js';
export * from './footprint.js';
export * from './lookup.js';
export * from './schema/index.js';

import { validateCrossReferences } from './cross-references.js';
import { ContentSet, TerrainMapFile } from './schema/index.js';

/**
 * Parse + validate a content set (typically the contents of content/ assembled into one object).
 * Throws a zod error with a readable path if anything is malformed.
 */
export function parseContentSet(raw: unknown): ContentSet {
  const set = ContentSet.parse(raw);
  validateCrossReferences(set);
  return set;
}

/**
 * Parse + validate one decoded terrain grid file (`content/maps/<id>.json`) into the structural
 * `TerrainMap` the sim consumes. This is the loader boundary: the build tool / app reads the JSON
 * (I/O — not allowed in the pure sim) and validates the shape + the `typeIds.length === width*height`
 * invariant here, so a malformed file fails loudly at load rather than as an out-of-bounds read in
 * `buildTerrainGraph`. Throws a zod error with a readable path on a malformed file.
 */
export function parseTerrainMap(raw: unknown): TerrainMapFile {
  return TerrainMapFile.parse(raw);
}
