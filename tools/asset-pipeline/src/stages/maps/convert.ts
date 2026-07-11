import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { decodeCifStringArray } from '../../decoders/cif.js';
import { cifLinesToSections, extractStaticObjects, type RuleSection } from '../../decoders/ini.js';
import { walkFiles } from '../../walk.js';
import { findPathCaseInsensitive } from './case-path.js';
import { mapIdFromPath } from './info.js';
import { resolveMapMeta } from './meta.js';
import { minimapToPng } from './minimap.js';
import { type MapDatTerrainFile, mapDatToTerrain } from './terrain.js';

/** One emitted map terrain artifact: its slug id + the relative `maps/<id>.json` path under `outDir`. */
export interface MapDatConversion {
  /** The map's slug id ({@link mapIdFromPath}) — the same key as its `map.cif` `MapInfo`. */
  readonly id: string;
  /** Grid width/height (cells = width × height) — surfaced so a batch can report sane dims. */
  readonly width: number;
  readonly height: number;
  /** The terrain JSON's path relative to `outDir` (native separators). */
  readonly output: string;
  /** Whether a `maps/<id>.meta.json` name/description sidecar was emitted (the folder carried strings). */
  readonly meta: boolean;
  /** Whether a `maps/<id>.png` minimap was emitted (the folder carried `minimap/minimap.pcx`). */
  readonly minimap: boolean;
}

/**
 * Decodes every `map.dat` under `gameDir` into a per-cell landscape-typeId grid (the sim's
 * `TerrainMap` shape) and writes it to `<outDir>/maps/<id>.json` — closing the
 * `map.dat` → `lmltToTerrainMap` → `buildTerrainGraph` chain into the pipeline so the sim loads a real
 * map's grid instead of a synthetic scenario one. Each map's `id` comes from its containing folder
 * ({@link mapIdFromPath}), so the artifact joins onto the same-folder `map.cif`'s `MapInfo` `id`.
 * Maps are visited in a stable (path-sorted) order so a re-run is reproducible.
 *
 * Beside each grid, two OPTIONAL menu-facing sidecars are emitted when the map folder carries them:
 * `maps/<id>.meta.json` (the display name/description — {@link resolveMapMeta}) and `maps/<id>.png`
 * (the shipped minimap decoded to a cropped transparent-filler PNG — {@link minimapToPng}). Both are
 * DELETED before the conditional emit, so a re-run over a source that lost its text/minimap cannot
 * leave a stale sidecar joined onto a fresh grid. The dev server's `/maps-index` route joins them onto
 * the map list for the main menu's cards.
 *
 * A `map.dat` that fails to read or decode (not a container, missing `lsiz`/`lmlt`, an `X6el`-only
 * grid, a dims/length mismatch, corrupt RLE) is logged and skipped — a batch over many maps must not
 * abort on one bad file, matching the other tree-walk stages. An output-write failure (and a missing
 * `gameDir`) propagates: that's an environmental error, not a per-file boundary failure.
 *
 * KNOWN: ids collapse on the folder name, so two maps in same-named folders under different roots
 * (e.g. `Data/maps/oasis_o_plenty` vs `CnModMaps/oasis_o_plenty`) write the same `<id>.json`
 * last-write-wins (on the real game, 130 `map.dat` → 125 files). This is *deliberately* the same
 * `mapIdFromPath` collapse `decodeMapTree` applies to `map.cif`, so the terrain artifact and its
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
    let terrain: MapDatTerrainFile;
    try {
      terrain = mapDatToTerrain(await readFile(join(gameDir, rel)));
    } catch (err) {
      console.warn(`[pipeline] skipped map.dat ${rel}: ${(err as Error).message}`);
      continue;
    }
    // The authored entity placements live in the SIBLING map.cif's `StaticObjects` section (the
    // map.dat carries only terrain + landscape lanes). Absent/undecodable cif → the terrain still
    // emits, just without the optional layer — the same per-layer degradation `ground`/`objects` get.
    // The decoded sections also feed the meta sidecar's `[misc_mapname]` fallback (resolveMapMeta),
    // so the cif is decoded at most once per map.
    const mapDir = join(gameDir, dirname(rel));
    let cifSections: readonly RuleSection[] | undefined;
    try {
      const cifBytes = await readFile(join(mapDir, 'map.cif'));
      cifSections = cifLinesToSections(decodeCifStringArray(cifBytes).lines);
      const entities = extractStaticObjects(cifSections);
      if (entities !== undefined) terrain = { ...terrain, entities };
    } catch {
      // no sibling map.cif (or undecodable) — entity layer skipped
    }
    const output = join('maps', `${id}.json`);
    const outPath = join(outDir, output);
    await mkdir(dirname(outPath), { recursive: true });
    // Compact JSON: the ground/object lanes are hundreds of thousands of numbers — pretty-printing
    // them one-per-line would blow the artifact up ~8×.
    await writeFile(outPath, `${JSON.stringify(terrain)}\n`);

    // Menu-facing sidecars, both optional (the menu card degrades per missing piece). Clear any
    // previous run's sidecars first so a source that lost its text/minimap doesn't keep stale ones.
    const metaPath = join(outDir, 'maps', `${id}.meta.json`);
    const pngPath = join(outDir, 'maps', `${id}.png`);
    await rm(metaPath, { force: true });
    await rm(pngPath, { force: true });
    const metaFile = await resolveMapMeta(mapDir, rel, cifSections);
    if (metaFile !== undefined) {
      await writeFile(metaPath, `${JSON.stringify(metaFile)}\n`);
    }
    let minimap = false;
    const minimapPath = await findPathCaseInsensitive(mapDir, ['minimap', 'minimap.pcx']);
    if (minimapPath !== null) {
      try {
        await writeFile(pngPath, minimapToPng(await readFile(minimapPath)));
        minimap = true;
      } catch (err) {
        console.warn(`[pipeline] map ${rel}: minimap undecodable: ${(err as Error).message}`);
      }
    }
    done.push({
      id,
      width: terrain.width,
      height: terrain.height,
      output,
      meta: metaFile !== undefined,
      minimap,
    });
  }
  return done;
}
