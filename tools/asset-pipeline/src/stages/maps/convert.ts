import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type MapMeta, type MapScript, MapStrings } from '@open-northland/data';
import {
  cifBytesToSections,
  extractStaticObjects,
  iniBytesToSections,
  type RuleSection,
} from '../../decoders/ini.js';
import { errorMessage } from '../../errors.js';
import { writeFileWithParents } from '../../files.js';
import {
  collectSourceFilesNamed,
  findPathCaseInsensitive,
  readSourceFile,
  type SourceRoots,
} from '../../roots.js';
import { MAPS_DIR } from '../content-tree.js';
import { cutsceneIdsOf, resolveMapBriefing } from './briefing.js';
import { excludeStringTableCopies, mapIdFromPath } from './info.js';
import { loadMapStringTables, resolveMapMeta } from './meta.js';
import { minimapToPng } from './minimap.js';
import { mapProvenance } from './provenance.js';
import { resolveMapScript } from './script.js';
import { type MapDatTerrainFile, mapDatToTerrain } from './terrain/index.js';

/**
 * Where an unpacked map (no `map.cif`) keeps its `[StaticObjects]` placements, in lookup order: the
 * `staticobjects.inc` its `map.ini` includes, or, in a few flattened folders, `map.ini` itself.
 */
const PLAINTEXT_STATIC_OBJECT_FILES = ['staticobjects.inc', 'map.ini'] as const;

/** One emitted map terrain artifact. */
export interface MapDatConversion {
  /** The map's slug id, the same key as its `map.cif` `MapInfo`. */
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** The terrain JSON's path relative to `outDir`. */
  readonly output: string;
  /** Whether the authored `minimap.pcx` picture was decoded into `maps/<id>.png`. */
  readonly picture: boolean;
  /** Whether a terrain minimap was rasterized from the decoded cells into `maps/<id>.map.png`. */
  readonly minimap: boolean;
  /** The emitted `maps/<id>.meta.json`. */
  readonly meta: MapMeta;
  /** The emitted `maps/<id>.script.json`, when the map ships a decodable script. */
  readonly script?: MapScript;
  /** Whether a `maps/<id>.briefing.json` mission-window text sidecar was emitted. */
  readonly briefing: boolean;
  /** Whether a `maps/<id>.strings.json` per-language string table was emitted. */
  readonly strings: boolean;
}

/**
 * Decodes every `map.dat` under the mod root into `<outDir>/maps/<id>.json` plus its optional
 * meta, picture, minimap and script sidecars, in path-sorted order so a re-run is reproducible. The
 * id is the containing folder's slug, the same collapse `decodeMapTree` applies to `map.cif`, so the
 * artifact and its `MapInfo` stay joinable and two folders with one slug write one file, last write
 * wins. A `map.dat` that fails to read or decode is logged and skipped; a write failure and a missing
 * mod root propagate.
 */
export async function convertMapDatTree(
  roots: SourceRoots,
  outDir: string,
  synthesizeMinimap?: (terrain: MapDatTerrainFile) => Promise<Uint8Array | undefined>,
): Promise<MapDatConversion[]> {
  const found = excludeStringTableCopies(await collectSourceFilesNamed(roots, 'map.dat'));
  // This stage is the only writer under <outDir>/maps, so a wholesale reset is safe.
  await rm(join(outDir, MAPS_DIR), { recursive: true, force: true });
  const done: MapDatConversion[] = [];
  for (const { rel, path } of found) {
    const id = mapIdFromPath(rel);
    let terrain: MapDatTerrainFile;
    try {
      terrain = mapDatToTerrain(await readFile(path));
    } catch (err) {
      console.warn(`[pipeline] skipped map.dat ${rel}: ${errorMessage(err)}`);
      continue;
    }
    // Authored entity placements live in the sibling `map.cif`'s `StaticObjects` section, and the same
    // decoded sections feed the meta sidecar's `[misc_mapname]` fallback, so the cif is decoded at most
    // once per map. The map folders mix casing freely, which a case-sensitive filesystem would
    // otherwise turn into a silently missing entity layer.
    const mapDir = join(roots.mod, dirname(rel));
    let cifSections: readonly RuleSection[] | undefined;
    const cifPath = await findPathCaseInsensitive(mapDir, ['map.cif']);
    if (cifPath !== undefined) {
      try {
        cifSections = cifBytesToSections(await readFile(cifPath));
        const entities = extractStaticObjects(cifSections);
        if (entities !== undefined) terrain = { ...terrain, entities };
      } catch {
        // Undecodable: the entity layer is skipped.
      }
    }
    for (const file of PLAINTEXT_STATIC_OBJECT_FILES) {
      if (terrain.entities !== undefined) break;
      const path = await findPathCaseInsensitive(mapDir, [file]);
      if (path === undefined) continue;
      try {
        const entities = extractStaticObjects(iniBytesToSections(await readFile(path)));
        if (entities !== undefined) terrain = { ...terrain, entities };
      } catch (err) {
        console.warn(`[pipeline] map ${rel}: ${file} undecodable: ${errorMessage(err)}`);
      }
    }
    const output = `${MAPS_DIR}/${id}.json`;
    // Compact JSON: the lanes are hundreds of thousands of numbers, and one per line costs ~8x size.
    await writeFileWithParents(join(outDir, output), `${JSON.stringify(terrain)}\n`);

    // A same-id twin converted earlier this run may have emitted sidecars; clear them so
    // last-write-wins covers the sidecars, not just the grid.
    const metaPath = join(outDir, MAPS_DIR, `${id}.meta.json`);
    const picturePath = join(outDir, MAPS_DIR, `${id}.png`);
    const minimapPath = join(outDir, MAPS_DIR, `${id}.map.png`);
    const scriptPath = join(outDir, MAPS_DIR, `${id}.script.json`);
    const briefingPath = join(outDir, MAPS_DIR, `${id}.briefing.json`);
    const stringsPath = join(outDir, MAPS_DIR, `${id}.strings.json`);
    for (const sidecar of [metaPath, picturePath, minimapPath, scriptPath, briefingPath, stringsPath]) {
      await rm(sidecar, { force: true });
    }
    const stringTables = await loadMapStringTables(mapDir, rel);
    if (Object.keys(stringTables).length > 0) {
      await writeFileWithParents(stringsPath, `${JSON.stringify(MapStrings.parse(stringTables))}\n`);
    }
    const metadata = await resolveMapMeta(mapDir, rel, cifSections, stringTables);
    const metaFile: MapMeta = { ...metadata, provenance: mapProvenance(rel) };
    await writeFileWithParents(metaPath, `${JSON.stringify(metaFile)}\n`);
    let scriptFile: MapScript | undefined;
    try {
      scriptFile = await resolveMapScript(mapDir, rel, cifSections, stringTables, (path) =>
        readSourceFile(roots, path),
      );
    } catch (err) {
      // A schema-invalid script degrades that map to no roster rather than aborting the batch.
      console.warn(`[pipeline] map ${rel}: script undecodable: ${errorMessage(err)}`);
    }
    if (scriptFile !== undefined) {
      await writeFileWithParents(scriptPath, `${JSON.stringify(scriptFile)}\n`);
    }
    let briefing = false;
    if (scriptFile !== undefined) {
      const briefingFile = await resolveMapBriefing(mapDir, outDir, rel, cutsceneIdsOf(scriptFile));
      if (briefingFile !== undefined) {
        await writeFileWithParents(briefingPath, `${JSON.stringify(briefingFile)}\n`);
        briefing = true;
      }
    }
    let picture = false;
    const picturePcx = await findPathCaseInsensitive(mapDir, ['minimap', 'minimap.pcx']);
    if (picturePcx !== undefined) {
      try {
        await writeFileWithParents(picturePath, await minimapToPng(await readFile(picturePcx)));
        picture = true;
      } catch (err) {
        console.warn(`[pipeline] map ${rel}: minimap picture undecodable: ${errorMessage(err)}`);
      }
    }
    // Rasterized for every map, so the menu never has to pull the multi-MB terrain JSON to draw it.
    let minimap = false;
    if (synthesizeMinimap !== undefined) {
      try {
        const png = await synthesizeMinimap(terrain);
        if (png !== undefined) {
          await writeFileWithParents(minimapPath, png);
          minimap = true;
        }
      } catch (err) {
        console.warn(`[pipeline] map ${rel}: minimap synthesis failed: ${errorMessage(err)}`);
      }
    }
    done.push({
      id,
      width: terrain.width,
      height: terrain.height,
      output,
      picture,
      minimap,
      meta: metaFile,
      ...(scriptFile !== undefined ? { script: scriptFile } : {}),
      briefing,
      strings: Object.keys(stringTables).length > 0,
    });
  }
  return done;
}
