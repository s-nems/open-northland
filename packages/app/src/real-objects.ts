import {
  type AtlasManifest,
  type MapObjectSprite,
  atlasFromManifest,
  loadAtlasSource,
  tileToScreen,
} from '@vinland/render';
import type { LandscapeGfxRow, TerrainIr } from './real-terrain.js';

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
}

/**
 * The opacity a `GfxDynamicBackground` object (the 8 wave records) composites over the water ground
 * with — our reading of the engine's translucent blit; the exact original factor is unpinned
 * (docs/FIDELITY.md).
 */
const WAVE_ALPHA = 0.5;

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
 *  - **frames** — the record's FIRST `GfxFrames` state list (the file lists the full-grown/highest
 *    state first), each bob id resolved through the atlas manifest (0×0 frames dropped). A record
 *    with `loopAnimation` plays the whole list at the sim tick rate (waves, swaying trees, fire);
 *    a static record shows the list's first frame.
 *  - **decor vs tall** — an object with NO `LogicWalkBlockArea` footprint (waves, grass, flowers,
 *    mine stains) is flat ground decor and draws under the entity sprites; one WITH a footprint
 *    (trees, stones) depth-sorts against settlers by its feet anchor.
 *  - **position** — the half-cell `(hx, hy)` projected at half-tile resolution (`tileToScreen` of
 *    the fractional cell), the object lattice the original places on.
 *  - **phase** — 0 for every object, so the loops play IN UNISON: the wave bobs are authored to
 *    tile seamlessly with their neighbours at the SAME frame, and a per-object stagger breaks that
 *    tiling into noise (the map stores no per-object phase — docs/FIDELITY.md).
 *
 * A type that can't resolve (no record, no atlas, no usable frame) is counted + skipped — a partial
 * `content/` must degrade, not abort. Placements resolve in file order (deterministic).
 */
export async function loadMapObjects(objects: MapObjectsData, ir: TerrainIr): Promise<MapObjectSprite[]> {
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
  const resolved: (ResolvedType | null)[] = objects.types.map((type) => {
    const record = recordByName.get(type);
    if (record === undefined) return null;
    const key = atlasKeyOf(record);
    const layer = key !== null ? layers.get(key) : undefined;
    if (layer === undefined) return null;
    const stateList = record.frames?.[0];
    if (stateList === undefined) return null;
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
      // water ground; the 50% is our reading of that blend (docs/FIDELITY.md).
      alpha: record.dynamicBackground === true ? WAVE_ALPHA : 1,
    };
  });

  const out: MapObjectSprite[] = [];
  let skipped = 0;
  for (let i = 0; i + 2 < objects.placements.length; i += 3) {
    const hx = objects.placements[i] as number;
    const hy = objects.placements[i + 1] as number;
    const type = resolved[objects.placements[i + 2] as number];
    if (type === null || type === undefined) {
      skipped++;
      continue;
    }
    const screen = tileToScreen(hx / 2, hy / 2);
    out.push({
      x: screen.x,
      y: screen.y,
      source: type.source,
      frames: type.frames,
      scale: 1,
      decor: type.decor,
      // IN PHASE: the wave bobs are authored to tile seamlessly with their neighbours at the SAME
      // frame (107px sprites on a 64px lattice) — a per-object stagger breaks the tiling into
      // noise. The whole sea breathing in unison matches the original's look; the map stores no
      // per-object phase (docs/FIDELITY.md).
      phase: 0,
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
