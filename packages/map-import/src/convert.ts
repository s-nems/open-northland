import {
  type MapBriefing,
  type MapMeta,
  type MapProvenance,
  type MapScript,
  MapStrings,
  type MapsIndexEntry,
  mapDocumentsFingerprint,
} from '@open-northland/data';
import type { CifDecodeBudget, CifDecodeLimits } from '@open-northland/formats/cif';
import type { HypertextBudget } from '@open-northland/formats/hypertext';
import {
  cifBytesToSections,
  extractStaticObjects,
  iniBytesToSections,
  type RuleSection,
} from '@open-northland/formats/ini';
import { DecodeLimitError } from '@open-northland/formats/limit';
import { cutsceneIdsOf, type ResolvedBriefing, resolveMapBriefing } from './briefing.js';
import { errorMessage, MapImportError } from './errors.js';
import { type MapFolder, mapFolderOf } from './folder.js';
import { findMapFolders, mapIdFromFolderName } from './folders.js';
import { mapsIndexEntry } from './index-entry.js';
import { MAP_CIF_FILE, MAP_DAT_FILE, PICTURE_PATH, STATIC_OBJECT_FILES } from './layout.js';
import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from './limits.js';
import { loadMapStringTables, type MapStringTables, resolveMapMeta } from './meta.js';
import { minimapToPng } from './minimap.js';
import { resolveMapScript } from './script.js';
import { type MapDatTerrainFile, mapDatToTerrain } from './terrain/index.js';
import type { MapTree } from './tree.js';
import { resolveBriefingVoices } from './voices.js';

export type MapProvenanceKind = MapProvenance['kind'];

/** Stands in for the folder name of a map at the tree root when the caller names none. */
export const DEFAULT_ROOT_NAME = 'map';

/** The steps one map goes through, reported in this order. */
export type ConvertStage =
  | 'terrain'
  | 'entities'
  | 'strings'
  | 'meta'
  | 'script'
  | 'briefing'
  | 'picture'
  | 'minimap';

export interface ConvertProgress {
  /** The spelled folder path of the map being converted. */
  readonly folder: string;
  /** The map's position among the tree's map folders, from 0. */
  readonly index: number;
  readonly total: number;
  readonly stage: ConvertStage;
}

export interface ConvertOptions {
  /** Shared expansion budget across the pack, including picture discovery. */
  readonly hypertextBudget?: HypertextBudget;
  readonly cifBudget?: CifDecodeBudget;
  /** Classifies each map by its spelled folder path; a plain kind applies to every map. */
  readonly provenance: MapProvenanceKind | ((folder: string) => MapProvenanceKind);
  /** The folder name a map at the tree root goes by, such as the archive's name. */
  readonly rootName?: string;
  /** Rasterizes the menu minimap from the decoded terrain; without it no minimap is produced. */
  readonly minimap?: (terrain: MapDatTerrainFile) => Promise<Uint8Array | undefined>;
  /** Rewrites the decoded string tables of map `id` before the meta, script and sidecar read them. */
  readonly correctStrings?: (id: string, tables: MapStringTables) => MapStringTables;
  readonly onProgress?: (progress: ConvertProgress) => void;
  /** Recoverable problems: an unreadable optional file or layer, which the map then goes without. */
  readonly onWarning?: (message: string) => void;
  /** Bounds on what the decoders build; defaults to {@link DEFAULT_IMPORT_LIMITS}. */
  readonly limits?: Pick<ImportLimits, 'cells' | 'picturePixels'> &
    Partial<
      Pick<
        ImportLimits,
        | 'totalCells'
        | 'hypertextCharacters'
        | 'totalHypertextCharacters'
        | 'cifDecodeUnits'
        | 'totalCifDecodeUnits'
      >
    >;
}

/** One converted map: the documents and pictures the content tree serves for it. */
export interface ConvertedMap {
  /** The folder's slug, the key of every file below. */
  readonly id: string;
  /** The spelled folder path inside the tree. */
  readonly folder: string;
  /** `maps/<id>.json`. */
  readonly terrain: MapDatTerrainFile;
  /** `maps/<id>.meta.json`. */
  readonly meta: MapMeta;
  /** `maps/<id>.strings.json`, when the folder ships a string table. */
  readonly strings?: MapStrings;
  /** `maps/<id>.script.json`, when the map ships a decodable script. */
  readonly script?: MapScript;
  /** `maps/<id>.briefing.json`, when a mission result opens a page the folder ships. */
  readonly briefing?: MapBriefing;
  /** `maps/<id>.png`, the authored menu picture. */
  readonly picture?: Uint8Array;
  /** `maps/<id>.map.png`, the minimap rasterized from the terrain. */
  readonly minimap?: Uint8Array;
  /** The briefing pages' pictures by file name, served from `gui/hypertext/`. */
  readonly pictures: ReadonlyMap<string, Uint8Array>;
  /** `maps/<id><suffix>`: the briefing's spoken lines the folder ships, by `briefingVoiceSuffix`. */
  readonly voices: ReadonlyMap<string, Uint8Array>;
  /** The map's `maps-index.json` row. */
  readonly index: MapsIndexEntry;
  /** The `[StaticObjects]` verbs the decoder skipped because it does not know them, sorted. */
  readonly unknownStaticVerbs: readonly string[];
}

/** A map folder whose `map.dat` did not decode, and why. */
export interface SkippedMap {
  readonly folder: string;
  readonly message: string;
}

export interface MapTreeConversion {
  /** In spelled-path order; two folders with one slug both appear, the later one meant to win. */
  readonly maps: readonly ConvertedMap[];
  readonly skipped: readonly SkippedMap[];
}

/** Where a map sits among the tree's map folders, for progress reports. */
export interface MapPosition {
  readonly index: number;
  readonly total: number;
}

/**
 * The authored entity placements: the `map.cif`'s `StaticObjects` section, else the first plaintext
 * file that carries one. The cif's sections are returned too, since the meta and script readers fall
 * back on them.
 */
function readEntities(
  folder: MapFolder,
  onUnknownVerb: (verb: string) => void,
  cifLimits: CifDecodeLimits,
): { cifSections?: readonly RuleSection[]; entities?: MapDatTerrainFile['entities'] } {
  let cifSections: readonly RuleSection[] | undefined;
  let entities: MapDatTerrainFile['entities'];
  const cif = folder.read([MAP_CIF_FILE]);
  if (cif !== undefined) {
    try {
      cifSections = cifBytesToSections(cif, cifLimits);
      entities = extractStaticObjects(cifSections, onUnknownVerb);
    } catch (err) {
      if (err instanceof DecodeLimitError) throw err;
      // Undecodable: the entity layer is skipped.
    }
  }
  for (const file of STATIC_OBJECT_FILES) {
    if (entities !== undefined) break;
    const bytes = folder.read([file]);
    if (bytes === undefined) continue;
    try {
      entities = extractStaticObjects(iniBytesToSections(bytes), onUnknownVerb);
    } catch (err) {
      folder.warn(`${file} undecodable: ${errorMessage(err)}`);
    }
  }
  return {
    ...(cifSections === undefined ? {} : { cifSections }),
    ...(entities === undefined ? {} : { entities }),
  };
}

/** The fingerprint of the documents as `mapFiles` writes them: through JSON, which drops `undefined`. */
function servedFingerprint(terrain: MapDatTerrainFile, script: MapScript | undefined): string {
  return mapDocumentsFingerprint(JSON.parse(JSON.stringify({ map: terrain, script: script ?? null })));
}

/** A decoder's refusal of an over-limit header as the import's `too-large`; anything else unchanged. */
function limitFailure(err: unknown, where: string): unknown {
  return err instanceof DecodeLimitError ? new MapImportError('too-large', `${where}: ${err.message}`) : err;
}

/**
 * Converts the map in folder `key` (lower-cased, `''` for the root) of `tree`. Throws
 * `decode-failed` when its `map.dat` does not decode and `too-large` when a header declares more than
 * `options.limits`; every other file is optional and only warns.
 */
export async function convertMapFolder(
  tree: MapTree,
  key: string,
  options: ConvertOptions,
  position: MapPosition = { index: 0, total: 1 },
): Promise<ConvertedMap> {
  const rootName = options.rootName ?? DEFAULT_ROOT_NAME;
  const limits = options.limits ?? DEFAULT_IMPORT_LIMITS;
  const folder = mapFolderOf(tree, key, rootName, options.onWarning ?? (() => {}));
  const report = (stage: ConvertStage): void =>
    options.onProgress?.({ folder: folder.path, index: position.index, total: position.total, stage });
  const id = mapIdFromFolderName(folder.path.slice(folder.path.lastIndexOf('/') + 1));

  report('terrain');
  const dat = folder.read([MAP_DAT_FILE]);
  let terrain: MapDatTerrainFile;
  try {
    if (dat === undefined) throw new Error(`no ${MAP_DAT_FILE}`);
    terrain = mapDatToTerrain(dat, (message) => folder.warn(message), limits.cells);
  } catch (err) {
    if (err instanceof DecodeLimitError) throw limitFailure(err, folder.rel);
    throw new MapImportError('decode-failed', `${folder.rel}: ${errorMessage(err)}`);
  }

  report('entities');
  const unknownVerbs = new Set<string>();
  const cifLimits = {
    units: limits.cifDecodeUnits ?? DEFAULT_IMPORT_LIMITS.cifDecodeUnits,
    budget: options.cifBudget ?? {
      remaining: limits.totalCifDecodeUnits ?? DEFAULT_IMPORT_LIMITS.totalCifDecodeUnits,
    },
  };
  let authored: ReturnType<typeof readEntities>;
  let stringTables: MapStringTables;
  try {
    authored = readEntities(folder, (verb) => unknownVerbs.add(verb), cifLimits);
    report('strings');
    stringTables = loadMapStringTables(folder, cifLimits);
  } catch (err) {
    throw limitFailure(err, folder.rel);
  }
  if (options.correctStrings !== undefined) stringTables = options.correctStrings(id, stringTables);
  const { cifSections, entities } = authored;
  if (entities !== undefined) terrain = { ...terrain, entities };
  const unknownStaticVerbs = [...unknownVerbs].sort();
  if (unknownStaticVerbs.length > 0) {
    folder.warn(`unknown [StaticObjects] verb(s) skipped: ${unknownStaticVerbs.join(', ')}`);
  }

  const strings = Object.keys(stringTables).length > 0 ? MapStrings.parse(stringTables) : undefined;

  report('meta');
  const provenance: MapProvenance = {
    kind: typeof options.provenance === 'function' ? options.provenance(folder.path) : options.provenance,
    folder: folder.path,
  };
  const meta: MapMeta = { ...resolveMapMeta(folder, cifSections, stringTables), provenance };

  report('script');
  let script: MapScript | undefined;
  try {
    script = resolveMapScript(folder, cifSections, stringTables);
  } catch (err) {
    // A schema-invalid script degrades that map to no roster rather than aborting the batch.
    folder.warn(`script undecodable: ${errorMessage(err)}`);
  }

  report('briefing');
  const availableCharacters = Math.min(
    limits.hypertextCharacters ?? DEFAULT_IMPORT_LIMITS.hypertextCharacters,
    options.hypertextBudget?.remaining ?? Number.POSITIVE_INFINITY,
  );
  const pageBudget = { remaining: availableCharacters };
  let resolved: ResolvedBriefing | undefined;
  try {
    resolved =
      script === undefined
        ? undefined
        : await resolveMapBriefing(folder, cutsceneIdsOf(script), limits.picturePixels, pageBudget);
  } catch (err) {
    throw limitFailure(err, folder.rel);
  }

  if (options.hypertextBudget !== undefined && Number.isFinite(availableCharacters))
    options.hypertextBudget.remaining -= availableCharacters - pageBudget.remaining;

  report('picture');
  let picture: Uint8Array | undefined;
  const picturePcx = folder.read(PICTURE_PATH);
  if (picturePcx !== undefined) {
    try {
      picture = await minimapToPng(picturePcx, limits.picturePixels);
    } catch (err) {
      if (err instanceof DecodeLimitError) throw limitFailure(err, folder.rel);
      folder.warn(`minimap picture undecodable: ${errorMessage(err)}`);
    }
  }

  report('minimap');
  let minimap: Uint8Array | undefined;
  if (options.minimap !== undefined) {
    try {
      minimap = await options.minimap(terrain);
    } catch (err) {
      folder.warn(`minimap synthesis failed: ${errorMessage(err)}`);
    }
  }

  return {
    id,
    folder: folder.path,
    terrain,
    meta,
    ...(strings === undefined ? {} : { strings }),
    ...(script === undefined ? {} : { script }),
    ...(resolved === undefined ? {} : { briefing: resolved.briefing }),
    ...(picture === undefined ? {} : { picture }),
    ...(minimap === undefined ? {} : { minimap }),
    pictures: resolved?.pictures ?? new Map(),
    voices: resolved === undefined ? new Map() : resolveBriefingVoices(folder, resolved.briefing),
    index: mapsIndexEntry({
      id,
      fingerprint: servedFingerprint(terrain, script),
      meta,
      ...(script === undefined ? {} : { script }),
      picture: picture !== undefined,
      minimap: minimap !== undefined,
    }),
    unknownStaticVerbs,
  };
}

/**
 * Converts every map folder of `tree`. A folder whose `map.dat` does not decode is skipped and
 * listed; a tree without a map folder throws `no-map`, one where no map decodes `decode-failed`, and
 * one with a map over the decode limits `too-large`.
 */
export async function convertMapTree(tree: MapTree, options: ConvertOptions): Promise<MapTreeConversion> {
  const hypertextBudget = options.hypertextBudget ?? {
    remaining: options.limits?.totalHypertextCharacters ?? DEFAULT_IMPORT_LIMITS.totalHypertextCharacters,
  };
  const cifBudget = options.cifBudget ?? {
    remaining: options.limits?.totalCifDecodeUnits ?? DEFAULT_IMPORT_LIMITS.totalCifDecodeUnits,
  };
  const folders = findMapFolders(tree);
  if (folders.length === 0) throw new MapImportError('no-map', `no folder holds a ${MAP_DAT_FILE}`);
  const maps: ConvertedMap[] = [];
  const skipped: SkippedMap[] = [];
  const limits = options.limits ?? DEFAULT_IMPORT_LIMITS;
  let remainingCells = limits.totalCells ?? DEFAULT_IMPORT_LIMITS.totalCells;
  for (const [index, key] of folders.entries()) {
    try {
      const map = await convertMapFolder(
        tree,
        key,
        {
          ...options,
          hypertextBudget,
          cifBudget,
          limits: { ...limits, cells: Math.min(limits.cells, remainingCells) },
        },
        { index, total: folders.length },
      );
      remainingCells -= map.terrain.width * map.terrain.height;
      maps.push(map);
    } catch (err) {
      if (!(err instanceof MapImportError) || err.kind === 'too-large') throw err;
      const { path } = mapFolderOf(tree, key, options.rootName ?? DEFAULT_ROOT_NAME, () => {});
      skipped.push({ folder: path, message: err.message });
    }
  }
  if (maps.length === 0) {
    throw new MapImportError('decode-failed', skipped.map((s) => s.message).join('; '));
  }
  return { maps, skipped };
}
