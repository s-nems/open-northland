import type { MapScript } from '@open-northland/data';
import { type Vfs, vdirname, vjoin, writeText } from '@open-northland/vfs';
import {
  cifBytesToSections,
  extractStaticObjects,
  iniBytesToSections,
  type RuleSection,
} from '../../decoders/ini.js';
import { errorMessage } from '../../errors.js';
import type { StageItemReporter } from '../../progress.js';
import {
  collectSourceFilesNamed,
  findPathCaseInsensitive,
  findPathCaseInsensitiveInDirs,
  rootsInOrder,
  type SourceRoots,
} from '../../roots.js';
import { cutsceneIdsOf, resolveMapBriefing } from './briefing.js';
import { excludeStringTableCopies, mapIdFromPath } from './info.js';
import { loadMapStringTable, resolveMapMeta } from './meta.js';
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
  /** Whether a `maps/<id>.meta.json` name/description sidecar was emitted. */
  readonly meta: boolean;
  /** Whether a `maps/<id>.png` minimap was emitted, decoded or synthesized. */
  readonly minimap: boolean;
  /** The emitted minimap was synthesized from the decoded cells. */
  readonly minimapSynthesized: boolean;
  /** Whether a `maps/<id>.script.json` roster/mission sidecar was emitted. */
  readonly script: boolean;
  /** Whether a `maps/<id>.briefing.json` mission-window text sidecar was emitted. */
  readonly briefing: boolean;
}

/**
 * Decodes every `map.dat` under the source roots into `<outDir>/maps/<id>.json` plus its optional
 * meta, minimap and script sidecars, in path-sorted order so a re-run is reproducible. The id is the
 * containing folder's slug, the same collapse `decodeMapTree` applies to `map.cif`, so the artifact
 * and its `MapInfo` stay joinable and same-named folders under different roots write one file,
 * last write wins. A `map.dat` that fails to read or decode is logged and skipped; a write failure
 * and a missing `gameDir` propagate.
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
  await fs.rm(vjoin(outDir, 'maps'));
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
    // once per map. An over-installed mod merges folder contents, so siblings resolve overlay-first
    // across the map folder's candidate dirs.
    const mapDirs = rootsInOrder(roots).map((root) => vjoin(root, vdirname(rel)));
    let cifSections: readonly RuleSection[] | undefined;
    for (const mapDir of mapDirs) {
      // The map folders mix casing freely, which a case-sensitive filesystem would otherwise turn
      // into a silently missing entity layer.
      const cifPath = await findPathCaseInsensitive(fs, mapDir, ['map.cif']);
      if (cifPath === undefined) continue;
      try {
        cifSections = cifBytesToSections(await fs.readFile(cifPath));
        const entities = extractStaticObjects(cifSections);
        if (entities !== undefined) terrain = { ...terrain, entities };
        break;
      } catch {
        // Missing or undecodable here: try the next candidate dir; absent everywhere the entity
        // layer is skipped.
      }
    }
    // Unpacked maps ship no map.cif: their placements live in a sibling plaintext
    // `staticobjects.inc` with the identical `[StaticObjects]` grammar (sethouse/sethuman/setanimal),
    // and readable mod source is preferred over the encrypted cif.
    if (terrain.entities === undefined) {
      const incPath = await findPathCaseInsensitiveInDirs(fs, mapDirs, ['staticobjects.inc']);
      if (incPath !== undefined) {
        try {
          const entities = extractStaticObjects(iniBytesToSections(await fs.readFile(incPath)));
          if (entities !== undefined) terrain = { ...terrain, entities };
        } catch (err) {
          console.warn(`[pipeline] map ${rel}: staticobjects.inc undecodable: ${errorMessage(err)}`);
        }
      }
    }
    const output = vjoin('maps', `${id}.json`);
    // Compact JSON: the lanes are hundreds of thousands of numbers, and one per line costs ~8x size.
    await writeText(fs, vjoin(outDir, output), `${JSON.stringify(terrain)}\n`);

    // A same-id twin converted earlier this run may have emitted sidecars; clear them so
    // last-write-wins covers the sidecars, not just the grid.
    const metaPath = vjoin(outDir, 'maps', `${id}.meta.json`);
    const pngPath = vjoin(outDir, 'maps', `${id}.png`);
    const scriptPath = vjoin(outDir, 'maps', `${id}.script.json`);
    const briefingPath = vjoin(outDir, 'maps', `${id}.briefing.json`);
    await fs.rm(metaPath);
    await fs.rm(pngPath);
    await fs.rm(scriptPath);
    await fs.rm(briefingPath);
    const strings = await loadMapStringTable(fs, mapDirs, rel);
    const metadata = await resolveMapMeta(fs, mapDirs, rel, cifSections, strings);
    const metaFile = { ...metadata, provenance: await mapProvenance(fs, roots, { rel, path }) };
    await writeText(fs, metaPath, `${JSON.stringify(metaFile)}\n`);
    let scriptFile: MapScript | undefined;
    try {
      scriptFile = await resolveMapScript(fs, mapDirs, rel, cifSections, strings);
    } catch (err) {
      // A schema-invalid script degrades that map to no roster rather than aborting the batch.
      console.warn(`[pipeline] map ${rel}: script undecodable: ${errorMessage(err)}`);
    }
    if (scriptFile !== undefined) {
      await writeText(fs, scriptPath, `${JSON.stringify(scriptFile)}\n`);
    }
    let briefing = false;
    if (scriptFile !== undefined) {
      const briefingFile = await resolveMapBriefing(fs, mapDirs, outDir, rel, cutsceneIdsOf(scriptFile));
      if (briefingFile !== undefined) {
        await writeText(fs, briefingPath, `${JSON.stringify(briefingFile)}\n`);
        briefing = true;
      }
    }
    let minimap = false;
    let minimapSynthesized = false;
    const minimapPath = await findPathCaseInsensitiveInDirs(fs, mapDirs, ['minimap', 'minimap.pcx']);
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
      meta: true,
      minimap,
      minimapSynthesized,
      script: scriptFile !== undefined,
      briefing,
    });
  }
  return done;
}
