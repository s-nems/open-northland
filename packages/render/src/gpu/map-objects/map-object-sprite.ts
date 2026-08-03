import type { TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';

/**
 * One placed landscape object from a decoded map's `objects` layer, fully resolved by the app.
 * `decor` objects are flat ground decor batched into per-chunk meshes under the entity sprites; tall
 * objects depth-sort against entities by their world-`y` feet anchor, or by {@link depthY}.
 */
export interface MapObjectSprite {
  /** World-space feet anchor (px), already projected from the `emla` half-cell by the app. */
  readonly x: number;
  readonly y: number;
  readonly source: TextureSource;
  /** One frame is static; more than one is a loop played at the sim tick rate. */
  readonly frames: readonly AtlasFrame[];
  readonly scale: number;
  readonly decor: boolean;
  /** Starting frame offset into {@link frames}. The app staggers looping bobs by a spatial gradient so
   *  neighbours do not pulse as one stamp; static objects ignore it. */
  readonly phase: number;
  /**
   * Terrain-elevation lift (world px, ≥ 0), subtracted from the drawn `y`. The feet anchor {@link y}
   * and its depth key stay pre-lift, so an object raised up a hill still occludes by map row. Omitted
   * on a flat map or when the app has no elevation lane.
   */
  readonly lift?: number;
  /** World-`y` (px) this object's sort key uses instead of the feet anchor {@link y}; the drawn
   *  position, cull and fog lookup still use the anchor. Set for an object settlers stand on rather
   *  than beside, such as a bridge deck, which must not sort at the row it is anchored to. */
  readonly depthY?: number;
  /**
   * The baked `embr` luminance multiplier over the ground this object covers, 1 being neutral. The
   * original shades landscape-object pixels with the ground's baked plane, measured on the corpus for
   * mine decals, stones and grass (masked opaque-pixel ratio tracks embr from ×0.58 to ×1.58), except
   * trees, which draw full-bright even on embr=0 border cells and so omit the field. Decor batches
   * apply the full range per vertex; tall pooled sprites apply it as a tint, which clamps at ×1 - a
   * named approximation, since Pixi's batch tint cannot brighten.
   */
  readonly brightness?: number;
  /**
   * The object's cast shadow from the `GfxBobLibs` shadow `.bmd` atlas (pre-baked translucent-black
   * silhouettes), when the record names one and it loaded. `frames[i]` pairs with the body
   * {@link frames}`[i]`, `undefined` meaning that pose casts none. Only tall objects draw it; flat
   * decor ignores the field even though the data holds real decor silhouettes - a named gap.
   */
  readonly shadow?: {
    readonly source: TextureSource;
    readonly frames: readonly (AtlasFrame | undefined)[];
  };
}

/** The frame index an object shows at a given animation tick - shared by the body and shadow binds so
 *  the pair can never drift. */
export function objectFrameIndexAt(obj: MapObjectSprite, tick: number): number {
  return obj.frames.length <= 1 ? 0 : (tick + obj.phase) % obj.frames.length;
}

export function objectFrameAt(obj: MapObjectSprite, tick: number): AtlasFrame | undefined {
  return obj.frames[objectFrameIndexAt(obj, tick)];
}
