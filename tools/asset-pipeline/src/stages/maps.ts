import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { MapInfo } from '@vinland/data';
import { decodeCifStringArray } from '../decoders/cif.js';
import {
  type MapStaticObjects,
  type SourceRef,
  cifLinesToSections,
  decodeIni,
  extractMapInfo,
  extractStaticObjects,
  extractStringTable,
  latin1ToCp1250,
  parseIniSections,
} from '../decoders/ini.js';
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
import { decodePcx, expandToRgba } from '../decoders/pcx.js';
import { encodePng } from '../decoders/png.js';
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
    readonly levels?: number[];
  };
  /** Per-cell terrain height (`lmhe` lane, one byte per cell, 0..250 observed); omitted when the map lacks it. */
  readonly elevation?: number[];
  /** Authored entity placements (the sibling `map.cif`'s `StaticObjects` verbs, names verbatim). */
  readonly entities?: MapStaticObjects;
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
 * outside the dictionary (a corrupt lane — {@link mapDatToTerrain} catches per LAYER and emits the
 * grid without it).
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
 * extracted `[GfxLandscape]` table (`LandscapeGfx.editName`). The sibling `lmlv` byte lane carries
 * each placement's LEVEL — 1-based, counting UP from the lowest state (level 1 = sapling/dregs,
 * level N = full-grown/full/intact) onto the record's highest-first `GfxFrames` lists, so consumers
 * map `index = N − level` (a wall's `100` sentinel = intact) — emitted
 * as a parallel `levels` array (omitted when the map lacks the lane). Returns undefined when the
 * map lacks either object chunk; throws on an index outside the dictionary (corrupt lane — caught
 * per layer by {@link mapDatToTerrain}).
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
  const lmlv = findChunk(map, 'lmlv');
  const stateLane = lmlv !== undefined ? unpackMapLayer(lmlv).cells : undefined;
  if (stateLane !== undefined && stateLane.length !== lane.length) {
    throw new Error(`mapdat: lmlv lane has ${stateLane.length} half-cells, expected ${lane.length}`);
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
  const levels: number[] = [];
  for (let hy = 0; hy < hh; hy++) {
    for (let hx = 0; hx < hw; hx++) {
      const i = hy * hw + hx;
      const v = lane[i] as number;
      if (v === EMLA_EMPTY) continue;
      placements.push(hx, hy, compactIndex.get(v) as number);
      if (stateLane !== undefined) levels.push(stateLane[i] as number);
    }
  }
  return stateLane !== undefined ? { types, placements, levels } : { types, placements };
}

/**
 * Decodes the `lmhe` height lane into the emitted `elevation` layer: the raw per-cell terrain height,
 * one byte PER CELL (row-major, unpacked length === width·height — NOT the `2W × 2H` half-cell
 * resolution the landscape-object lanes carry; confirmed empirically across the real maps, values
 * 0..250 — a hard observed ceiling across the full corpus). Returns undefined when the map lacks the
 * lane (older/foreign saves); throws on a
 * dims/length mismatch (a wrong/corrupt layer — caught per LAYER by {@link mapDatToTerrain}, which
 * then emits the grid without it). Carried through verbatim, mirroring `objects.levels`: the render
 * lift (≈1.24 native px/unit — see source basis "projection") lands in a later step, so nothing
 * consumes this lane yet.
 */
function elevationFromMapDat(map: MapDat, size: MapDatSize): MapDatTerrainFile['elevation'] {
  const lmhe = findChunk(map, 'lmhe');
  if (lmhe === undefined) return undefined;
  const cells = unpackMapLayer(lmhe).cells;
  const expected = size.width * size.height;
  if (cells.length !== expected) {
    throw new Error(
      `mapdat: lmhe height lane has ${cells.length} cells, expected ${expected} (${size.width}×${size.height}, per-cell)`,
    );
  }
  return Array.from(cells);
}

/**
 * Pure composition: one `map.dat`'s bytes -> the emitted `maps/<id>.json` value. Decodes the `hoix`
 * container ({@link decodeMapDat}), reads the `lsiz` grid dims ({@link decodeMapSize}), collapses the
 * `lmlt` half-cell landscape-object lane to the per-cell typeId grid ({@link lmltToTerrainMap} — the
 * `{ width, height, typeIds }` shape the sim's `buildTerrainGraph` consumes; the build tool never
 * imports `sim`), and joins the 1:1 render layers when the map carries them: the per-triangle ground
 * patterns ({@link groundFromMapDat}: `empa`/`empb` + `eapd`) and the placed landscape objects
 * ({@link objectsFromMapDat}: `emla` + `eald`). Like {@link mapCifToInfo} the decoders stay pure;
 * this is the only wiring. Throws a `mapdat:`-prefixed error for a non-container or a missing/corrupt
 * `lsiz`/`lmlt` (the sim grid is mandatory; {@link convertMapDatTree} catches per-file); a corrupt
 * OPTIONAL render lane is caught per layer here (warn + emit the grid without it), so a map whose nav
 * grid decodes fine never disappears over its enrichments. The `lmhe` height lane rides along as the
 * per-cell `elevation` layer ({@link elevationFromMapDat}) — consumed render-side by the elevation
 * lift (`packages/render/src/data/elevation.ts`). The
 * `emt3`/`emt4` overlay-pattern lanes (roads/house foundations) are still out of scope (deferred
 * render layers).
 */
export function mapDatToTerrain(bytes: Uint8Array): MapDatTerrainFile {
  const map = decodeMapDat(bytes);
  const size = decodeMapSize(map);
  const lmlt = findChunk(map, 'lmlt');
  if (lmlt === undefined) {
    throw new Error('mapdat: no lmlt landscape-type chunk (cannot build the terrain grid)');
  }
  const terrain = lmltToTerrainMap(unpackMapLayer(lmlt), size);
  // The render layers are OPTIONAL enrichments: a corrupt lane degrades to a grid-only artifact
  // (warn + omit) rather than skipping the whole map — the sim nav grid emitted fine before these
  // lanes existed and must keep doing so.
  let ground: MapDatTerrainFile['ground'];
  try {
    ground = groundFromMapDat(map, size);
  } catch (err) {
    console.warn(
      `[pipeline] map ground lanes unreadable, emitting grid without them: ${(err as Error).message}`,
    );
  }
  let objects: MapDatTerrainFile['objects'];
  try {
    objects = objectsFromMapDat(map, size);
  } catch (err) {
    console.warn(
      `[pipeline] map object lanes unreadable, emitting grid without them: ${(err as Error).message}`,
    );
  }
  let elevation: MapDatTerrainFile['elevation'];
  try {
    elevation = elevationFromMapDat(map, size);
  } catch (err) {
    console.warn(
      `[pipeline] map elevation lane unreadable, emitting grid without it: ${(err as Error).message}`,
    );
  }
  return {
    ...terrain,
    ...(ground !== undefined ? { ground } : {}),
    ...(objects !== undefined ? { objects } : {}),
    ...(elevation !== undefined ? { elevation } : {}),
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

/**
 * The emitted `maps/<id>.meta.json` sidecar: the map's menu-facing display strings, resolved to ONE
 * language (see {@link MAP_TEXT_LANGS}). Written only when the map folder carries a string table.
 */
export interface MapMetaFile {
  /** The map's display name (the string at the header's `mapnamestringid`). */
  readonly name?: string;
  /** The map's flavor/mission description (the string at `mapdescriptionstringid`). */
  readonly description?: string;
}

/**
 * Language preference for the emitted {@link MapMetaFile} (the menu shows ONE language): the
 * culturesnation mod is Polish-authored, so `pol` first, `eng` as the fallback.
 */
const MAP_TEXT_LANGS = ['pol', 'eng'] as const;

/**
 * String-table ids of the map name/description when the sibling `map.cif` header is absent or carries
 * no `misc_mapname`. Source basis: observed — every decoded shipped header keys the name at 0 and the
 * description at 1 unless it says otherwise (the tutorial/military maps carry 99/98 in their `map.cif`).
 */
const DEFAULT_NAME_STRING_ID = 0;
const DEFAULT_DESCRIPTION_STRING_ID = 1;

/** True for a "file not found" error — the one failure the map-sidecar reads treat as normal absence. */
function isFileMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Loads one map folder's string table (`<mapDir>/text/<lang>/strings.*`) as `{ <stringId>: <text> }`,
 * trying each {@link MAP_TEXT_LANGS} language in order. Per language the readable `strings.ini` is
 * preferred (golden rule #4; {@link decodeIni} already yields CP1250 text) over the encrypted
 * `strings.cif` twin (decoded latin1 by the oracle-faithful `.cif` seam, so display values are
 * re-decoded via {@link latin1ToCp1250}) — e.g. the tutorial maps ship `.cif`-only. A missing file is
 * normal absence (45 of the shipped 186 map folders have no text at all); an unreadable one warns and
 * falls through, and an empty table falls through to the next language. Returns undefined when no
 * language yields strings — the caller then emits no meta sidecar (the menu card degrades).
 */
async function loadMapStringTable(mapDir: string, rel: string): Promise<Record<number, string> | undefined> {
  for (const lang of MAP_TEXT_LANGS) {
    for (const form of ['strings.ini', 'strings.cif'] as const) {
      let bytes: Uint8Array;
      try {
        bytes = await readFile(join(mapDir, 'text', lang, form));
      } catch (err) {
        if (!isFileMissing(err)) {
          console.warn(`[pipeline] map ${rel}: text/${lang}/${form} unreadable: ${(err as Error).message}`);
        }
        continue;
      }
      let table: Record<number, string>;
      try {
        if (form === 'strings.ini') {
          table = extractStringTable(parseIniSections(decodeIni(bytes)));
        } else {
          const raw = extractStringTable(cifLinesToSections(decodeCifStringArray(bytes).lines));
          table = {};
          for (const [id, display] of Object.entries(raw)) table[Number(id)] = latin1ToCp1250(display);
        }
      } catch (err) {
        console.warn(`[pipeline] map ${rel}: text/${lang}/${form} undecodable: ${(err as Error).message}`);
        continue;
      }
      if (Object.keys(table).length > 0) return table;
    }
  }
  return undefined;
}

/** The shipped minimaps' colorkey filler (exact magenta, observed across the corpus). */
const MINIMAP_COLORKEY = { r: 0xff, g: 0x00, b: 0xff } as const;

/**
 * Decodes a map folder's `minimap/minimap.pcx` into the emitted thumbnail PNG. The shipped minimaps
 * are a fixed 350×160 canvas with the map rendered into a sub-rectangle and the rest filled with the
 * magenta {@link MINIMAP_COLORKEY} (the original engine keys it out — observed: every sampled shipped
 * minimap corner is exact 255,0,255). The colorkey becomes transparent and the image is cropped to the
 * bounding box of real pixels, so the menu card shows the map, not the filler. Throws on a malformed
 * `.pcx` or an all-filler picture — the caller warns-and-skips per map.
 */
export function minimapToPng(bytes: Uint8Array): Uint8Array {
  const { width, height, rgba } = expandToRgba(decodePcx(bytes));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (
        rgba[o] === MINIMAP_COLORKEY.r &&
        rgba[o + 1] === MINIMAP_COLORKEY.g &&
        rgba[o + 2] === MINIMAP_COLORKEY.b
      ) {
        rgba[o + 3] = 0;
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('pcx: minimap is entirely colorkey filler');
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const cropped = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const srcStart = ((y + minY) * width + minX) * 4;
    cropped.set(rgba.subarray(srcStart, srcStart + w * 4), y * w * 4);
  }
  return encodePng({ width: w, height: h, rgba: cropped });
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
 * ({@link mapIdFromPath}), so the artifact joins onto the same-folder `map.cif`'s {@link MapInfo} `id`.
 * Maps are visited in a stable (path-sorted) order so a re-run is reproducible.
 *
 * Beside each grid, two OPTIONAL menu-facing sidecars are emitted when the map folder carries them:
 * `maps/<id>.meta.json` (the display name/description — {@link MapMetaFile}, resolved through the
 * folder's `text/<lang>/strings.*` table at the header's `mapnamestringid`/`mapdescriptionstringid`)
 * and `maps/<id>.png` (the shipped `minimap/minimap.pcx` decoded to PNG — {@link minimapToPng}:
 * colorkey keyed to transparent, cropped to the real map pixels).
 * The dev server's `/maps-index` route joins them onto the map list for the main menu's cards.
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
    // The authored entity placements live in the SIBLING map.cif's `StaticObjects` section (the
    // map.dat carries only terrain + landscape lanes). Absent/undecodable cif → the terrain still
    // emits, just without the optional layer — the same per-layer degradation `ground`/`objects` get.
    // The same header also names WHICH string-table ids carry the map's name/description
    // (`misc_mapname`); a header-less map keeps the observed 0/1 defaults.
    let nameStringId: number = DEFAULT_NAME_STRING_ID;
    let descriptionStringId: number = DEFAULT_DESCRIPTION_STRING_ID;
    try {
      const cifBytes = await readFile(join(gameDir, dirname(rel), 'map.cif'));
      const sections = cifLinesToSections(decodeCifStringArray(cifBytes).lines);
      const entities = extractStaticObjects(sections);
      if (entities !== undefined) terrain = { ...terrain, entities };
      try {
        const info = extractMapInfo(sections, id, { file: rel, layer: 'base' });
        nameStringId = info.nameStringId ?? nameStringId;
        descriptionStringId = info.descriptionStringId ?? descriptionStringId;
      } catch {
        // not a full logic header (no mapsize/mapguid) — keep the default string ids
      }
    } catch {
      // no sibling map.cif (or undecodable) — entity layer skipped
    }
    const output = join('maps', `${id}.json`);
    const outPath = join(outDir, output);
    await mkdir(dirname(outPath), { recursive: true });
    // Compact JSON: the ground/object lanes are hundreds of thousands of numbers — pretty-printing
    // them one-per-line would blow the artifact up ~8×.
    await writeFile(outPath, `${JSON.stringify(terrain)}\n`);

    // Menu-facing sidecars, both optional (the menu card degrades per missing piece): the display
    // name/description from the folder's string table, and the shipped minimap as a PNG thumbnail.
    const mapDir = join(gameDir, dirname(rel));
    const strings = await loadMapStringTable(mapDir, rel);
    const name = strings?.[nameStringId];
    const description = strings?.[descriptionStringId];
    const meta = name !== undefined || description !== undefined;
    if (meta) {
      const metaFile: MapMetaFile = {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      };
      await writeFile(join(outDir, 'maps', `${id}.meta.json`), `${JSON.stringify(metaFile)}\n`);
    }
    let minimap = false;
    try {
      const png = minimapToPng(await readFile(join(mapDir, 'minimap', 'minimap.pcx')));
      await writeFile(join(outDir, 'maps', `${id}.png`), png);
      minimap = true;
    } catch (err) {
      if (!isFileMissing(err)) {
        console.warn(`[pipeline] map ${rel}: minimap undecodable: ${(err as Error).message}`);
      }
    }
    done.push({ id, width: terrain.width, height: terrain.height, output, meta, minimap });
  }
  return done;
}
