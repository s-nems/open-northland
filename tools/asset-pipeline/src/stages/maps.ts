import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { MapInfo } from '@vinland/data';
import { decodeCifStringArray } from '../decoders/cif.js';
import { type SourceRef, cifLinesToSections, extractMapInfo } from '../decoders/ini.js';
import {
  type MapDat,
  type MapDatSize,
  type MapDatTerrainMap,
  decodeMapDat,
  decodeMapSize,
  decodeStringListChunk,
  findChunk,
  lmltToTerrainMap,
  unpackMapLayer,
  unpackX6elLayer,
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

/** The emitted `maps/<id>.json` shape: the sim grid + the optional 1:1 render layers. */
export interface MapDatTerrainFile extends MapDatTerrainMap {
  /** Per-triangle ground patterns (`empa`/`empb` lanes joined through the `eapd` name dictionary). */
  readonly ground?: {
    readonly patterns: string[];
    readonly a: number[];
    readonly b: number[];
  };
  /** Placed landscape objects (`emla` half-cell lane joined through the `eald` name dictionary). */
  readonly objects?: {
    readonly types: string[];
    readonly placements: number[];
  };
}

/** The `emla` lane's "no object here" sentinel (u16 max). */
const EMLA_EMPTY = 0xffff;

/**
 * Decodes the `empa`/`empb` per-cell ground-pattern lanes + the `eapd` pattern-name dictionary into
 * the emitted `ground` layer: each cell's two triangles as indices into a **compacted** per-map
 * pattern-name list (only the names the map actually uses, in ascending dictionary order — a
 * deterministic remap). The u16 lane values index `eapd` positionally; the emitted layer carries the
 * NAMES (the engine's own version-robust join key onto the extracted `GfxPattern` table). Returns
 * undefined when the map lacks any of the three chunks (older/foreign saves); throws on an index
 * outside the dictionary (a corrupt lane — the per-file catch skips the whole map).
 */
function groundFromMapDat(map: MapDat, size: MapDatSize): MapDatTerrainFile['ground'] {
  const empa = findChunk(map, 'empa');
  const empb = findChunk(map, 'empb');
  const eapd = findChunk(map, 'eapd');
  if (empa === undefined || empb === undefined || eapd === undefined) return undefined;
  const names = decodeStringListChunk(eapd);
  const laneA = unpackX6elLayer(empa).cells;
  const laneB = unpackX6elLayer(empb).cells;
  const cells = size.width * size.height;
  if (laneA.length !== cells || laneB.length !== cells) {
    throw new Error(`mapdat: empa/empb lanes have ${laneA.length}/${laneB.length} cells, expected ${cells}`);
  }
  // Compact: collect the used dictionary ids (ascending), remap the lanes onto the compact list.
  const used = new Set<number>();
  for (const v of laneA) used.add(v);
  for (const v of laneB) used.add(v);
  const usedIds = [...used].sort((x, y) => x - y);
  const compactIndex = new Map<number, number>();
  const patterns: string[] = [];
  for (const id of usedIds) {
    const name = names[id];
    if (name === undefined) {
      throw new Error(`mapdat: empa/empb pattern id ${id} outside the ${names.length}-entry eapd dictionary`);
    }
    compactIndex.set(id, patterns.length);
    patterns.push(name);
  }
  const a = new Array<number>(cells);
  const b = new Array<number>(cells);
  for (let i = 0; i < cells; i++) {
    a[i] = compactIndex.get(laneA[i] as number) as number;
    b[i] = compactIndex.get(laneB[i] as number) as number;
  }
  return { patterns, a, b };
}

/**
 * Decodes the `emla` half-cell landscape-object lane + the `eald` object-name dictionary into the
 * emitted `objects` layer: a sparse flat `[hx, hy, typeIndex]` triple list (row-major half-cell scan
 * order — deterministic) over a **compacted** per-map type-name list (ascending dictionary order).
 * This is every pre-placed tree/stone/bush/mine decal/wave the map ships; a name joins onto the
 * extracted `[GfxLandscape]` table (`LandscapeGfx.editName`). Returns undefined when the map lacks
 * either chunk; throws on an index outside the dictionary (corrupt lane).
 */
function objectsFromMapDat(map: MapDat, size: MapDatSize): MapDatTerrainFile['objects'] {
  const emla = findChunk(map, 'emla');
  const eald = findChunk(map, 'eald');
  if (emla === undefined || eald === undefined) return undefined;
  const names = decodeStringListChunk(eald);
  const lane = unpackX6elLayer(emla).cells;
  const hw = size.width * 2;
  const hh = size.height * 2;
  if (lane.length !== hw * hh) {
    throw new Error(`mapdat: emla lane has ${lane.length} half-cells, expected ${hw * hh}`);
  }
  const used = new Set<number>();
  for (const v of lane) if (v !== EMLA_EMPTY) used.add(v);
  const usedIds = [...used].sort((x, y) => x - y);
  const compactIndex = new Map<number, number>();
  const types: string[] = [];
  for (const id of usedIds) {
    const name = names[id];
    if (name === undefined) {
      throw new Error(`mapdat: emla object id ${id} outside the ${names.length}-entry eald dictionary`);
    }
    compactIndex.set(id, types.length);
    types.push(name);
  }
  const placements: number[] = [];
  for (let hy = 0; hy < hh; hy++) {
    for (let hx = 0; hx < hw; hx++) {
      const v = lane[hy * hw + hx] as number;
      if (v === EMLA_EMPTY) continue;
      placements.push(hx, hy, compactIndex.get(v) as number);
    }
  }
  return { types, placements };
}

/**
 * Pure composition: one `map.dat`'s bytes -> the emitted `maps/<id>.json` value. Decodes the `hoix`
 * container ({@link decodeMapDat}), reads the `lsiz` grid dims ({@link decodeMapSize}), collapses the
 * `lmlt` half-cell landscape-object lane to the per-cell typeId grid ({@link lmltToTerrainMap} — the
 * `{ width, height, typeIds }` shape the sim's `buildTerrainGraph` consumes; the build tool never
 * imports `sim`), and joins the 1:1 render layers when the map carries them: the per-triangle ground
 * patterns ({@link groundFromMapDat}: `empa`/`empb` + `eapd`) and the placed landscape objects
 * ({@link objectsFromMapDat}: `emla` + `eald`). Like {@link mapCifToInfo} the decoders stay pure;
 * this is the only wiring. Throws a `mapdat:`-prefixed error for a non-container, a missing
 * `lsiz`/`lmlt`, an unsupported codec, or a dims/length mismatch; {@link convertMapDatTree} catches
 * it per-file so one bad map can't abort the batch. The `lmhe` height lane and the `emt3`/`emt4`
 * overlay-pattern lanes (roads/house foundations) are still out of scope (deferred render layers).
 */
export function mapDatToTerrain(bytes: Uint8Array): MapDatTerrainFile {
  const map = decodeMapDat(bytes);
  const size = decodeMapSize(map);
  const lmlt = findChunk(map, 'lmlt');
  if (lmlt === undefined) {
    throw new Error('mapdat: no lmlt landscape-type chunk (cannot build the terrain grid)');
  }
  const terrain = lmltToTerrainMap(unpackMapLayer(lmlt), size);
  const ground = groundFromMapDat(map, size);
  const objects = objectsFromMapDat(map, size);
  return {
    ...terrain,
    ...(ground !== undefined ? { ground } : {}),
    ...(objects !== undefined ? { objects } : {}),
  };
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
    let terrain: MapDatTerrainFile;
    try {
      terrain = mapDatToTerrain(await readFile(join(gameDir, rel)));
    } catch (err) {
      console.warn(`[pipeline] skipped map.dat ${rel}: ${(err as Error).message}`);
      continue;
    }
    const output = join('maps', `${id}.json`);
    const outPath = join(outDir, output);
    await mkdir(dirname(outPath), { recursive: true });
    // Compact JSON: the ground/object lanes are hundreds of thousands of numbers — pretty-printing
    // them one-per-line would blow the artifact up ~8×.
    await writeFile(outPath, `${JSON.stringify(terrain)}\n`);
    done.push({ id, width: terrain.width, height: terrain.height, output });
  }
  return done;
}
