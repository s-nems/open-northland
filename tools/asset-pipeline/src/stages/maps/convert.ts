import { type MapMeta, type MapScript, MapStrings } from '@open-northland/data';
import { type Vfs, vdirname, vjoin, writeText } from '@open-northland/vfs';
import {
  cifBytesToSections,
  extractStaticObjects,
  iniBytesToSections,
  type RuleSection,
} from '../../decoders/ini.js';
import { errorMessage } from '../../errors.js';
import type { StageItemReporter } from '../../progress.js';
import { collectSourceFilesNamed, findPathCaseInsensitive, type SourceRoots } from '../../roots.js';
import { MAPS_DIR } from '../content-tree.js';
import { cutsceneIdsOf, resolveMapBriefing } from './briefing.js';
import { excludeStringTableCopies, mapIdFromPath } from './info.js';
import { loadMapStringTables, preferredStringTable, resolveMapMeta } from './meta.js';
import { minimapToPng } from './minimap.js';
import { mapProvenance } from './provenance.js';
import { resolveMapScript } from './script.js';
import { type MapDatTerrainFile, mapDatToTerrain } from './terrain/index.js';

/** One emitted map terrain artifact. */
export interface MapDatConversion {
  /** The map's slug id, the same key as its `map.cif` `MapInfo`. */
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** The terrain JSON's path relative to `outDir`. */
  readonly output: string;
  /** Whether a `maps/<id>.png` minimap was emitted, decoded or synthesized. */
  readonly minimap: boolean;
  /** The emitted minimap was synthesized from the decoded cells. */
  readonly minimapSynthesized: boolean;
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
 * meta, minimap and script sidecars, in path-sorted order so a re-run is reproducible. The id is the
 * containing folder's slug, the same collapse `decodeMapTree` applies to `map.cif`, so the artifact
 * and its `MapInfo` stay joinable and two folders with one slug write one file, last write wins. A
 * `map.dat` that fails to read or decode is logged and skipped; a write failure and a missing mod
 * root propagate.
 */
export async function convertMapDatTree(
  fs: Vfs,
  roots: SourceRoots,
  outDir: string,
  onItem?: StageItemReporter,
  synthesizeMinimap?: (terrain: MapDatTerrainFile) => Promise<Uint8Array | undefined>,
): Promise<MapDatConversion[]> {
  const found = excludeStringTableCopies(await collectSourceFilesNamed(fs, roots, 'map.dat'));
  // This stage is the only writer under <outDir>/maps, so a wholesale reset is safe.
  await fs.rm(vjoin(outDir, MAPS_DIR));
  const done: MapDatConversion[] = [];
  for (const [processed, { rel, path }] of found.entries()) {
    onItem?.(processed, found.length);
    const id = mapIdFromPath(rel);
    let terrain: MapDatTerrainFile;
    try {
      terrain = mapDatToTerrain(await fs.readFile(path));
    } catch (err) {
      console.warn(`[pipeline] skipped map.dat ${rel}: ${errorMessage(err)}`);
      continue;
    }
    // Authored entity placements live in the sibling `map.cif`'s `StaticObjects` section, and the same
    // decoded sections feed the meta sidecar's `[misc_mapname]` fallback, so the cif is decoded at most
    // once per map. The map folders mix casing freely, which a case-sensitive filesystem would
    // otherwise turn into a silently missing entity layer.
    const mapDir = vjoin(roots.mod, vdirname(rel));
    let cifSections: readonly RuleSection[] | undefined;
    const cifPath = await findPathCaseInsensitive(fs, mapDir, ['map.cif']);
    if (cifPath !== undefined) {
      try {
        cifSections = cifBytesToSections(await fs.readFile(cifPath));
        const entities = extractStaticObjects(cifSections);
        if (entities !== undefined) terrain = { ...terrain, entities };
      } catch {
        // Undecodable: the entity layer is skipped.
      }
    }
    // Unpacked maps ship no map.cif: their placements live in a sibling plaintext
    // `staticobjects.inc` with the identical `[StaticObjects]` grammar (sethouse/sethuman/setanimal),
    // and readable mod source is preferred over the encrypted cif.
    if (terrain.entities === undefined) {
      const incPath = await findPathCaseInsensitive(fs, mapDir, ['staticobjects.inc']);
      if (incPath !== undefined) {
        try {
          const entities = extractStaticObjects(iniBytesToSections(await fs.readFile(incPath)));
          if (entities !== undefined) terrain = { ...terrain, entities };
        } catch (err) {
          console.warn(`[pipeline] map ${rel}: staticobjects.inc undecodable: ${errorMessage(err)}`);
        }
      }
    }
    const output = vjoin(MAPS_DIR, `${id}.json`);
    // Compact JSON: the lanes are hundreds of thousands of numbers, and one per line costs ~8x size.
    await writeText(fs, vjoin(outDir, output), `${JSON.stringify(terrain)}\n`);

    // A same-id twin converted earlier this run may have emitted sidecars; clear them so
    // last-write-wins covers the sidecars, not just the grid.
    const metaPath = vjoin(outDir, MAPS_DIR, `${id}.meta.json`);
    const pngPath = vjoin(outDir, MAPS_DIR, `${id}.png`);
    const scriptPath = vjoin(outDir, MAPS_DIR, `${id}.script.json`);
    const briefingPath = vjoin(outDir, MAPS_DIR, `${id}.briefing.json`);
    const stringsPath = vjoin(outDir, MAPS_DIR, `${id}.strings.json`);
    await fs.rm(metaPath);
    await fs.rm(pngPath);
    await fs.rm(scriptPath);
    await fs.rm(briefingPath);
    await fs.rm(stringsPath);
    const stringTables = await loadMapStringTables(fs, mapDir, rel);
    if (Object.keys(stringTables).length > 0) {
      await writeText(fs, stringsPath, `${JSON.stringify(MapStrings.parse(stringTables))}\n`);
    }
    const strings = preferredStringTable(stringTables);
    const metadata = await resolveMapMeta(fs, mapDir, rel, cifSections, strings);
    const metaFile: MapMeta = { ...metadata, provenance: mapProvenance(rel) };
    await writeText(fs, metaPath, `${JSON.stringify(metaFile)}\n`);
    let scriptFile: MapScript | undefined;
    try {
      scriptFile = await resolveMapScript(fs, mapDir, rel, cifSections, strings);
    } catch (err) {
      // A schema-invalid script degrades that map to no roster rather than aborting the batch.
      console.warn(`[pipeline] map ${rel}: script undecodable: ${errorMessage(err)}`);
    }
    if (scriptFile !== undefined) {
      await writeText(fs, scriptPath, `${JSON.stringify(scriptFile)}\n`);
    }
    let briefing = false;
    if (scriptFile !== undefined) {
      const briefingFile = await resolveMapBriefing(fs, mapDir, outDir, rel, cutsceneIdsOf(scriptFile));
      if (briefingFile !== undefined) {
        await writeText(fs, briefingPath, `${JSON.stringify(briefingFile)}\n`);
        briefing = true;
      }
    }
    let minimap = false;
    let minimapSynthesized = false;
    const minimapPath = await findPathCaseInsensitive(fs, mapDir, ['minimap', 'minimap.pcx']);
    if (minimapPath !== undefined) {
      try {
        await fs.writeFile(pngPath, await minimapToPng(await fs.readFile(minimapPath)));
        minimap = true;
      } catch (err) {
        console.warn(`[pipeline] map ${rel}: minimap undecodable: ${errorMessage(err)}`);
      }
    }
    // No usable shipped card: rasterize one from the decoded cells, so the menu never has to pull
    // the multi-MB terrain JSON just to draw a list row.
    if (!minimap && synthesizeMinimap !== undefined) {
      try {
        const png = await synthesizeMinimap(terrain);
        if (png !== undefined) {
          await fs.writeFile(pngPath, png);
          minimap = true;
          minimapSynthesized = true;
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
      minimap,
      minimapSynthesized,
      meta: metaFile,
      ...(scriptFile !== undefined ? { script: scriptFile } : {}),
      briefing,
      strings: Object.keys(stringTables).length > 0,
    });
  }
  return done;
}
