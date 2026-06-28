import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { MapInfo } from '@vinland/data';
import { decodeCifStringArray } from '../decoders/cif.js';
import { type SourceRef, cifLinesToSections, extractMapInfo } from '../decoders/ini.js';
import {
  type MapDatTerrainMap,
  decodeMapDat,
  decodeMapSize,
  findChunk,
  lmltToTerrainMap,
  unpackMapLayer,
} from '../decoders/mapdat.js';
import { walkFiles } from '../walk.js';

/**
 * Pure composition: one `map.cif`'s bytes + a slug id -> its validated {@link MapInfo} logic header.
 * Decodes the encrypted `CStringArray` root ({@link decodeCifStringArray}), folds its level-tagged
 * lines into {@link RuleSection}s ({@link cifLinesToSections}), and runs {@link extractMapInfo}. Like
 * {@link pcxToPng}/{@link bmdToAtlas} the decoders stay pure; this is the only wiring. Throws an
 * `ini:`/`cif:`-prefixed error for a non-map or header-less `.cif`; {@link decodeMapTree} catches it
 * per-file so one bad map can't abort the batch.
 */
export function mapCifToInfo(bytes: Uint8Array, id: string, src: SourceRef): MapInfo {
  const sections = cifLinesToSections(decodeCifStringArray(bytes).lines);
  return extractMapInfo(sections, id, src);
}

/**
 * Pure composition: one `map.dat`'s bytes -> the per-cell landscape-typeId grid the sim's
 * `buildTerrainGraph` consumes. Decodes the `hoix` container ({@link decodeMapDat}), reads the `lsiz`
 * grid dims ({@link decodeMapSize}), unpacks the `lmlt` landscape-type layer ({@link unpackMapLayer}),
 * and collapses its four per-corner typeIds per cell to one ({@link lmltToTerrainMap}) — the
 * `{ width, height, typeIds }` shape (`MapDatTerrainMap`, structurally a sim `TerrainMap`; the build
 * tool never imports `sim`). Like {@link mapCifToInfo} the decoders stay pure; this is the only
 * wiring. Throws a `mapdat:`-prefixed error for a non-container, a missing `lsiz`/`lmlt`, an
 * unsupported codec, or a dims/length mismatch; {@link convertMapDatTree} catches it per-file so one
 * bad map can't abort the batch. The `lmhe` height + `eatd`/`eald` object layers are out of scope here
 * (the nav graph only needs the landscape type).
 */
export function mapDatToTerrain(bytes: Uint8Array): MapDatTerrainMap {
  const map = decodeMapDat(bytes);
  const size = decodeMapSize(map);
  const lmlt = findChunk(map, 'lmlt');
  if (lmlt === undefined) {
    throw new Error('mapdat: no lmlt landscape-type chunk (cannot build the terrain grid)');
  }
  return lmltToTerrainMap(unpackMapLayer(lmlt), size);
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
  const found: string[] = [];
  for await (const file of walkFiles(gameDir)) {
    if (file.toLowerCase().endsWith(`${sep}map.cif`) || file.toLowerCase().endsWith('/map.cif')) {
      found.push(relative(gameDir, file));
    }
  }
  found.sort();
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

/** One emitted map terrain artifact: its slug id + the relative `maps/<id>.json` path under `outDir`. */
export interface MapDatConversion {
  /** The map's slug id ({@link mapIdFromPath}) — the same key as its `map.cif` {@link MapInfo}. */
  readonly id: string;
  /** Grid width/height (cells = width × height) — surfaced so a batch can report sane dims. */
  readonly width: number;
  readonly height: number;
  /** The terrain JSON's path relative to `outDir` (native separators). */
  readonly output: string;
}

/**
 * Decodes every `map.dat` under `gameDir` into a per-cell landscape-typeId grid (the sim's
 * `TerrainMap` shape) and writes it to `<outDir>/maps/<id>.json` — closing the
 * `map.dat` → `lmltToTerrainMap` → `buildTerrainGraph` chain into the pipeline so the sim loads a real
 * map's grid instead of a synthetic scenario one. Each map's `id` comes from its containing folder
 * ({@link mapIdFromPath}), so the artifact joins onto the same-folder `map.cif`'s {@link MapInfo} `id`.
 * Maps are visited in a stable (path-sorted) order so a re-run is reproducible.
 *
 * A `map.dat` that fails to read or decode (not a container, missing `lsiz`/`lmlt`, an `X6el`-only
 * grid, a dims/length mismatch, corrupt RLE) is logged and skipped — a batch over many maps must not
 * abort on one bad file, matching the other tree-walk stages. An output-write failure (and a missing
 * `gameDir`) propagates: that's an environmental error, not a per-file boundary failure.
 *
 * KNOWN: ids collapse on the folder name, so two maps in same-named folders under different roots
 * (e.g. `Data/maps/oasis_o_plenty` vs `CnModMaps/oasis_o_plenty`) write the same `<id>.json`
 * last-write-wins (on the real game, 130 `map.dat` → 125 files). This is *deliberately* the same
 * `mapIdFromPath` collapse {@link decodeMapTree} applies to `map.cif`, so the terrain artifact and its
 * `MapInfo` agree on the id and stay joinable — a path-scoped unique id would have to change both legs
 * together. (A localization sub-folder like `WICHRY_ZIMY/text/map.dat` likewise slugs to `text`; that
 * too matches the existing `map.cif` behavior.)
 */
export async function convertMapDatTree(gameDir: string, outDir: string): Promise<MapDatConversion[]> {
  const found: string[] = [];
  for await (const file of walkFiles(gameDir)) {
    const lower = file.toLowerCase();
    if (lower.endsWith(`${sep}map.dat`) || lower.endsWith('/map.dat')) {
      found.push(relative(gameDir, file));
    }
  }
  found.sort();
  const done: MapDatConversion[] = [];
  for (const rel of found) {
    const id = mapIdFromPath(rel);
    let terrain: MapDatTerrainMap;
    try {
      terrain = mapDatToTerrain(await readFile(join(gameDir, rel)));
    } catch (err) {
      console.warn(`[pipeline] skipped map.dat ${rel}: ${(err as Error).message}`);
      continue;
    }
    const output = join('maps', `${id}.json`);
    const outPath = join(outDir, output);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(terrain, null, 2)}\n`);
    done.push({ id, width: terrain.width, height: terrain.height, output });
  }
  return done;
}
