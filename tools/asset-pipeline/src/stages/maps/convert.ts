import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MapScript } from '@open-northland/data';
import { decodeCifStringArray } from '../../decoders/cif.js';
import {
  cifLinesToSections,
  decodeIni,
  extractStaticObjects,
  parseIniSections,
  type RuleSection,
} from '../../decoders/ini.js';
import type { StageItemReporter } from '../../progress.js';
import { collectSourceFilesNamed, rootsInOrder, type SourceRoots } from '../../roots.js';
import { findPathCaseInsensitive, findPathCaseInsensitiveInDirs } from './case-path.js';
import { mapIdFromPath } from './info.js';
import { loadMapStringTable, resolveMapMeta } from './meta.js';
import { minimapToPng } from './minimap.js';
import { resolveMapScript } from './script.js';
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
  /** Whether a `maps/<id>.script.json` sidecar was emitted (the map carried playerdata/missions). */
  readonly script: boolean;
}

/**
 * Decodes every `map.dat` under the source roots (overlay-first union) into a per-cell landscape-typeId grid (the sim's
 * `TerrainMap` shape) and writes it to `<outDir>/maps/<id>.json` — closing the
 * `map.dat` → `lmltToTerrainMap` → `buildTerrainGraph` chain into the pipeline so the sim loads a real
 * map's grid instead of a synthetic scenario one. Each map's `id` comes from its containing folder
 * ({@link mapIdFromPath}), so the artifact joins onto the same-folder `map.cif`'s `MapInfo` `id`.
 * Maps are visited in a stable (path-sorted) order so a re-run is reproducible.
 *
 * Beside each grid, three optional sidecars are emitted when the map folder carries them:
 * `maps/<id>.meta.json` (the display name/description — {@link resolveMapMeta}), `maps/<id>.png`
 * (the shipped minimap decoded to a cropped transparent-filler PNG — {@link minimapToPng}), and
 * `maps/<id>.script.json` (the validated player roster/diplomacy/mission script —
 * {@link resolveMapScript}). Each is deleted before the conditional emit, so a re-run over a source
 * that lost its text/minimap/script cannot leave a stale sidecar joined onto a fresh grid. The dev
 * server's `/maps-index` route joins them onto the map list for the main menu's cards.
 *
 * A `map.dat` that fails to read or decode (not a container, missing `lsiz`/`lmlt`, an `X6el`-only
 * grid, a dims/length mismatch, corrupt RLE) is logged and skipped — a batch over many maps must not
 * abort on one bad file, matching the other tree-walk stages. An output-write failure (and a missing
 * `gameDir`) propagates: that's an environmental error, not a per-file boundary failure.
 *
 * Ids collapse on the folder name, so two maps in same-named folders under different roots
 * (e.g. `Data/maps/oasis_o_plenty` vs `CnModMaps/oasis_o_plenty`) write the same `<id>.json`
 * last-write-wins (on the real game, 130 `map.dat` → 125 files). This is deliberately the same
 * `mapIdFromPath` collapse `decodeMapTree` applies to `map.cif`, so the terrain artifact and its
 * `MapInfo` agree on the id and stay joinable — a path-scoped unique id would have to change both legs
 * together. (A localization sub-folder like `WICHRY_ZIMY/text/map.dat` likewise slugs to `text`; that
 * too matches the existing `map.cif` behavior.)
 */
export async function convertMapDatTree(
  roots: SourceRoots,
  outDir: string,
  onItem?: StageItemReporter,
): Promise<MapDatConversion[]> {
  const found = await collectSourceFilesNamed(roots, 'map.dat');
  const done: MapDatConversion[] = [];
  for (const [processed, { rel, path }] of found.entries()) {
    onItem?.(processed, found.length);
    const id = mapIdFromPath(rel);
    let terrain: MapDatTerrainFile;
    try {
      terrain = mapDatToTerrain(await readFile(path));
    } catch (err) {
      console.warn(`[pipeline] skipped map.dat ${rel}: ${(err as Error).message}`);
      continue;
    }
    // The authored entity placements live in the sibling map.cif's `StaticObjects` section (the
    // map.dat carries only terrain + landscape lanes). Absent/undecodable cif → the terrain still
    // emits, just without the optional layer — the same per-layer degradation `ground`/`objects` get.
    // The decoded sections also feed the meta sidecar's `[misc_mapname]` fallback (resolveMapMeta),
    // so the cif is decoded at most once per map. Sibling files resolve overlay-first through the
    // map folder's candidate dirs (an over-installed mod merges folder contents, so a two-root
    // conversion must too).
    const mapDirs = rootsInOrder(roots).map((root) => join(root, dirname(rel)));
    let cifSections: readonly RuleSection[] | undefined;
    for (const mapDir of mapDirs) {
      // Case-insensitively, like every sibling read here: the map folders mix casing freely, which a
      // case-sensitive filesystem would otherwise turn into a silently missing entity layer.
      const cifPath = await findPathCaseInsensitive(mapDir, ['map.cif']);
      if (cifPath === null) continue;
      try {
        const cifBytes = await readFile(cifPath);
        cifSections = cifLinesToSections(decodeCifStringArray(cifBytes).lines);
        const entities = extractStaticObjects(cifSections);
        if (entities !== undefined) terrain = { ...terrain, entities };
        break;
      } catch {
        // no map.cif in this candidate dir (or undecodable) — try the next; absent everywhere,
        // the entity layer is simply skipped
      }
    }
    // Unpacked maps (the CnMod majority — 108 of 121 folders) ship no map.cif: their StaticObjects
    // live in a sibling plaintext `staticobjects.inc`, with the identical `[StaticObjects]` grammar
    // (sethouse/sethuman/setanimal — verified against the real files). Read it when the cif path yielded
    // no entities, so those maps (e.g. magiczny_las, blekiny_nurt) import their authored starting HQs +
    // settlers instead of appearing empty. Readable mod source is preferred over the encrypted cif
    // (golden rule #4); undecodable/malformed is logged and skipped like the cif path.
    if (terrain.entities === undefined) {
      const incPath = await findPathCaseInsensitiveInDirs(mapDirs, ['staticobjects.inc']);
      if (incPath !== null) {
        try {
          const entities = extractStaticObjects(parseIniSections(decodeIni(await readFile(incPath))));
          if (entities !== undefined) terrain = { ...terrain, entities };
        } catch (err) {
          console.warn(`[pipeline] map ${rel}: staticobjects.inc undecodable: ${(err as Error).message}`);
        }
      }
    }
    const output = join('maps', `${id}.json`);
    const outPath = join(outDir, output);
    await mkdir(dirname(outPath), { recursive: true });
    // Compact JSON: the ground/object lanes are hundreds of thousands of numbers — pretty-printing
    // them one-per-line would blow the artifact up ~8×.
    await writeFile(outPath, `${JSON.stringify(terrain)}\n`);

    // Menu-facing sidecars, all optional (the menu card degrades per missing piece). Clear any
    // previous run's sidecars first so a source that lost its text/minimap/script doesn't keep stale
    // ones. The string table is loaded once and feeds both the meta strings and the script's slot names.
    const metaPath = join(outDir, 'maps', `${id}.meta.json`);
    const pngPath = join(outDir, 'maps', `${id}.png`);
    const scriptPath = join(outDir, 'maps', `${id}.script.json`);
    await rm(metaPath, { force: true });
    await rm(pngPath, { force: true });
    await rm(scriptPath, { force: true });
    const strings = await loadMapStringTable(mapDirs, rel);
    const metaFile = await resolveMapMeta(mapDirs, rel, cifSections, strings);
    if (metaFile !== undefined) {
      await writeFile(metaPath, `${JSON.stringify(metaFile)}\n`);
    }
    let scriptFile: MapScript | undefined;
    try {
      scriptFile = await resolveMapScript(mapDirs, rel, cifSections, strings);
    } catch (err) {
      // A schema-invalid script (unexpected codes in one authored map) degrades that map to no
      // roster rather than aborting the batch; an output-write failure below still propagates.
      console.warn(`[pipeline] map ${rel}: script undecodable: ${(err as Error).message}`);
    }
    if (scriptFile !== undefined) {
      await writeFile(scriptPath, `${JSON.stringify(scriptFile)}\n`);
    }
    let minimap = false;
    const minimapPath = await findPathCaseInsensitiveInDirs(mapDirs, ['minimap', 'minimap.pcx']);
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
      script: scriptFile !== undefined,
    });
  }
  return done;
}
