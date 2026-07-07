import {
  type AtlasManifest,
  type ElevationField,
  type MapObjectSprite,
  atlasFromManifest,
  halfCellToScreen,
  loadAtlasSource,
} from '@vinland/render';
import type { LandscapeGfxRow, TerrainIr } from './terrain.js';

/**
 * The map-object binding: turn a decoded map's `objects` layer (the original's `emla` half-cell
 * placements — every tree, stone, bush, mine decal and animated wave) into the renderer's
 * {@link MapObjectSprite}s. Each placement's `EditName` joins onto the `landscapeGfx` IR table
 * (the full `[GfxLandscape]` extract) for its body atlas (`/bobs/<stem>.<palette>.*`), its frame
 * list and its animation flags; the join and the atlases both live in the gitignored `content/`,
 * so a checkout without them simply renders no objects (the caller degrades gracefully).
 */

/** The `objects` layer of a decoded `content/maps/<id>.json` (see `TerrainObjects` in @vinland/data). */
export interface MapObjectsData {
  readonly types: readonly string[];
  readonly placements: readonly number[];
  /** Per-placement 1-based LEVEL (`lmlv`), counting up from the lowest state ({@link stateIndexForLevel}). Absent → the full state. */
  readonly levels?: readonly number[] | undefined;
}

/**
 * The opacity a `GfxDynamicBackground` object (the 8 wave records) composites over the water ground
 * with — our reading of the engine's translucent blit; the exact original factor is unpinned
 * (source basis).
 */
const WAVE_ALPHA = 0.5;

/**
 * Which `GfxFrames` state list a placement's 1-based `lmlv` LEVEL picks. The level counts what
 * REMAINS/has grown — level 1 is the lowest state (sapling / near-depleted deposit / rubble wall) and
 * level N the highest (full-grown / full deposit / intact) — while the record's lists are authored
 * HIGHEST-FIRST (a tree's full-grown state first, a clay deposit's 74×51 full pile before its 32×18
 * dregs), so the index is `N − level`. Pinned by calibration-by-observation on the bridge-map corpus:
 * the north forest is `lmlv=3` throughout and the original draws it full-grown (an isolated lmlv=3
 * cypress matches the full-grown frame at 0.99 vs 0.84/0.87 for the younger states), and the deposit
 * records' big-to-small list order matches level-as-remaining (source basis "Landscape-object
 * layer"). Any out-of-range level — including the wall "intact" sentinel `100` — falls back to the
 * first (full) list. Pure.
 */
export function stateIndexForLevel(level: number, stateCount: number): number {
  return level >= 1 && level <= stateCount ? stateCount - level : 0;
}

/** One loaded body atlas: frame geometry + GPU source, keyed by `<bmd stem>.<palette>`. */
interface LoadedLayer {
  readonly frames: ReturnType<typeof atlasFromManifest>['frames'];
  readonly source: Awaited<ReturnType<typeof loadAtlasSource>>;
}

/** The `/bobs/` atlas key for a record: `<bmd basename minus .bmd>.<palette>` (the pipeline's naming). */
function atlasKeyOf(record: LandscapeGfxRow): string | null {
  if (record.bmd === undefined || record.paletteName === undefined) return null;
  const stem = (record.bmd.split('/').pop() ?? record.bmd).replace(/\.bmd$/i, '');
  return `${stem}.${record.paletteName}`;
}

/** Fetch one decoded atlas (manifest + PNG). Returns null on a 404 (partial content/). */
async function loadLayer(key: string): Promise<LoadedLayer | null> {
  const res = await fetch(`/bobs/${key}.atlas.json`);
  if (!res.ok) return null;
  const manifest = (await res.json()) as AtlasManifest;
  return {
    frames: atlasFromManifest(manifest).frames,
    source: await loadAtlasSource(`/bobs/${key}.png`),
  };
}

/**
 * Resolve every placed object into a render-ready {@link MapObjectSprite}:
 *
 *  - **frames** — the `GfxFrames` state list the placement's `lmlv` LEVEL picks
 *    ({@link stateIndexForLevel}: level 1 = lowest state, level N = full-grown/full/intact, lists
 *    authored highest-first, so index = N − level; the wall sentinel `100` and any out-of-range
 *    value fall back to the first, full list), each bob id resolved through the atlas manifest
 *    (0×0 frames dropped). A record with `loopAnimation`
 *    plays the whole list at the sim tick rate (waves, swaying trees, fire); a static record shows
 *    the list's first frame.
 *  - **decor vs tall** — an object with NO `LogicWalkBlockArea` footprint (waves, grass, flowers,
 *    mine stains) is flat ground decor and draws under the entity sprites; one WITH a footprint
 *    (trees, stones) depth-sorts against settlers by its feet anchor.
 *  - **position** — the half-cell `(hx, hy)` projected onto the plain half-cell lattice
 *    (`halfCellToScreen` — the `emla` grid the original places on; no row stagger at this level).
 *  - **phase** — 0 for every object, so the loops play IN UNISON: the wave bobs are authored to
 *    tile seamlessly with their neighbours at the SAME frame, and a per-object stagger breaks that
 *    tiling into noise (the map stores no per-object phase — source basis).
 *
 * A type that can't resolve (no record, no atlas, no usable frame) is counted + skipped — a partial
 * `content/` must degrade, not abort. Placements resolve in file order (deterministic).
 */
export async function loadMapObjects(
  objects: MapObjectsData,
  ir: TerrainIr,
  elevation?: ElevationField,
): Promise<MapObjectSprite[]> {
  const recordByName = new Map<string, LandscapeGfxRow>();
  for (const row of ir.landscapeGfx ?? []) {
    if (row.editName !== undefined && !recordByName.has(row.editName)) {
      recordByName.set(row.editName, row);
    }
  }
  // Resolve each used type once: its record, atlas layer, frame list and decor split.
  const layerKeys = new Set<string>();
  for (const type of objects.types) {
    const record = recordByName.get(type);
    const key = record !== undefined ? atlasKeyOf(record) : null;
    if (key !== null) layerKeys.add(key);
  }
  const layers = new Map<string, LoadedLayer>();
  await Promise.all(
    [...layerKeys].map(async (key) => {
      const layer = await loadLayer(key);
      if (layer !== null) layers.set(key, layer);
    }),
  );

  interface ResolvedType {
    readonly source: LoadedLayer['source'];
    readonly frames: MapObjectSprite['frames'];
    readonly decor: boolean;
    readonly alpha: number;
  }
  // One ResolvedType per (type, state list) — index [typeIndex][stateIndex]; empty lists collapse
  // to null so a placement whose state resolves nothing falls back to state 0 below.
  const resolved: (ResolvedType | null)[][] = objects.types.map((type) => {
    const record = recordByName.get(type);
    if (record === undefined) return [];
    const key = atlasKeyOf(record);
    const layer = key !== null ? layers.get(key) : undefined;
    if (layer === undefined) return [];
    return (record.frames ?? []).map((stateList) => {
      const frames = stateList.bobIds
        .map((bobId) => layer.frames.get(bobId))
        .filter((f): f is NonNullable<typeof f> => f !== undefined && f.width > 0 && f.height > 0);
      if (frames.length === 0) return null;
      const animated = record.loopAnimation === true && record.isStatic !== true && frames.length > 1;
      return {
        source: layer.source,
        frames: animated ? frames : frames.slice(0, 1),
        decor: (record.walkBlockAreas ?? []).length === 0,
        // `GfxDynamicBackground` (exactly the wave records) = the engine's translucent blit over the
        // water ground; the 50% is our reading of that blend (source basis).
        alpha: record.dynamicBackground === true ? WAVE_ALPHA : 1,
      };
    });
  });

  const out: MapObjectSprite[] = [];
  let skipped = 0;
  for (let i = 0; i + 2 < objects.placements.length; i += 3) {
    const hx = objects.placements[i] as number;
    const hy = objects.placements[i + 1] as number;
    const states = resolved[objects.placements[i + 2] as number] ?? [];
    // `lmlv` counts up from the LOWEST state (see stateIndexForLevel); absent lane → the full first list.
    const level = objects.levels?.[i / 3] ?? states.length;
    const stateIndex = stateIndexForLevel(level, states.length);
    const type = states[stateIndex] ?? states[0];
    if (type === null || type === undefined) {
      skipped++;
      continue;
    }
    const screen = halfCellToScreen(hx, hy);
    // The `emla` half-cell maps to cell coordinate (hx/2, hy/2) — the sampler input. The lift is the
    // DRAW offset only; `y` (the feet anchor + depth key) stays pre-lift so objects occlude by map row.
    const lift = elevation?.liftAt(hx / 2, hy / 2) ?? 0;
    out.push({
      x: screen.x,
      y: screen.y,
      source: type.source,
      frames: type.frames,
      scale: 1,
      decor: type.decor,
      ...(lift !== 0 ? { lift } : {}),
      // A slow SPATIAL phase GRADIENT (`hx + hy`), not a uniform phase: adjacent half-cells stay within
      // one animation frame of each other (so the wave sheet still reads as continuous, no hard seam),
      // but across the sea the phase drifts, so the surface no longer pulses as ONE identical stamp — the
      // "water looks repeated too many times / unnatural" report. A traveling diagonal ripple reads as
      // moving water; the map stores no per-object phase, so this deterministic gradient is our choice
      // (source basis). Static objects (`frames.length <= 1`) ignore phase, so this only staggers the
      // looping bobs (waves, swaying trees/fire).
      phase: hx + hy,
      alpha: type.alpha,
    });
  }
  if (skipped > 0) {
    console.warn(
      `loadMapObjects: ${skipped} of ${objects.placements.length / 3} placements had no resolvable graphics`,
    );
  }
  return out;
}
