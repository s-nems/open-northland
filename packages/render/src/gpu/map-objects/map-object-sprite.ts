import type { TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';

/**
 * One placed landscape object from a decoded map's `objects` layer, fully resolved by the app.
 * `decor` objects are flat ground decor batched into per-chunk meshes under the entity sprites; tall
 * objects depth-sort against entities by their feet anchor, or by {@link depthY}.
 */
export interface MapObjectSprite {
  /** World-space feet anchor (px), already projected from the `emla` half-cell by the app. */
  readonly x: number;
  readonly y: number;
  readonly source: TextureSource;
  /** More than one frame is a loop played at the sim tick rate. */
  readonly frames: readonly AtlasFrame[];
  readonly scale: number;
  readonly sway?: number;
  readonly decor: boolean;
  /** Starting frame offset into {@link frames}; static objects ignore it. */
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
   * The baked `embr` luminance multiplier over the ground this object covers, 1 being neutral; absent on
   * an unshaded map and for a kind the app exempts. Decor batches apply the full range unclamped; a tall
   * pooled sprite applies it as a Pixi tint, which cannot brighten, so a multiplier above 1 clamps there
   * - a named approximation.
   */
  readonly brightness?: number;
  /**
   * The object's cast shadow from the `GfxBobLibs` shadow `.bmd` atlas (pre-baked translucent-black
   * silhouettes), when the record names one and it loaded. `frames[i]` pairs with the body
   * {@link frames}`[i]`, `undefined` meaning that pose casts none. A tall object sorts it just under its
   * caster; flat decor batches it under every decor body.
   */
  readonly shadow?: {
    readonly source: TextureSource;
    readonly frames: readonly (AtlasFrame | undefined)[];
  };
}

/** Shared by the body and shadow binds, so the pair can never drift. */
export function objectFrameIndexAt(obj: MapObjectSprite, tick: number): number {
  return obj.frames.length <= 1 ? 0 : (tick + obj.phase) % obj.frames.length;
}

export function objectFrameAt(obj: MapObjectSprite, tick: number): AtlasFrame | undefined {
  return obj.frames[objectFrameIndexAt(obj, tick)];
}
