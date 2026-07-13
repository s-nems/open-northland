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
 * Decodes the `emt1..emt4` per-cell transition-overlay lanes + the `eatd` transition-name
 * dictionary into the emitted `transitions` layer. Each lane is one u8 PER CELL (row-major,
 * length === width·height — same resolution as `empa`/`empb`, confirmed on the real maps);
 * `255` = no overlay, `v < 255` selects transition `⌊v/6⌋` from the dictionary and pair variant
 * `v % 6` of its six UV pairs. The lanes and the dictionary are carried VERBATIM (no compaction —
 * the ⌊v/6⌋ join is positional, and re-encoding packed values would risk colliding with the 255
 * sentinel). Lane semantics: source basis in docs/SOURCES.md "terrain tessellation". Returns
 * undefined when the map lacks any of the five chunks; throws on a length mismatch or an
 * out-of-dictionary value (a corrupt lane — caught per LAYER by {@link mapDatToTerrain}).
 */
function transitionsFromMapDat(map: MapDat, size: MapDatSize): MapDatTerrainFile['transitions'] {
  const eatd = findChunk(map, 'eatd');
  if (eatd === undefined) return undefined;
  const laneTags = ['emt1', 'emt2', 'emt3', 'emt4'] as const;
  const lanes: number[][] = [];
  const cells = size.width * size.height;
  const types = decodeStringListChunk(eatd);
  for (const tag of laneTags) {
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
    lanes.push(Array.from(lane));
  }
  const [a1, b1, a2, b2] = lanes as [number[], number[], number[], number[]];
  return { types, a1, b1, a2, b2 };
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
 * then emits the grid without it). Carried through verbatim, mirroring `objects.levels`; consumed by
 * the render's elevation lift (≈1.24 native px/unit, MEASURED — see source basis "projection";
 * `packages/render/src/data/elevation.ts`).
 */
function elevationFromMapDat(map: MapDat, size: MapDatSize): MapDatTerrainFile['elevation'] {
  return perCellLaneFromMapDat(map, size, 'lmhe', 'height');
}

/**
 * Decodes the `embr` brightness lane into the emitted `brightness` layer: the baked per-cell shading
 * plane, one byte PER CELL like `lmhe` (row-major, unpacked length === width·height — confirmed on the
 * real maps, e.g. the 250×200 bridge map unpacks to exactly 50 000). 127 is the neutral value (flat
 * lit ground); lower values are baked slope shadow, higher baked slope light (up to 255 ≈ 2×), and the
 * map's outermost 2–3 rows/columns hold 0 — the engine's fade-to-black border is IN the lane (verified:
 * the corpus shots' border cells are literally black, and ~all of the bridge map's 2 323 zero cells
 * are that frame). Carried through verbatim, mirroring `elevation`; the render-side response curve
 * (luminance × brightness/127, calibrated against the corpus) lives in
 * `packages/render/src/data/brightness.ts`. Returns undefined when the map lacks the lane; throws on a
 * dims/length mismatch (caught per LAYER by {@link mapDatToTerrain}).
 */
function brightnessFromMapDat(map: MapDat, size: MapDatSize): MapDatTerrainFile['brightness'] {
  return perCellLaneFromMapDat(map, size, 'embr', 'brightness');
}

/**
 * The shared per-cell byte-lane decode both wrappers above ride: unpack the tagged `X8el` chunk and
 * carry it VERBATIM, enforcing the one structural invariant these lanes share — one byte PER CELL
 * (row-major, unpacked length === width·height, NOT the `2W × 2H` half-cell resolution the
 * landscape-object lanes use). Returns undefined when the map lacks the chunk (older/foreign saves);
 * throws on a dims/length mismatch (caught per LAYER by {@link mapDatToTerrain}).
 */
function perCellLaneFromMapDat(
  map: MapDat,
  size: MapDatSize,
  tag: string,
  label: string,
): number[] | undefined {
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
 * Throws a `mapdat:`-prefixed error for a non-container or a missing/corrupt
 * `lsiz`/`lmlt` (the sim grid is mandatory; `convertMapDatTree` catches per-file); a corrupt
 * OPTIONAL render lane is caught per layer here (warn + emit the grid without it), so a map whose nav
 * grid decodes fine never disappears over its enrichments. The `lmhe` height lane rides along as the
 * per-cell `elevation` layer ({@link elevationFromMapDat}) — consumed render-side by the elevation
 * lift (`packages/render/src/data/elevation.ts`) — and the `embr` baked-shading lane as the per-cell
 * `brightness` layer ({@link brightnessFromMapDat}) — consumed by the ground's per-fragment
 * shading (`packages/render/src/data/brightness.ts`). The `emt1..emt4` transition-overlay lanes
 * ride as the `transitions` layer ({@link transitionsFromMapDat}) — consumed by the render's
 * per-triangle transition compositing.
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
  // lanes existed and must keep doing so. `noun`/`plural` name the failed lane(s) in the shared warning.
  const tryLayer = <T>(noun: string, plural: boolean, build: () => T): T | undefined => {
    try {
      return build();
    } catch (err) {
      const lanes = plural ? 'lanes' : 'lane';
      const pronoun = plural ? 'them' : 'it';
      console.warn(
        `[pipeline] map ${noun} ${lanes} unreadable, emitting grid without ${pronoun}: ${(err as Error).message}`,
      );
      return undefined;
    }
  };
  const ground = tryLayer('ground', true, () => groundFromMapDat(map, size));
  const transitions = tryLayer('transition', true, () => transitionsFromMapDat(map, size));
  const objects = tryLayer('object', true, () => objectsFromMapDat(map, size));
  const elevation = tryLayer('elevation', false, () => elevationFromMapDat(map, size));
  const brightness = tryLayer('brightness', false, () => brightnessFromMapDat(map, size));
  return {
    ...terrain,
    ...(ground !== undefined ? { ground } : {}),
    ...(transitions !== undefined ? { transitions } : {}),
    ...(objects !== undefined ? { objects } : {}),
    ...(elevation !== undefined ? { elevation } : {}),
    ...(brightness !== undefined ? { brightness } : {}),
  };
}
