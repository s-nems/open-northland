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
import {
  drawsAsFlatDecor,
  drawsInGroundPass,
  landscapeRecordsByName,
  servedAtlasStem,
  servedShadowStem,
} from './ir/joins.js';
import { loadLayer, MissingAtlasError } from './ir/load.js';
import type { ContentIr } from './ir/rows.js';
import { forEachPlacement } from './map-placements.js';
import { footprintBrightness, unshadedLogicTypeIds } from './object-shading.js';
import { standingVegetationTypeIds, stillVegetationSway } from './object-sway.js';

/**
 * The map-object binding: each `objects` placement's `EditName` joins the `landscapeGfx` IR table for its
 * body atlas, frame list and animation flags. Both the join and the atlases live in the gitignored
 * `content/`, so a checkout without them renders no objects.
 */

/** The `objects` layer of a decoded `content/maps/<id>.json` (see `TerrainObjects` in @open-northland/data). */
export interface MapObjectsData {
  readonly types: readonly string[];
  readonly placements: readonly number[];
  /** Per-placement 1-based level (`lmlv`), counting up from the lowest state ({@link stateIndexForLevel}). Absent → the full state. */
  readonly levels?: readonly number[] | undefined;
}

/**
 * Which `GfxFrames` state list a placement's 1-based `lmlv` level picks. The level counts what remains or
 * has grown (level 1 the lowest state, level N the highest) while the record's lists are authored
 * highest-first, so the index is `N − level`. Pinned by calibration-by-observation on the bridge-map
 * corpus (source basis "Landscape-object layer"). Any out-of-range level, including the wall "intact"
 * sentinel `100`, falls back to the first (full) list.
 */
export function stateIndexForLevel(level: number, stateCount: number): number {
  return level >= 1 && level <= stateCount ? stateCount - level : 0;
}

/** One decoded atlas with its optional shadow twin; a 404 from a partial `content/` degrades to null. */
async function loadLayerOrNull(key: string, shadowStem?: string): Promise<SpriteLayer | null> {
  try {
    return await loadLayer(key, shadowStem);
  } catch (err) {
    if (err instanceof MissingAtlasError) return null;
    throw err;
  }
}

/** The resting `cadaver human bones` records of `ls_skeletons.bmd`, each a single still frame. */
const HUMAN_BONES_EDIT_NAMES = ['cadaver human bones01', 'cadaver human bones02', 'cadaver human bones03'];

/** The `debris wood` records of `ls_ground.bmd`, each a single still frame: the splinters a wrecked cart
 *  or catapult leaves on its ruin nodes. Approximation: the ruin landscape type the original scatters is
 *  not identified (docs/formats/VEHICLES.md), so these are picked by look. */
const WRECK_DEBRIS_EDIT_NAMES = ['debris wood 01', 'debris wood 02', 'debris wood 03', 'debris wood 04'];

/**
 * Resolve the decoded human bone-pile art for the combat-feedback layer. Returns `null` when the
 * `landscapeGfx` join or its atlas is absent, so the renderer falls back to its procedural pile.
 */
export function loadCombatBones(
  ir: ContentIr,
): Promise<{ source: SpriteLayer['source']; frames: AtlasFrame[] } | null> {
  return loadStillMarks(ir, HUMAN_BONES_EDIT_NAMES);
}

/** The wreck-debris twin of {@link loadCombatBones}; `null` falls back to the procedural planks. */
export function loadWreckDebris(
  ir: ContentIr,
): Promise<{ source: SpriteLayer['source']; frames: AtlasFrame[] } | null> {
  return loadStillMarks(ir, WRECK_DEBRIS_EDIT_NAMES);
}

/** The first frame of each named single-state record, all from the first record's atlas. */
async function loadStillMarks(
  ir: ContentIr,
  editNames: readonly string[],
): Promise<{ source: SpriteLayer['source']; frames: AtlasFrame[] } | null> {
  const rows = (ir.landscapeGfx ?? []).filter((r) => editNames.includes(r.editName ?? ''));
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
 * The resolved sprites plus a placement-ordinal → sprite map (keyed by triplet index in
 * `objects.placements`), the join the `?map=` entry uses to hand a first-worked resource node's static
 * sprite over to the live sim pool.
 */
export interface LoadedMapObjects {
  readonly sprites: MapObjectSprite[];
  readonly byPlacement: ReadonlyMap<number, MapObjectSprite>;
}

/**
 * Body + shadow frames of one state's bob-id list, resolved in one pass so the pair stays index-aligned
 * across the 0×0-frame drops; a pose without a silhouette holds `undefined`. Null when no body frame
 * survives.
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
  const recordByName = landscapeRecordsByName(ir);
  const unshadedLogicTypes = unshadedLogicTypeIds(ir.landscape);
  const standingVegetation = standingVegetationTypeIds(ir.landscape);
  const layerKeys = new Map<string, string | undefined>();
  for (const type of objects.types) {
    const record = recordByName.get(type);
    const key = record !== undefined ? servedAtlasStem(record) : undefined;
    if (key === undefined) continue;
    const shadowStem = servedShadowStem(record?.shadowBmd);
    // The first defined shadow stem wins: records sharing one atlas may differ in `shadowBmd`, and a
    // plain first-wins would let a shadow-less record block the twin for every type on that atlas.
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
    readonly environmentSway: number | undefined;
    readonly groundPass: boolean;
    /** False for the tree logic types (the measured full-bright exemption). */
    readonly shaded: boolean;
    /** The ground cells the object's walk area covers, relative to its node: what
     *  {@link footprintBrightness} grades it against. */
    readonly walkFootprint: readonly FootprintCell[];
  }
  // One ResolvedType per (type, state list), indexed [typeIndex][stateIndex]; a null entry means that
  // state resolved nothing and the placement falls back to state 0.
  const resolved: (ResolvedType | null)[][] = objects.types.map((type) => {
    const record = recordByName.get(type);
    if (record === undefined) return [];
    const key = servedAtlasStem(record);
    const layer = key !== undefined ? layers.get(key) : undefined;
    if (layer === undefined) return [];
    // Per record: the full state's areas apply whatever state a list draws.
    const walkFootprint = fullStateBlockAreaCells(record.walkBlockAreas);
    const groundPass = drawsInGroundPass(record);
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
        environmentSway: stillVegetationSway(record, animated, standingVegetation),
        groundPass,
        shaded: record.logicType === undefined || !unshadedLogicTypes.has(record.logicType),
        walkFootprint,
      };
    });
  });

  // Only an unknown name or an atlas that failed to load is missing graphics. A record drawn by another
  // pass (a ground-lift wave) or whose own frame lists name no drawable bob (the invisible `block`s and
  // walls, a test object) draws nothing by its data.
  const missing = objects.types.map((type) => {
    const record = recordByName.get(type);
    if (record === undefined) return true;
    const key = record.userFxMatrix === true ? undefined : servedAtlasStem(record);
    return key !== undefined && !layers.has(key);
  });
  const out: MapObjectSprite[] = [];
  const byPlacement = new Map<number, MapObjectSprite>();
  let skipped = 0;
  forEachPlacement(objects.placements, (hx, hy, typeIndex, placement) => {
    const states = resolved[typeIndex] ?? [];
    const level = objects.levels?.[placement] ?? states.length;
    const stateIndex = stateIndexForLevel(level, states.length);
    const type = states[stateIndex] ?? states[0];
    if (type === null || type === undefined) {
      if (missing[typeIndex] === true) skipped++;
      return;
    }
    const screen = halfCellToScreen(hx, hy);
    // The lift is a draw offset only; `y` (the feet anchor and depth key) stays pre-lift so objects
    // occlude by map row.
    const lift = elevation?.liftAtNode(hx, hy) ?? 0;
    // The baked `embr` multiplier over the ground this object covers, skipped for the types
    // `unshadedLogicTypeIds` exempts.
    const shade = brightness?.shaded && type.shaded ? brightness : undefined;
    const sprite: MapObjectSprite = {
      x: screen.x,
      y: screen.y,
      source: type.source,
      frames: type.frames,
      ...(type.shadow !== undefined ? { shadow: type.shadow } : {}),
      scale: 1,
      ...(type.environmentSway !== undefined ? { environmentSway: type.environmentSway } : {}),
      decor: type.decor,
      ...(type.groundPass ? { groundPass: true } : {}),
      ...(lift !== 0 ? { lift } : {}),
      // The map stores no per-object phase, so this gradient is invented here: neighbouring half-cells
      // stay within one frame of each other while the surface avoids pulsing as one stamp.
      phase: hx + hy,
      // Named approximation: the engine's alpha blit folds the shade into each Double8Bit bob's baked
      // per-pixel alpha (a = alphaByte·(256−shade)/256), while shading here is a colour multiplier over
      // unchanged alpha. Identical at neutral shade, divergent on embr-shaded cells.
      ...(shade !== undefined ? { brightness: footprintBrightness(shade, hx, hy, type.walkFootprint) } : {}),
    };
    out.push(sprite);
    byPlacement.set(placement, sprite);
  });
  if (skipped > 0) {
    diag.warn(
      'content',
      `loadMapObjects: ${skipped} of ${objects.placements.length / 3} placements name no record or an atlas that failed to load`,
    );
  }
  return { sprites: out, byPlacement };
}
