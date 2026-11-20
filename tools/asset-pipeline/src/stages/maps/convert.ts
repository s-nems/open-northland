import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MAP_ADDITIONS_FILE, type MapMeta, type MapScript } from '@open-northland/data';
import {
  type ConvertedMap,
  convertMapFolder,
  findMapFolders,
  isMapTreePath,
  type MapDatTerrainFile,
  MapImportError,
  type MapOverlayOutcome,
  type MapTree,
  mapFileNames,
  mapFiles,
  NO_IMPORT_LIMITS,
  treeFromFolder,
} from '@open-northland/map-import';
import { writeFileWithParents } from '../../files.js';
import { collectSourceFiles, readSourceFile, type SourceRoots } from '../../roots.js';
import { correctMapStrings } from '../../string-corrections.js';
import { MAPS_DIR } from '../content-tree.js';
import { writePagePictures } from '../hypertext-pictures.js';
import { withAuthoredForm } from './authored-form.js';
import { mapOverlaySource } from './overlays.js';
import { mapProvenanceKind, takesSourceLanguageOverlays } from './provenance.js';

/** One emitted map, summarized for the run log, the listings and the verb check. */
export interface MapDatConversion {
  /** The map's slug id, the same key as its `map.cif` `MapInfo`. */
  readonly id: string;
  /** The terrain and script documents' `mapDocumentsFingerprint`. */
  readonly fingerprint: string;
  readonly width: number;
  readonly height: number;
  /** The terrain JSON's path relative to `outDir`. */
  readonly output: string;
  /** Whether the authored `minimap.pcx` picture was decoded into `maps/<id>.png`. */
  readonly picture: boolean;
  /** Whether a terrain minimap was rasterized from the decoded cells into `maps/<id>.map.png`. */
  readonly minimap: boolean;
  /** The suffixes of the briefing voices written as `maps/<id><suffix>`. */
  readonly voices: readonly string[];
  /** The emitted `maps/<id>.meta.json`. */
  readonly meta: MapMeta;
  /** The emitted `maps/<id>.script.json`, when the map ships a decodable script. */
  readonly script?: MapScript;
  /** Whether a `maps/<id>.briefing.json` mission-window text sidecar was emitted. */
  readonly briefing: boolean;
  /** Whether a `maps/<id>.strings.json` per-language string table was emitted. */
  readonly strings: boolean;
  /** The `[StaticObjects]` verbs the decoder skipped because it does not know them, sorted. */
  readonly unknownStaticVerbs: readonly string[];
  /** The raw `map.dat`'s SHA-256, the name its translation overlays are filed under. */
  readonly datDigest: string;
  /** What became of each language's translation overlays filed under `datDigest`. */
  readonly overlays: readonly MapOverlayOutcome[];
}

/**
 * Fails the run when any converted map carries a `[StaticObjects]` verb the decoder does not know, so a
 * verb the corpus gains is decoded or named as one the original skips rather than dropped silently.
 */
export function assertStaticVerbsKnown(maps: readonly MapDatConversion[]): void {
  const unknown = maps.filter((m) => m.unknownStaticVerbs.length > 0);
  if (unknown.length === 0) return;
  const list = unknown.map((m) => `${m.id} (${m.unknownStaticVerbs.join(', ')})`).join('; ');
  throw new Error(`[StaticObjects] verbs the decoder does not know: ${list}`);
}

/** The run-log and listings summary of one converted map. */
export function summarizeConversion(map: ConvertedMap): MapDatConversion {
  return {
    id: map.id,
    fingerprint: map.index.fingerprint,
    width: map.terrain.width,
    height: map.terrain.height,
    output: `${MAPS_DIR}/${map.id}.json`,
    picture: map.picture !== undefined,
    minimap: map.minimap !== undefined,
    voices: [...map.voices.keys()],
    meta: map.meta,
    ...(map.script === undefined ? {} : { script: map.script }),
    briefing: map.briefing !== undefined,
    strings: map.strings !== undefined,
    unknownStaticVerbs: map.unknownStaticVerbs,
    datDigest: map.datDigest,
    overlays: map.overlays,
  };
}

/** Every map folder file under the base data root, read through the corrections as the maps stage reads
 *  it; `include` narrows the lower-cased paths read. */
export async function readBaseMapTree(
  roots: SourceRoots,
  include: (path: string) => boolean = () => true,
): Promise<MapTree> {
  const found = await collectSourceFiles(roots, (path) => isMapTreePath(path) && include(path));
  const pathByRel = new Map(found.map(({ rel, path }) => [rel, path]));
  return treeFromFolder(
    found.map(({ rel }) => rel),
    (rel) => readSourceFile(roots, pathByRel.get(rel) ?? join(roots.data, rel)),
    NO_IMPORT_LIMITS,
  );
}

/**
 * Converts every map folder under the mod root into `<outDir>/maps/<id>.*` and its briefing pictures
 * into `gui/hypertext/`, in path-sorted order so a re-run is reproducible. The map files are read
 * through the corrections, their decoded strings through the map-string corrections, then the
 * translation overlays; a source-language overlay applies to a community map only. Two folders with
 * one slug write one id, last write wins, sidecars included. A `map.dat` that fails to decode is
 * logged and skipped; a write failure and a missing mod root propagate.
 */
export async function convertMapDatTree(
  roots: SourceRoots,
  outDir: string,
  synthesizeMinimap?: (terrain: MapDatTerrainFile) => Promise<Uint8Array | undefined>,
): Promise<MapDatConversion[]> {
  const tree = await readBaseMapTree(roots);
  // This stage is the only writer under <outDir>/maps, so a wholesale reset is safe.
  await rm(join(outDir, MAPS_DIR), { recursive: true, force: true });
  const folders = findMapFolders(tree);
  const stringCorrections = roots.mapStringCorrections;
  const done: MapDatConversion[] = [];
  for (const [index, key] of folders.entries()) {
    // The provenance reads the folder path case-folded, so the lower-cased key classifies it alike.
    const overlays = mapOverlaySource(roots, takesSourceLanguageOverlays(key));
    let map: ConvertedMap;
    try {
      map = await convertMapFolder(
        tree,
        key,
        {
          provenance: mapProvenanceKind,
          limits: NO_IMPORT_LIMITS,
          ...(roots.corrections === undefined
            ? {}
            : {
                correctCifLines: roots.corrections.correctCifLines,
                correctObjects: roots.corrections.correctObjects,
                shippedFile: roots.corrections.shipped,
              }),
          ...(synthesizeMinimap === undefined ? {} : { minimap: synthesizeMinimap }),
          ...(stringCorrections === undefined
            ? {}
            : { correctStrings: (id, tables) => correctMapStrings(stringCorrections, id, tables) }),
          ...(overlays === undefined ? {} : { overlays }),
          onWarning: (message) => console.warn(`[pipeline] ${message}`),
        },
        { index, total: folders.length },
      );
      map = withAuthoredForm(map);
    } catch (err) {
      // A pack map's own additions file is ours to keep valid: a broken one fails the build.
      if (!(err instanceof MapImportError) || tree.files.has(`${key}/${MAP_ADDITIONS_FILE}`)) throw err;
      console.warn(`[pipeline] skipped map.dat ${err.message}`);
      continue;
    }
    // A same-id twin converted earlier this run may have emitted files this one lacks.
    for (const name of mapFileNames(map.id)) await rm(join(outDir, MAPS_DIR, name), { force: true });
    for (const [name, data] of mapFiles(map)) await writeFileWithParents(join(outDir, MAPS_DIR, name), data);
    await writePagePictures(outDir, map.pictures);
    done.push(summarizeConversion(map));
  }
  return done;
}
