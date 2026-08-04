import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MapInfo } from '@open-northland/data';
import { cifBytesToSections, extractMapInfo, type SourceRef } from '../../decoders/ini.js';
import { errorMessage } from '../../errors.js';
import { collectSourceFilesNamed, type SourceFile, type SourceRoots } from '../../roots.js';

/**
 * One `map.cif`'s bytes plus a slug id to its validated logic header. Throws an `ini:`/`cif:`-prefixed
 * error for a non-map or header-less `.cif`.
 */
export function mapCifToInfo(bytes: Uint8Array, id: string, src: SourceRef): MapInfo {
  return extractMapInfo(cifBytesToSections(bytes), id, src);
}

/**
 * Slugs a map's containing-folder name into its `MapInfo` `id`. The `.cif` logic header carries no
 * human-readable id, so the one-per-folder name is the stable cross-reference key, slugged like the
 * type ids the `.ini` extractors mint.
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
 * Drops stray string-table copies from a map-file candidate list: a `text/` subfolder can carry a
 * stale revision of the map file, which would otherwise convert as a ghost map with id `text`. A
 * candidate is dropped only when the parent folder holds a candidate of its own, so a top-level map
 * folder named `text` still converts.
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
 * Decodes the logic header of every `map.cif` under the source roots into a validated `MapInfo`, in
 * path-sorted order so the IR is reproducible regardless of directory-entry order. A `.cif` that
 * fails to read or decode is logged and skipped so one bad file cannot abort the batch. Only the
 * declarative header lands here; the tile grid, `StaticObjects` placements and
 * `playerdata`/`MissionData` script land in per-map artifacts via `convertMapDatTree`.
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
