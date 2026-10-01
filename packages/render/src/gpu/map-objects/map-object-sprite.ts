import type { TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';

/**
 * One placed landscape object from a decoded map's `objects` layer, fully resolved by the app.
 * `decor` objects are flat ground decor batched into per-chunk meshes under the entity sprites; tall
 * objects depth-sort against entities by their feet anchor, unless they are {@link groundPass}.
 */
export interface MapObjectSprite {
  /** World-space feet anchor (px), already projected from the `emla` half-cell by the app. */
  readonly x: number;
  readonly y: number;
  readonly source: TextureSource;
  /** More than one frame is a loop played at the sim tick rate, or a clip played once ({@link once}). */
  readonly frames: readonly AtlasFrame[];
  readonly scale: number;
  /** Breeze shear per unit of height, authored with the art: it runs whatever the graphics switches say. */
  readonly sway?: number;
  /** The same, for art shipped as one still frame: the environment-motion switch adds it, so it runs
   *  only while that switch is on. It lives on this static sprite alone: once the sprite pool draws the
   *  object (a felled or save-restored harvestable), it stands still. */
  readonly environmentSway?: number;
  readonly decor: boolean;
  /** A live creature the map places for presentation (a butterfly swarm), not landscape: it shows only
   *  on a cell the viewer currently watches, never as an explored-ground ghost. Tall objects only. */
  readonly creature?: boolean;
  /** Starting frame offset into {@link frames}; static objects and one-shot clips ignore it. */
  readonly phase: number;
  /**
   * Terrain-elevation lift (world px, ≥ 0), subtracted from the drawn `y`. The feet anchor {@link y}
   * and its depth key stay pre-lift, so an object raised up a hill still occludes by map row. Omitted
   * on a flat map or when the app has no elevation lane.
   */
  readonly lift?: number;
  /** Whether a tall object draws in the still-landscape pass: under every entity and animated object,
   *  in row order among its own kind. A bridge deck is one, so whoever crosses it paints over it. */
  readonly groundPass?: boolean;
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
  /** Built stonework whose foot sets into the ground like a building's. */
  readonly grounded?: true;
  /** A clip that plays {@link frames} once instead of looping: see {@link OneShotClip}. */
  readonly once?: OneShotClip;
}

/**
 * A one-shot clip's timing and what follows it. Its frames advance one per tick from {@link from} (the
 * clock the loops run on), and on its {@link oneShotEndTick} the layer replaces the object with
 * {@link rest}, or retires it when that is null.
 */
export interface OneShotClip {
  /** The tick the clip shows its first frame. */
  readonly from: number;
  /** The still the clip rests as: the record its stage becomes, placed like the clip. Null for a
   *  transient clip something else takes over from. */
  readonly rest: MapObjectSprite | null;
}

/** The first tick a one-shot clip no longer draws: it shows each of its frames for one tick. */
export function oneShotEndTick(clip: OneShotClip, frameCount: number): number {
  return clip.from + frameCount;
}

/** Shared by the body and shadow binds, so the pair can never drift. A one-shot clip holds its first
 *  frame before it starts and its last after it ends, a fog-frozen pose included. */
export function objectFrameIndexAt(obj: MapObjectSprite, tick: number): number {
  const count = obj.frames.length;
  if (count <= 1) return 0;
  if (obj.once !== undefined) return Math.min(Math.max(tick - obj.once.from, 0), count - 1);
  return (tick + obj.phase) % count;
}

/** The breeze strength in play, `undefined` for an object that stands still. */
export function activeSway(obj: MapObjectSprite, environmentMotion: boolean): number | undefined {
  return obj.sway ?? (environmentMotion ? obj.environmentSway : undefined);
}

export function objectFrameAt(obj: MapObjectSprite, tick: number): AtlasFrame | undefined {
  return obj.frames[objectFrameIndexAt(obj, tick)];
}
