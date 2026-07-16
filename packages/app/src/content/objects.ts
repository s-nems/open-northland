import {
  type AtlasFrame,
  type BrightnessField,
  type ElevationField,
  halfCellToScreen,
  type MapObjectSprite,
  type SpriteLayer,
} from '@open-northland/render';
import { diag } from '../diag/index.js';
import {
  type ContentIr,
  type LandscapeGfxRow,
  loadLayer,
  MissingAtlasError,
  servedAtlasStem,
  servedShadowStem,
} from './ir.js';
import { forEachPlacement } from './map-placements.js';

/**
 * The map-object binding: turn a decoded map's `objects` layer (the original's `emla` half-cell
 * placements — every tree, stone, bush, mine decal and animated wave) into the renderer's
 * {@link MapObjectSprite}s. Each placement's `EditName` joins onto the `landscapeGfx` IR table
 * (the full `[GfxLandscape]` extract) for its body atlas (`/bobs/<stem>.<palette>.*`), its frame
 * list and its animation flags; the join and the atlases both live in the gitignored `content/`,
 * so a checkout without them simply renders no objects (the caller degrades gracefully).
 */

/** The `objects` layer of a decoded `content/maps/<id>.json` (see `TerrainObjects` in @open-northland/data). */
export interface MapObjectsData {
  readonly types: readonly string[];
  readonly placements: readonly number[];
  /** Per-placement 1-based level (`lmlv`), counting up from the lowest state ({@link stateIndexForLevel}). Absent → the full state. */
  readonly levels?: readonly number[] | undefined;
}

/**
 * The `[landscapetype]` names whose objects the original draws full-bright, exempt from the baked
 * `embr` shading: standing + felled trees. Measured on the bridge-map corpus (source basis
 * "brightness"): tree canopies keep full luminance even anchored on embr=0 border cells (ratio ≈ 1.0
 * across the lane, n=118), while mine decals, stones and grass track the lane (masked opaque-pixel
 * ratio ×0.58 → ×1.58). Only standing trees were measured; `tree falling` is grouped with them by
 * kinship (same art family mid-fall), not by measurement. The true engine rule is unknown, so this
 * name-pinned exemption is the measured boundary and an approximation beyond it.
 */
const UNSHADED_LANDSCAPE_TYPES: ReadonlySet<string> = new Set(['tree', 'tree falling']);

/**
 * The logicType ids whose objects stay full-bright ({@link UNSHADED_LANDSCAPE_TYPES}), resolved from
 * the IR `[landscapetype]` table by name so no numeric id hardcodes. Pure; exported for unit tests.
 */
export function unshadedLogicTypeIds(landscape: ContentIr['landscape']): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const t of landscape ?? []) {
    if (t.typeId !== undefined && t.name !== undefined && UNSHADED_LANDSCAPE_TYPES.has(t.name)) {
      ids.add(t.typeId);
    }
  }
  return ids;
}

/**
 * Which `GfxFrames` state list a placement's 1-based `lmlv` level picks. The level counts what
 * remains/has grown — level 1 is the lowest state (sapling / near-depleted deposit / rubble wall) and
 * level N the highest (full-grown / full deposit / intact) — while the record's lists are authored
 * highest-first (a tree's full-grown state first, a clay deposit's 74×51 full pile before its 32×18
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

/** One decoded atlas via the shared {@link loadLayer} (with its optional shadow twin), a 404 (partial
 *  `content/`) degraded to null. */
async function loadLayerOrNull(key: string, shadowStem?: string): Promise<SpriteLayer | null> {
  try {
    return await loadLayer(key, shadowStem);
  } catch (err) {
    if (err instanceof MissingAtlasError) return null;
    throw err;
  }
}

/** The decoded human bone-pile records — the resting `cadaver human bones` states of `ls_skeletons.bmd`
 *  (each a single still frame). The render effects layer draws one at each death, so a battlefield leaves
 *  the same bones the original's cadaver landscape objects do (the map viewer shows them on `cn_0`). */
const HUMAN_BONES_EDIT_NAMES = ['cadaver human bones01', 'cadaver human bones02', 'cadaver human bones03'];

/**
 * Resolve the decoded human bone-pile art for the combat-feedback layer: the shared `ls_skeletons` atlas
 * page + the {@link HUMAN_BONES_EDIT_NAMES} frames. Returns `null` when the `landscapeGfx` join or its
 * atlas is absent (a checkout without `content/`), so the renderer falls back to its procedural pile. The
 * render twin of a map object's atlas binding ({@link loadMapObjects}), for a runtime-spawned mark rather
 * than a placed one.
 */
export async function loadCombatBones(
  ir: ContentIr,
): Promise<{ source: SpriteLayer['source']; frames: AtlasFrame[] } | null> {
  const rows = (ir.landscapeGfx ?? []).filter((r) => HUMAN_BONES_EDIT_NAMES.includes(r.editName ?? ''));
  const first = rows[0];
  if (first === undefined) return null;
  const key = servedAtlasStem(first);
  if (key === undefined) return null;
  const layer = await loadLayerOrNull(key);
  if (layer === null) return null;
  const frames = rows
    .map((r) => r.frames?.[0]?.bobIds[0])
    .filter((id): id is number => id !== undefined)
    .map((id) => layer.atlas.frames.get(id))
    .filter((f): f is AtlasFrame => f !== undefined);
  return frames.length > 0 ? { source: layer.source, frames } : null;
}

/**
 * Resolve every placed object into a render-ready {@link MapObjectSprite}:
 *
 *  - **frames** — the `GfxFrames` state list the placement's `lmlv` level picks
 *    ({@link stateIndexForLevel}), each bob id resolved through the atlas manifest (0×0 frames
 *    dropped). A record with `loopAnimation` plays the whole list at the sim tick rate (waves,
 *    swaying trees, fire); a static record shows the list's first frame.
 *  - **decor vs tall** — an object with no `LogicWalkBlockArea` footprint (waves, grass, flowers,
 *    mine stains) is flat ground decor and draws under the entity sprites; one with a footprint
 *    (trees, stones) depth-sorts against settlers by its feet anchor.
 *  - **position** — the half-cell `(hx, hy)` projected onto the plain half-cell lattice
 *    (`halfCellToScreen` — the `emla` grid the original places on; no row stagger at this level).
 *  - **phase** — a slow spatial gradient (`hx + hy`), so a looping bob's neighbours stay within a
 *    frame of each other (the wave sheet reads as continuous) while the surface drifts across the map
 *    instead of pulsing as one identical stamp (the map stores no per-object phase — source basis).
 *
 * A type that can't resolve (no record, no atlas, no usable frame) is counted + skipped — a partial
 * `content/` must degrade, not abort. Placements resolve in file order (deterministic).
 *
 * Returns the sprites plus a placement-ordinal → sprite map (`byPlacement`, keyed by triplet index in
 * `objects.placements`): the join the `?map=` entry uses to hand a first-worked resource node's static
 * sprite over to the live sim pool (`WorldRenderer.removeMapObject`). Every placement — harvestable or
 * decor — draws here; the sim pool skips the virgin harvestables via the static-refs set instead.
 */
export interface LoadedMapObjects {
  readonly sprites: MapObjectSprite[];
  readonly byPlacement: ReadonlyMap<number, MapObjectSprite>;
}

export async function loadMapObjects(
  objects: MapObjectsData,
  ir: ContentIr,
  elevation?: ElevationField,
  brightness?: BrightnessField,
): Promise<LoadedMapObjects> {
  const recordByName = new Map<string, LandscapeGfxRow>();
  for (const row of ir.landscapeGfx ?? []) {
    if (row.editName !== undefined && !recordByName.has(row.editName)) {
      recordByName.set(row.editName, row);
    }
  }
  // The logicType ids whose objects stay full-bright (trees — the measured exemption).
  const unshadedLogicTypes = unshadedLogicTypeIds(ir.landscape);
  // Resolve each used type once: its record, atlas layer (+ its shadow twin, keyed by the record's
  // `shadowBmd`), frame list and decor split.
  const layerKeys = new Map<string, string | undefined>();
  for (const type of objects.types) {
    const record = recordByName.get(type);
    const key = record !== undefined ? servedAtlasStem(record) : undefined;
    if (key !== undefined && !layerKeys.has(key)) {
      layerKeys.set(key, servedShadowStem(record?.shadowBmd));
    }
  }
  const layers = new Map<string, SpriteLayer>();
  await Promise.all(
    [...layerKeys].map(async ([key, shadowStem]) => {
      const layer = await loadLayerOrNull(key, shadowStem);
      if (layer !== null) layers.set(key, layer);
    }),
  );

  interface ResolvedType {
    readonly source: SpriteLayer['source'];
    readonly frames: MapObjectSprite['frames'];
    /** The cast-shadow twin frames, index-paired with {@link frames}; absent when no pose casts one. */
    readonly shadow: MapObjectSprite['shadow'];
    readonly decor: boolean;
    /** False for the tree logic types (the measured full-bright exemption — {@link UNSHADED_LANDSCAPE_TYPES}). */
    readonly shaded: boolean;
  }
  // One ResolvedType per (type, state list) — index [typeIndex][stateIndex]; empty lists collapse
  // to null so a placement whose state resolves nothing falls back to state 0 below.
  const resolved: (ResolvedType | null)[][] = objects.types.map((type) => {
    const record = recordByName.get(type);
    if (record === undefined) return [];
    const key = servedAtlasStem(record);
    const layer = key !== undefined ? layers.get(key) : undefined;
    if (layer === undefined) return [];
    return (record.frames ?? []).map((stateList) => {
      // Body + shadow resolve in one pass so the pair stays index-aligned across the 0×0-frame drops
      // (the shadow set parallels the body's bob ids; a pose without a silhouette gets `undefined`).
      const frames: MapObjectSprite['frames'][number][] = [];
      const shadowFrames: (MapObjectSprite['frames'][number] | undefined)[] = [];
      for (const bobId of stateList.bobIds) {
        const f = layer.atlas.frames.get(bobId);
        if (f === undefined || f.width <= 0 || f.height <= 0) continue;
        frames.push(f);
        const s = layer.shadow?.atlas.frames.get(bobId);
        shadowFrames.push(s !== undefined && s.width > 0 && s.height > 0 ? s : undefined);
      }
      if (frames.length === 0) return null;
      const animated = record.loopAnimation === true && record.isStatic !== true && frames.length > 1;
      const count = animated ? frames.length : 1;
      const shadowSource = layer.shadow?.source;
      const hasShadow =
        shadowSource !== undefined && shadowFrames.slice(0, count).some((s) => s !== undefined);
      return {
        source: layer.source,
        frames: frames.slice(0, count),
        shadow: hasShadow ? { source: shadowSource, frames: shadowFrames.slice(0, count) } : undefined,
        decor: (record.walkBlockAreas ?? []).length === 0,
        shaded: record.logicType === undefined || !unshadedLogicTypes.has(record.logicType),
      };
    });
  });

  const out: MapObjectSprite[] = [];
  const byPlacement = new Map<number, MapObjectSprite>();
  let skipped = 0;
  forEachPlacement(objects.placements, (hx, hy, typeIndex, placement) => {
    const states = resolved[typeIndex] ?? [];
    // `lmlv` counts up from the lowest state (see stateIndexForLevel); absent lane → the full first list.
    const level = objects.levels?.[placement] ?? states.length;
    const stateIndex = stateIndexForLevel(level, states.length);
    const type = states[stateIndex] ?? states[0];
    if (type === null || type === undefined) {
      skipped++;
      return;
    }
    const screen = halfCellToScreen(hx, hy);
    // The node sampler owns the half-cell→cell convention (a cell-centre node lifts exactly like
    // its ground-mesh vertex, so trees sit on the warped ground). The lift is the draw offset only;
    // `y` (the feet anchor + depth key) stays pre-lift so objects occlude by map row.
    const lift = elevation?.liftAtNode(hx, hy) ?? 0;
    // The baked `embr` multiplier at the anchor cell — the original shades landscape-object pixels
    // with the ground's plane (measured: mines/stones/grass track it; trees stay full-bright, so the
    // tree logic types omit the field — source basis "brightness").
    const shade = brightness?.shaded && type.shaded ? brightness : undefined;
    const sprite: MapObjectSprite = {
      x: screen.x,
      y: screen.y,
      source: type.source,
      frames: type.frames,
      ...(type.shadow !== undefined ? { shadow: type.shadow } : {}),
      scale: 1,
      decor: type.decor,
      ...(lift !== 0 ? { lift } : {}),
      // Slow spatial phase gradient (`hx + hy`), not uniform: adjacent half-cells stay within one frame
      // of each other (the wave sheet reads continuous) while the phase drifts across the map so the
      // surface doesn't pulse as one stamp. The map stores no per-object phase (source basis). Static
      // objects (`frames.length <= 1`) ignore phase, so this only staggers looping bobs.
      phase: hx + hy,
      // Translucency (the waves' watery blend, the ferns' feathered edges) is the Double8Bit bobs'
      // per-pixel alpha, baked into the atlas by the pipeline — no flat per-object opacity remains.
      // Named approximation: the engine's alpha blit folds the shade into the pixel alpha
      // (a = alphaByte·(256−shade)/256), while we shade via the `brightness` colour multiplier below
      // with the baked alpha unchanged — identical at neutral shade, divergent on embr-shaded cells.
      ...(shade !== undefined ? { brightness: shade.brightnessAt(hx / 2, hy / 2) } : {}),
    };
    out.push(sprite);
    byPlacement.set(placement, sprite);
  });
  if (skipped > 0) {
    diag.warn(
      'content',
      `loadMapObjects: ${skipped} of ${objects.placements.length / 3} placements had no resolvable graphics`,
    );
  }
  return { sprites: out, byPlacement };
}
