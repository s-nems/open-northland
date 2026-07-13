import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MapInfo } from '@open-northland/data';
import { decodeCifStringArray } from '../../decoders/cif.js';
import { cifLinesToSections, extractMapInfo, type SourceRef } from '../../decoders/ini.js';
import { collectFilesNamed } from '../../walk.js';

/**
 * Pure composition: one `map.cif`'s bytes + a slug id -> its validated {@link MapInfo} logic header.
 * Decodes the encrypted `CStringArray` root ({@link decodeCifStringArray}), folds its level-tagged
 * lines into `RuleSection`s ({@link cifLinesToSections}), and runs {@link extractMapInfo}. The
 * decoders stay pure; this is the only wiring. Throws an
 * `ini:`/`cif:`-prefixed error for a non-map or header-less `.cif`; {@link decodeMapTree} catches it
 * per-file so one bad map can't abort the batch.
 */
export function mapCifToInfo(bytes: Uint8Array, id: string, src: SourceRef): MapInfo {
  const sections = cifLinesToSections(decodeCifStringArray(bytes).lines);
  return extractMapInfo(sections, id, src);
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

/**
 * Decodes the logic header of every `map.cif` under `gameDir` into a validated {@link MapInfo}, in a
 * stable order (the maps are sorted by their relative path so the IR is reproducible regardless of
 * directory-entry order). Each map's `id` comes from its containing folder ({@link mapIdFromPath}).
 * A `.cif` that fails to read or decode (not a map, missing `mapsize`/`mapguid`, corrupt container) is
 * logged and skipped — a batch over many maps must not abort on one bad file, matching the other
 * tree-walk stages. Only the declarative header metadata is extracted; the binary tile grid and the
 * `MissionData`/`StaticObjects` scripting are out of scope here (see {@link extractMapInfo}).
 */
export async function decodeMapTree(gameDir: string): Promise<MapInfo[]> {
  const found = await collectFilesNamed(gameDir, 'map.cif');
  const maps: MapInfo[] = [];
  for (const rel of found) {
    try {
      const bytes = await readFile(join(gameDir, rel));
      maps.push(mapCifToInfo(bytes, mapIdFromPath(rel), { file: rel, layer: 'base' }));
    } catch (err) {
      console.warn(`[pipeline] skipped map ${rel}: ${(err as Error).message}`);
    }
  }
  return maps;
}
