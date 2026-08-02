import { type FootprintCell, fullStateBlockAreaCells } from '@open-northland/data';
import {
  type AtlasFrame,
  type BrightnessField,
  type ElevationField,
  halfCellToScreen,
  type MapObjectSprite,
  type SpriteLayer,
} from '@open-northland/render';
import { diag } from '../diag/index.js';
import { deckFarRow, drawsAsFlatDecor, servedAtlasStem, servedShadowStem } from './ir/joins.js';
import { loadLayer, MissingAtlasError } from './ir/load.js';
import type { ContentIr, LandscapeGfxRow } from './ir/rows.js';
import { forEachPlacement } from './map-placements.js';
import { footprintBrightness, unshadedLogicTypeIds } from './object-shading.js';

/**
 * The map-object binding: turn a decoded map's `objects` layer (the original's `emla` half-cell
 * placements - every tree, stone, bush, mine decal and animated wave) into the renderer's
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
 * Which `GfxFrames` state list a placement's 1-based `lmlv` level picks. The level counts what
 * remains/has grown - level 1 is the lowest state (sapling / near-depleted deposit / rubble wall) and
 * level N the highest (full-grown / full deposit / intact) - while the record's lists are authored
 * highest-first (a tree's full-grown state first, a clay deposit's 74×51 full pile before its 32×18
 * dregs), so the index is `N − level`. Pinned by calibration-by-observation on the bridge-map corpus:
 * the north forest is `lmlv=3` throughout and the original draws it full-grown (an isolated lmlv=3
 * cypress matches the full-grown frame at 0.99 vs 0.84/0.87 for the younger states), and the deposit
 * records' big-to-small list order matches level-as-remaining (source basis "Landscape-object
 * layer"). Any out-of-range level - including the wall "intact" sentinel `100` - falls back to the
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

/** The decoded human bone-pile records - the resting `cadaver human bones` states of `ls_skeletons.bmd`
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
 *  - **frames** - the `GfxFrames` state list the placement's `lmlv` level picks
 *    ({@link stateIndexForLevel}), each bob id resolved through the atlas manifest (0×0 frames
 *    dropped). A record with `loopAnimation` plays the whole list at the sim tick rate (waves,
 *    swaying trees, fire); a static record shows the list's first frame.
 *  - **paint order**: {@link drawsAsFlatDecor} draws under the entity sprites; everything else
 *    depth-sorts against settlers by its feet anchor, or by {@link deckFarRow} where that row is
 *    wrong.
 *  - **position** - the half-cell `(hx, hy)` projected onto the plain half-cell lattice
 *    (`halfCellToScreen` - the `emla` grid the original places on; no row stagger at this level).
 *  - **phase** - a slow spatial gradient (`hx + hy`), so a looping bob's neighbours stay within a
 *    frame of each other (the wave sheet reads as continuous) while the surface drifts across the map
 *    instead of pulsing as one identical stamp (the map stores no per-object phase - source basis).
 *
 * A type that can't resolve (no record, no atlas, no usable frame) is counted + skipped - a partial
 * `content/` must degrade, not abort. Placements resolve in file order (deterministic).
 *
 * Returns the sprites plus a placement-ordinal → sprite map (`byPlacement`, keyed by triplet index in
 * `objects.placements`): the join the `?map=` entry uses to hand a first-worked resource node's static
 * sprite over to the live sim pool (`WorldRenderer.removeMapObject`). Every placement - harvestable or
 * decor - draws here; the sim pool skips the virgin harvestables via the static-refs set instead.
 */
export interface LoadedMapObjects {
  readonly sprites: MapObjectSprite[];
  readonly byPlacement: ReadonlyMap<number, MapObjectSprite>;
}

/**
 * Body + shadow frames of one state's bob-id list, resolved in one pass so the pair stays
 * index-aligned across the 0×0-frame drops (the shadow set parallels the body's bob ids; a pose
 * without a silhouette holds `undefined`). Null when no body frame survives - the caller falls
 * back to another state or the placeholder.
 */
export function pairedStateFrames(
  layer: Pick<SpriteLayer, 'atlas' | 'shadow'>,
  bobIds: readonly number[],
): { frames: AtlasFrame[]; shadowFrames: (AtlasFrame | undefined)[] } | null {
  const frames: AtlasFrame[] = [];
  const shadowFrames: (AtlasFrame | undefined)[] = [];
  for (const bobId of bobIds) {
    const f = layer.atlas.frames.get(bobId);
    if (f === undefined || f.width <= 0 || f.height <= 0) continue;
    frames.push(f);
    const s = layer.shadow?.atlas.frames.get(bobId);
    shadowFrames.push(s !== undefined && s.width > 0 && s.height > 0 ? s : undefined);
  }
  return frames.length === 0 ? null : { frames, shadowFrames };
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
  // The logicType ids whose objects stay full-bright (trees - the measured exemption).
  const unshadedLogicTypes = unshadedLogicTypeIds(ir.landscape);
  // Resolve each used type once: its record, atlas layer (+ its shadow twin, keyed by the record's
  // `shadowBmd`), frame list and decor split.
  const layerKeys = new Map<string, string | undefined>();
  for (const type of objects.types) {
    const record = recordByName.get(type);
    const key = record !== undefined ? servedAtlasStem(record) : undefined;
    if (key === undefined) continue;
    const shadowStem = servedShadowStem(record?.shadowBmd);
    // First DEFINED shadow stem wins (records sharing one atlas may differ in `shadowBmd`); a plain
    // first-wins would let a shadow-less record block the twin for every type on that atlas,
    // dependent on the map's type-list order.
    if (!layerKeys.has(key) || (layerKeys.get(key) === undefined && shadowStem !== undefined)) {
      layerKeys.set(key, shadowStem);
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
    /** The bridge-deck depth row ({@link deckFarRow}), absent for everything that sorts at its anchor. */
    readonly farRow: number | undefined;
    /** False for the tree logic types (the measured full-bright exemption, {@link unshadedLogicTypeIds}). */
    readonly shaded: boolean;
    /** The ground cells the object's walk area covers, relative to its node: what
     *  {@link footprintBrightness} grades it against. */
    readonly walkFootprint: readonly FootprintCell[];
  }
  // One ResolvedType per (type, state list) - index [typeIndex][stateIndex]; empty lists collapse
  // to null so a placement whose state resolves nothing falls back to state 0 below.
  const resolved: (ResolvedType | null)[][] = objects.types.map((type) => {
    const record = recordByName.get(type);
    if (record === undefined) return [];
    const key = servedAtlasStem(record);
    const layer = key !== undefined ? layers.get(key) : undefined;
    if (layer === undefined) return [];
    // Per record: the full state's areas apply whatever state a list draws.
    const walkFootprint = fullStateBlockAreaCells(record.walkBlockAreas);
    const farRow = deckFarRow(record);
    return (record.frames ?? []).map((stateList) => {
      const paired = pairedStateFrames(layer, stateList.bobIds);
      if (paired === null) return null;
      const { frames, shadowFrames } = paired;
      const animated = record.loopAnimation === true && record.isStatic !== true && frames.length > 1;
      const count = animated ? frames.length : 1;
      const shadowSource = layer.shadow?.source;
      const hasShadow =
        shadowSource !== undefined && shadowFrames.slice(0, count).some((s) => s !== undefined);
      return {
        source: layer.source,
        frames: frames.slice(0, count),
        shadow: hasShadow ? { source: shadowSource, frames: shadowFrames.slice(0, count) } : undefined,
        decor: drawsAsFlatDecor(record),
        farRow,
        shaded: record.logicType === undefined || !unshadedLogicTypes.has(record.logicType),
        walkFootprint,
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
    // The baked `embr` multiplier over the ground this object covers: the original shades
    // landscape-object pixels with the ground's plane (measured: mines/stones/grass track it; trees
    // stay full-bright, so the tree logic types omit the field, source basis "brightness").
    const shade = brightness?.shaded && type.shaded ? brightness : undefined;
    const sprite: MapObjectSprite = {
      x: screen.x,
      y: screen.y,
      source: type.source,
      frames: type.frames,
      ...(type.shadow !== undefined ? { shadow: type.shadow } : {}),
      scale: 1,
      decor: type.decor,
      ...(type.farRow !== undefined ? { depthY: halfCellToScreen(hx, hy + type.farRow).y } : {}),
      ...(lift !== 0 ? { lift } : {}),
      // Slow spatial phase gradient (`hx + hy`), not uniform: adjacent half-cells stay within one frame
      // of each other (the wave sheet reads continuous) while the phase drifts across the map so the
      // surface doesn't pulse as one stamp. The map stores no per-object phase (source basis). Static
      // objects (`frames.length <= 1`) ignore phase, so this only staggers looping bobs.
      phase: hx + hy,
      // Translucency (the waves' watery blend, the ferns' feathered edges) is the Double8Bit bobs'
      // per-pixel alpha, baked into the atlas by the pipeline - no flat per-object opacity remains.
      // Named approximation: the engine's alpha blit folds the shade into the pixel alpha
      // (a = alphaByte·(256−shade)/256), while we shade via the `brightness` colour multiplier below
      // with the baked alpha unchanged - identical at neutral shade, divergent on embr-shaded cells.
      ...(shade !== undefined ? { brightness: footprintBrightness(shade, hx, hy, type.walkFootprint) } : {}),
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
