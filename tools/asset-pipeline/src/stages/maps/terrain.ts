import { TRANSITION_NONE, TRANSITION_PAIRS } from '@open-northland/data';
import type { MapStaticObjects } from '../../decoders/ini.js';
import {
  decodeMapDat,
  decodeMapSize,
  decodeStringListChunk,
  findChunk,
  lmltToTerrainMap,
  type MapDat,
  type MapDatSize,
  type MapDatTerrainMap,
  unpackMapLayer,
  unpackX6elLayer,
} from '../../decoders/mapdat/index.js';
import { errorMessage } from '../../errors.js';

/** The emitted `maps/<id>.json` shape: the sim grid + the optional 1:1 render layers. */
export interface MapDatTerrainFile extends MapDatTerrainMap {
  /** Per-triangle ground patterns (`empa`/`empb` lanes joined through the `eapd` name dictionary). */
  readonly ground?: {
    readonly patterns: string[];
    readonly a: number[];
    readonly b: number[];
  };
  /** Per-triangle transition overlays (`emt1..emt4` lanes + the `eatd` name dictionary, verbatim). */
  readonly transitions?: {
    readonly types: string[];
    readonly a1: number[];
    readonly b1: number[];
    readonly a2: number[];
    readonly b2: number[];
  };
  /** Placed landscape objects (`emla` half-cell lane joined through the `eald` name dictionary). */
  readonly objects?: {
    readonly types: string[];
    readonly placements: number[];
    readonly levels?: number[];
  };
  /** Per-cell terrain height (`lmhe` lane, one byte per cell, 0..250 observed); omitted when the map lacks it. */
  readonly elevation?: number[];
  /** Per-cell baked brightness (`embr` lane, one byte per cell, 127 = neutral); omitted when the map lacks it. */
  readonly brightness?: number[];
  /** Per-cell `lmms` band (the lane collapsed to the cell-centre node; observed values 0..7,
   *  semantics unconfirmed — see {@link shoreFromMapDat}); omitted when the map lacks it. */
  readonly shore?: number[];
  /** Authored entity placements (the sibling `map.cif`'s `StaticObjects` verbs, names verbatim). */
  readonly entities?: MapStaticObjects;
}

/** The `emla` lane's "no object here" sentinel (u16 max). */
const EMLA_EMPTY = 0xffff;

/** One decoded `map.dat`: the chunk container + its `lsiz` grid dims, decoded once and threaded to every lane helper. */
interface DecodedMap {
  readonly map: MapDat;
  readonly size: MapDatSize;
}

/** A compacted dictionary: the used names in ascending source-id order + the old-id → new-index remap. */
interface CompactedDictionary {
  readonly names: string[];
  readonly indexById: ReadonlyMap<number, number>;
}

/**
 * Compacts a lane's dictionary: collect the ids the lanes actually use, order them ascending, and
 * remap them onto a dense list of names. Ascending source-id order is load-bearing — it is the
 * emitted layer's join key onto the extracted tables, so a re-run stays byte-identical. `skip` is the
 * lane's empty sentinel, if it has one. Throws (`mapdat:` prefix) on an id outside `names`.
 */
function compactDictionary(
  lanes: readonly Iterable<number>[],
  names: readonly string[],
  what: { readonly lane: string; readonly noun: string; readonly dict: string; readonly skip?: number },
): CompactedDictionary {
  const used = new Set<number>();
  for (const lane of lanes) {
    for (const v of lane) if (v !== what.skip) used.add(v);
  }
  const indexById = new Map<number, number>();
  const compacted: string[] = [];
  for (const id of [...used].sort((x, y) => x - y)) {
    const name = names[id];
    if (name === undefined) {
      throw new Error(
        `mapdat: ${what.lane} ${what.noun} id ${id} outside the ${names.length}-entry ${what.dict} dictionary`,
      );
    }
    indexById.set(id, compacted.length);
    compacted.push(name);
  }
  return { names: compacted, indexById };
}

/**
 * Decodes the `empa`/`empb` per-cell ground-pattern lanes + the `eapd` pattern-name dictionary into
 * the emitted `ground` layer: each cell's two triangles as indices into a compacted per-map
 * pattern-name list (only the names the map actually uses, in ascending dictionary order — a
 * deterministic remap). The u16 lane values index `eapd` positionally; the emitted layer carries the
 * names (the engine's version-robust join key onto the extracted `GfxPattern` table). Returns
 * undefined when the map lacks any of the three chunks (older/foreign saves); throws on an index
 * outside the dictionary (a corrupt lane — {@link mapDatToTerrain} catches per layer and emits the
 * grid without it).
 */
function groundFromMapDat({ map, size }: DecodedMap): MapDatTerrainFile['ground'] {
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
  const { names: patterns, indexById } = compactDictionary([laneA, laneB], names, {
    lane: 'empa/empb',
    noun: 'pattern',
    dict: 'eapd',
  });
  const a = new Array<number>(cells);
  const b = new Array<number>(cells);
  for (let i = 0; i < cells; i++) {
    a[i] = indexById.get(laneA[i] as number) as number;
    b[i] = indexById.get(laneB[i] as number) as number;
  }
  return { patterns, a, b };
}

/**
 * Decodes the `emt1..emt4` per-cell transition-overlay lanes + the `eatd` transition-name
 * dictionary into the emitted `transitions` layer. Each lane is one u8 per cell (row-major,
 * length === width·height — same resolution as `empa`/`empb`, confirmed on the real maps);
 * `255` = no overlay, `v < 255` selects transition `⌊v/6⌋` from the dictionary and pair variant
 * `v % 6` of its six UV pairs. The lanes and the dictionary are carried verbatim (no compaction —
 * the ⌊v/6⌋ join is positional, and re-encoding packed values could collide with the 255 sentinel).
 * Lane semantics: source basis in docs/SOURCES.md "terrain tessellation". Returns undefined when the
 * map lacks any of the five chunks; throws on a length mismatch or an out-of-dictionary value (a
 * corrupt lane — caught per layer by {@link mapDatToTerrain}).
 */
function transitionsFromMapDat({ map, size }: DecodedMap): MapDatTerrainFile['transitions'] {
  const eatd = findChunk(map, 'eatd');
  if (eatd === undefined) return undefined;
  const cells = size.width * size.height;
  const types = decodeStringListChunk(eatd);
  const decodeLane = (tag: string): number[] | undefined => {
    const chunk = findChunk(map, tag);
    if (chunk === undefined) return undefined;
    const lane = unpackMapLayer(chunk).cells;
    if (lane.length !== cells) {
      throw new Error(`mapdat: ${tag} lane has ${lane.length} cells, expected ${cells}`);
    }
    for (const v of lane) {
      if (v !== TRANSITION_NONE && Math.floor(v / TRANSITION_PAIRS) >= types.length) {
        throw new Error(
          `mapdat: ${tag} value ${v} references transition ${Math.floor(v / TRANSITION_PAIRS)} outside the ${types.length}-entry eatd dictionary`,
        );
      }
    }
    return Array.from(lane);
  };
  // Naming the four lanes proves the arity by construction (no tuple cast); any missing lane omits the layer.
  const a1 = decodeLane('emt1');
  const b1 = decodeLane('emt2');
  const a2 = decodeLane('emt3');
  const b2 = decodeLane('emt4');
  if (a1 === undefined || b1 === undefined || a2 === undefined || b2 === undefined) return undefined;
  return { types, a1, b1, a2, b2 };
}

/**
 * Decodes the `emla` half-cell landscape-object lane + the `eald` object-name dictionary into the
 * emitted `objects` layer: a sparse flat `[hx, hy, typeIndex]` triple list (row-major half-cell scan
 * order — deterministic) over a compacted per-map type-name list (ascending dictionary order). This is
 * every pre-placed tree/stone/bush/mine decal/wave the map ships; a name joins onto the extracted
 * `[GfxLandscape]` table (`LandscapeGfx.editName`). The sibling `lmlv` byte lane carries each
 * placement's level — 1-based, counting up from the lowest state (level 1 = sapling/dregs, level N =
 * full-grown/full/intact) onto the record's highest-first `GfxFrames` lists, so consumers map
 * `index = N − level` (a wall's `100` sentinel = intact) — emitted as a parallel `levels` array
 * (omitted when the map lacks the lane). Returns undefined when the map lacks either object chunk;
 * throws on an index outside the dictionary (corrupt lane — caught per layer by {@link mapDatToTerrain}).
 */
function objectsFromMapDat({ map, size }: DecodedMap): MapDatTerrainFile['objects'] {
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
  const { names: types, indexById } = compactDictionary([lane], names, {
    lane: 'emla',
    noun: 'object',
    dict: 'eald',
    skip: EMLA_EMPTY,
  });
  const placements: number[] = [];
  const levels: number[] = [];
  for (let hy = 0; hy < hh; hy++) {
    for (let hx = 0; hx < hw; hx++) {
      const i = hy * hw + hx;
      const v = lane[i] as number;
      if (v === EMLA_EMPTY) continue;
      placements.push(hx, hy, indexById.get(v) as number);
      if (stateLane !== undefined) levels.push(stateLane[i] as number);
    }
  }
  return stateLane !== undefined ? { types, placements, levels } : { types, placements };
}

/**
 * Decodes the `lmhe` height lane into the emitted `elevation` layer: the raw per-cell terrain height,
 * one byte per cell (row-major, unpacked length === width·height — not the `2W × 2H` half-cell
 * resolution the landscape-object lanes carry; confirmed empirically across the real maps, values
 * 0..250 — an observed ceiling across the corpus). Returns undefined when the map lacks the lane
 * (older/foreign saves); throws on a dims/length mismatch (a corrupt layer — caught per layer by
 * {@link mapDatToTerrain}, which then emits the grid without it). Carried through verbatim, mirroring
 * `objects.levels`; consumed by the render's `TILE_HALF_H/32` elevation lift
 * (`packages/render/src/data/elevation.ts`).
 */
function elevationFromMapDat(decoded: DecodedMap): MapDatTerrainFile['elevation'] {
  return perCellLaneFromMapDat(decoded, 'lmhe', 'height');
}

/**
 * Decodes the `embr` brightness lane into the emitted `brightness` layer: the baked per-cell shading
 * plane, one byte per cell like `lmhe` (row-major, unpacked length === width·height — confirmed on the
 * real maps, e.g. the 250×200 bridge map unpacks to exactly 50 000). 127 is the neutral value (flat
 * lit ground); lower values are baked slope shadow, higher baked slope light (up to 255 ≈ 2×), and the
 * map's outermost 2–3 rows/columns hold 0 — the engine's fade-to-black border is in the lane (the
 * corpus shots' border cells are black). Carried through verbatim, mirroring `elevation`; the
 * render-side response curve (luminance × brightness/127, calibrated against the corpus) lives in
 * `packages/render/src/data/brightness.ts`. Returns undefined when the map lacks the lane; throws on a
 * dims/length mismatch (caught per layer by {@link mapDatToTerrain}).
 */
function brightnessFromMapDat(decoded: DecodedMap): MapDatTerrainFile['brightness'] {
  return perCellLaneFromMapDat(decoded, 'embr', 'brightness');
}

/**
 * Decodes the `lmms` lane into the emitted `shore` layer. Unlike `lmhe`/`embr` the lane is HALF-CELL
 * resolution (2W × 2H, like `emla` — verified by unpacked length; observed byte values 0..7 across
 * the owned corpus). The band SEMANTICS are unconfirmed — it is NOT a water mask (waterless maps
 * carry the same 1..7 bands, and band 7 sits mostly under land patterns on river maps; probed
 * 2026-07-16), so no renderer consumes it yet — it is carried for the shore-foam follow-up
 * (`docs/tickets/features/water-fx-and-shore.md`). Collapsed to one value per cell by sampling each
 * cell's CENTRE node (`(2x + (y&1), 2y)` — the vertex the ground mesh bakes for the cell), matching
 * the per-cell resolution of the other render lanes (a named approximation that halves the lane's
 * resolution). Returns undefined when the map lacks the lane; throws on a length mismatch (caught by
 * {@link mapDatToTerrain}).
 */
function shoreFromMapDat({ map, size }: DecodedMap): MapDatTerrainFile['shore'] {
  const chunk = findChunk(map, 'lmms');
  if (chunk === undefined) return undefined;
  const lane = unpackMapLayer(chunk).cells;
  const hw = size.width * 2;
  const expected = hw * size.height * 2;
  if (lane.length !== expected) {
    throw new Error(
      `mapdat: lmms shore lane has ${lane.length} half-cells, expected ${expected} (${size.width}×${size.height} × 4)`,
    );
  }
  const out = new Array<number>(size.width * size.height);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      out[y * size.width + x] = lane[2 * y * hw + 2 * x + (y & 1)] as number;
    }
  }
  return out;
}

/**
 * The shared per-cell byte-lane decode both wrappers above ride: unpack the tagged `X8el` chunk and
 * carry it verbatim, enforcing the one structural invariant these lanes share — one byte per cell
 * (row-major, unpacked length === width·height, not the `2W × 2H` half-cell resolution the
 * landscape-object lanes use). Returns undefined when the map lacks the chunk (older/foreign saves);
 * throws on a dims/length mismatch (caught per layer by {@link mapDatToTerrain}).
 */
function perCellLaneFromMapDat({ map, size }: DecodedMap, tag: string, label: string): number[] | undefined {
  const chunk = findChunk(map, tag);
  if (chunk === undefined) return undefined;
  const cells = unpackMapLayer(chunk).cells;
  const expected = size.width * size.height;
  if (cells.length !== expected) {
    throw new Error(
      `mapdat: ${tag} ${label} lane has ${cells.length} cells, expected ${expected} (${size.width}×${size.height}, per-cell)`,
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
 * ({@link objectsFromMapDat}: `emla` + `eald`). The decoders stay pure; this is the only wiring.
 * Throws a `mapdat:`-prefixed error for a non-container or a missing/corrupt `lsiz`/`lmlt` (the sim
 * grid is mandatory; `convertMapDatTree` catches per-file); a corrupt optional render lane is caught
 * per layer here (warn + emit the grid without it), so a map whose nav grid decodes fine never
 * disappears over its enrichments. The `lmhe` height lane rides as the `elevation` layer
 * ({@link elevationFromMapDat}), `embr` as `brightness` ({@link brightnessFromMapDat}), and
 * `emt1..emt4` as `transitions` ({@link transitionsFromMapDat}) — each consumed by the matching
 * render-side layer.
 */
export function mapDatToTerrain(bytes: Uint8Array): MapDatTerrainFile {
  const map = decodeMapDat(bytes);
  const size = decodeMapSize(map);
  const lmlt = findChunk(map, 'lmlt');
  if (lmlt === undefined) {
    throw new Error('mapdat: no lmlt landscape-type chunk (cannot build the terrain grid)');
  }
  const terrain = lmltToTerrainMap(unpackMapLayer(lmlt), size);
  const decoded: DecodedMap = { map, size };
  // The render layers are optional enrichments: a corrupt lane degrades to a grid-only artifact
  // (warn + omit) rather than dropping the whole map. `lanes` is the pre-pluralized noun phrase naming
  // the failed lane(s) in the shared warning.
  const tryLayer = <T>(lanes: string, build: () => T): T | undefined => {
    try {
      return build();
    } catch (err) {
      console.warn(
        `[pipeline] map ${lanes} unreadable, emitting grid without that layer: ${errorMessage(err)}`,
      );
      return undefined;
    }
  };
  const ground = tryLayer('ground lanes', () => groundFromMapDat(decoded));
  const transitions = tryLayer('transition lanes', () => transitionsFromMapDat(decoded));
  const objects = tryLayer('object lanes', () => objectsFromMapDat(decoded));
  const elevation = tryLayer('elevation lane', () => elevationFromMapDat(decoded));
  const brightness = tryLayer('brightness lane', () => brightnessFromMapDat(decoded));
  const shore = tryLayer('shore lane', () => shoreFromMapDat(decoded));
  return {
    ...terrain,
    ...(ground !== undefined ? { ground } : {}),
    ...(transitions !== undefined ? { transitions } : {}),
    ...(objects !== undefined ? { objects } : {}),
    ...(elevation !== undefined ? { elevation } : {}),
    ...(brightness !== undefined ? { brightness } : {}),
    ...(shore !== undefined ? { shore } : {}),
  };
}
