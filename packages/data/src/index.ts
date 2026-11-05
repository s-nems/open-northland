export * from './bob-atlases.js';
export * from './building-tribe.js';
export * from './cadaver.js';
export * from './catalog/animal-locomotion.js';
export * from './catalog/carried-load-band.js';
export * from './catalog/learned-good-includes.js';
export * from './catalog/legacy-house-names.js';
export * from './fingerprint/content.js';
export * from './fingerprint/fnv.js';
export * from './fingerprint/json.js';
export * from './fingerprint/terrain.js';
export * from './footprint.js';
export * from './ground-lattice.js';
export * from './harvest-objects.js';
export * from './job-atomics.js';
export * from './languages.js';
export * from './lookup.js';
export * from './map-lobby.js';
export * from './map-variants/index.js';
export * from './missions/index.js';
export { PERSONAL_NAMES } from './names/index.js';
export * from './schema/catalog/browse.js';
export * from './schema/catalog/conversion.js';
export * from './schema/catalog/entry.js';
export * from './schema/catalog/id.js';
export * from './schema/index.js';
export * from './schema/report/report.js';
export * from './technology.js';

import { validateCrossReferences } from './cross-references/validate.js';
import { ContentSet, IR_VERSION, TerrainMapFile } from './schema/index.js';

/** Parse and validate one assembled content set; throws a zod error with a readable path. */
export function parseContentSet(raw: unknown): ContentSet {
  const set = ContentSet.parse(raw);
  validateCrossReferences(set);
  return set;
}

/** Generated content written by another build: regenerating `content/` fixes it, unlike a schema break. */
export class StaleContentError extends Error {}

/** Parse the content set the pipeline generated (`content/ir.json`). A document stamped with another IR
 *  version, or missing a lane the pipeline always writes, was written by another build and is rejected
 *  with {@link StaleContentError} rather than loaded. */
export function parseGeneratedContentSet(raw: unknown): ContentSet {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const version = generatedVersion(raw);
    if (version !== undefined && version !== IR_VERSION) {
      throw new StaleContentError(
        `generated content reports IR ${String(version)}, this build reads ${IR_VERSION}: regenerate it with this build`,
      );
    }
    const missing = Object.keys(ContentSet.shape).filter((lane) => !Object.hasOwn(raw, lane));
    if (missing.length > 0) {
      throw new StaleContentError(
        `generated content lacks ${missing.join(', ')}: regenerate it with this build`,
      );
    }
  }
  return parseContentSet(raw);
}

/** The document's numeric `manifest.version`; any other shape is left to the schema error. */
function generatedVersion(raw: object): number | undefined {
  const manifest = 'manifest' in raw ? raw.manifest : undefined;
  if (typeof manifest !== 'object' || manifest === null || !('version' in manifest)) return undefined;
  return typeof manifest.version === 'number' ? manifest.version : undefined;
}

/**
 * Parse and validate one decoded terrain grid file (`content/maps/<id>.json`). The loader boundary:
 * the `typeIds.length === width * height` invariant is checked here, outside the pure sim, so a
 * malformed file fails at load rather than as an out-of-bounds read in `buildTerrainGraph`.
 */
export function parseTerrainMap(raw: unknown): TerrainMapFile {
  return TerrainMapFile.parse(raw);
}

export { hasHumanForm, type UnitIdentity, unitVariantFor } from './unit-variants.js';
