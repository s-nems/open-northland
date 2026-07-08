import type { TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';

/**
 * One placed landscape object, fully resolved by the app (atlas source + frame list + position):
 * a tree, stone, bush, mine decal or animated wave from a decoded map's `objects` layer. `frames`
 * with more than one entry is a looping animation played from {@link phase} (the app sets phase 0
 * everywhere — the wave bobs tile seamlessly only when neighbours show the SAME frame). `decor`
 * objects are flat ground decor (waves, grass, flowers, mine stains): they batch into per-chunk
 * meshes UNDER the entity sprites; non-decor (tall) objects (trees, stones) depth-sort against
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
  /** Starting frame offset into {@link frames} (kept for future per-object phase data). */
  readonly phase: number;
  /** Draw opacity (1 = opaque). Waves composite translucently over the water ground. */
  readonly alpha: number;
  /**
   * Terrain-elevation lift (world px, ≥ 0) at this object's half-cell — SUBTRACTED from the drawn `y` so
   * a tree/stone rides up the hill it stands on. The feet anchor {@link y} and its depth key stay
   * PRE-LIFT, so a lifted-up object still occludes by map row (a tree on a hill draws behind a settler on
   * a nearer row). Omitted (0) on a flat map / when the app has no elevation lane. Set by the app loader.
   */
  readonly lift?: number;
}

/** The frame an object shows at a given animation tick (static objects always show frame 0). */
export function objectFrameAt(obj: MapObjectSprite, tick: number): AtlasFrame | undefined {
  if (obj.frames.length <= 1) return obj.frames[0];
  return obj.frames[(tick + obj.phase) % obj.frames.length];
}
