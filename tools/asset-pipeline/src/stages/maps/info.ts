import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MapInfo } from '@open-northland/data';
import { cifBytesToSections, extractMapInfo, type SourceRef } from '../../decoders/ini.js';
import { errorMessage } from '../../errors.js';
import { collectSourceFilesNamed, type SourceFile, type SourceRoots } from '../../roots.js';

/**
 * Pure composition: one `map.cif`'s bytes + a slug id -> its validated {@link MapInfo} logic header
 * ({@link cifBytesToSections} then {@link extractMapInfo}). The decoders stay pure; this is the only
 * wiring. Throws an `ini:`/`cif:`-prefixed error for a non-map or header-less `.cif`;
 * {@link decodeMapTree} catches it per-file so one bad map can't abort the batch.
 */
export function mapCifToInfo(bytes: Uint8Array, id: string, src: SourceRef): MapInfo {
  return extractMapInfo(cifBytesToSections(bytes), id, src);
}

/**
 * Slugs a map's containing-folder name into its {@link MapInfo} `id`: lower-cased, non-alphanumerics
 * collapsed to `_`. Maps live one-per-folder (`CnModMaps/<name>/map.cif`), and the `.cif` logic header
 * carries no human-readable id, so the folder name is the stable cross-reference key. Mirrors the `slug`
 * the `.ini` extractors use for type ids.
 */
export function mapIdFromPath(mapCifRelPath: string): string {
  const folder = dirname(mapCifRelPath).split(/[\\/]/).pop() ?? mapCifRelPath;
  return folder
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The per-map string-table subfolder (`<map>/text/<lang>/strings.*`), not a map folder itself. */
export const STRING_TABLE_DIR = 'text';

/**
 * Drops stray string-table copies from a map-file candidate list: an author's `text/` subfolder can
 * carry a stale revision of the map file (the owned corpus ships `WICHRY_ZIMY/text/map.dat`), which
 * would otherwise convert as a ghost map with id `text`. A candidate is dropped only when its folder
 * case-folds to `text` AND the parent folder holds a candidate of its own; a top-level map folder
 * that happens to be named `text` still converts.
 */
export function excludeStringTableCopies(found: readonly SourceFile[]): SourceFile[] {
  const candidateDirs = new Set(found.map(({ rel }) => dirname(rel).toLowerCase()));
  return found.filter(({ rel }) => {
    const dir = dirname(rel);
    const folder = dir.split(/[\\/]/).pop() ?? '';
    return !(folder.toLowerCase() === STRING_TABLE_DIR && candidateDirs.has(dirname(dir).toLowerCase()));
  });
}

/**
 * Decodes the logic header of every `map.cif` under the source roots (overlay-first union, minus
 * string-table strays, {@link excludeStringTableCopies}) into a validated {@link MapInfo}, in a
 * stable order (the maps are sorted by their relative path so the IR is reproducible regardless of
 * directory-entry order). Each map's `id` comes from its containing
 * folder ({@link mapIdFromPath}). A `.cif` that fails to read or decode (not a map, missing
 * `mapsize`/`mapguid`, corrupt container) is logged and skipped — a batch over many maps must not
 * abort on one bad file, matching the other tree-walk stages. Only the declarative header metadata is
 * extracted here; the binary tile grid, the `StaticObjects` placements and the
 * `playerdata`/`MissionData` script land in per-map artifacts via `convertMapDatTree` (see
 * {@link extractMapInfo}).
 */
export async function decodeMapTree(roots: SourceRoots): Promise<MapInfo[]> {
  const found = excludeStringTableCopies(await collectSourceFilesNamed(roots, 'map.cif'));
  const maps: MapInfo[] = [];
  for (const { rel, path } of found) {
    try {
      const bytes = await readFile(path);
      maps.push(mapCifToInfo(bytes, mapIdFromPath(rel), { file: rel, layer: 'base' }));
    } catch (err) {
      console.warn(`[pipeline] skipped map ${rel}: ${errorMessage(err)}`);
    }
  }
  return maps;
}
