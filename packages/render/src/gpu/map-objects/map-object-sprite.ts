import type { TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';

/**
 * One placed landscape object, fully resolved by the app (atlas source + frame list + position):
 * a tree, stone, bush, mine decal or animated wave from a decoded map's `objects` layer. `frames`
 * with more than one entry is a looping animation, offset per object by {@link phase}. `decor`
 * objects are flat ground decor (waves, grass, flowers, mine stains): they batch into per-chunk
 * meshes under the entity sprites; non-decor (tall) objects (trees, stones) depth-sort against
 * entities by their world-`y` feet anchor.
 */
export interface MapObjectSprite {
  /** World-space feet anchor (px), already projected by the app (`halfCellToScreen` of the `emla` half-cell). */
  readonly x: number;
  readonly y: number;
  readonly source: TextureSource;
  /** The object's frame list (1 = static; >1 = a loop played at the sim tick rate). */
  readonly frames: readonly AtlasFrame[];
  readonly scale: number;
  readonly decor: boolean;
  /** Starting frame offset into {@link frames}; the app staggers looping bobs by a spatial gradient so
   *  neighbours don't pulse as one stamp. Static objects (one frame) ignore it. */
  readonly phase: number;
  /**
   * Terrain-elevation lift (world px, ≥ 0) at this object's half-cell — subtracted from the drawn `y` so
   * a tree/stone rides up the hill it stands on. The feet anchor {@link y} and its depth key stay
   * pre-lift, so a lifted-up object still occludes by map row (a tree on a hill draws behind a settler on
   * a nearer row). Omitted (0) on a flat map / when the app has no elevation lane. Set by the app loader.
   */
  readonly lift?: number;
  /**
   * The baked `embr` luminance multiplier at this object's anchor cell (1 = neutral; the measured
   * curve in `data/brightness.ts`). The original shades landscape-object pixels with the ground's
   * baked plane — pinned on the corpus for mine decals, stones and grass (masked opaque-pixel ratio
   * tracks embr from ×0.58 to ×1.58) — except trees, which draw full-bright even on embr=0 border
   * cells; the app loader omits the field for those (and on unshaded maps). Decor batches apply it
   * per vertex (full range); tall pooled sprites apply it as a tint, which clamps at ×1 — a named
   * approximation, Pixi's batch tint cannot brighten.
   */
  readonly brightness?: number;
  /**
   * The object's cast shadow (the `GfxBobLibs` shadow `.bmd` atlas — pre-baked translucent-black
   * silhouettes), when the record names one and it loaded. `frames[i]` pairs with the body
   * {@link frames}`[i]` (`undefined` = that pose casts none), so an animated loop's shadow follows the
   * pose. Only tall objects draw it ({@link import('./tall-blocks.js').TallObjectLayer}); flat decor
   * ignores the field even though the data holds real decor silhouettes (mushrooms, bushes, ground
   * props) — a named gap, see `docs/tickets/render/remaining-shadow-casters.md`.
   */
  readonly shadow?: {
    readonly source: TextureSource;
    readonly frames: readonly (AtlasFrame | undefined)[];
  };
}

/** The {@link MapObjectSprite.frames} index an object shows at a given animation tick (static objects
 *  always show frame 0) — shared by the body and shadow binds so the pair can never drift. */
export function objectFrameIndexAt(obj: MapObjectSprite, tick: number): number {
  return obj.frames.length <= 1 ? 0 : (tick + obj.phase) % obj.frames.length;
}

/** The frame an object shows at a given animation tick (static objects always show frame 0). */
export function objectFrameAt(obj: MapObjectSprite, tick: number): AtlasFrame | undefined {
  return obj.frames[objectFrameIndexAt(obj, tick)];
}
