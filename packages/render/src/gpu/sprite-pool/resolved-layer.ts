import type { TextureSource } from 'pixi.js';
import type { AtlasFrame, BuildTimeSheet } from '../../data/sprites/index.js';

/** One resolved atlas layer to draw for an entity: which source page, which frame rect, at what scale.
 *  `atlasW`/`atlasH` (the source sheet's pixel size) ride along only for the paletted settler path — the
 *  {@link import('../paletted-sprite/index.js').PalettedSprite} mesh samples the indexed atlas by UV and needs
 *  the sheet dimensions; the plain {@link import('pixi.js').Sprite} path binds a cached sub-texture and
 *  ignores them. */
export interface ResolvedLayer {
  readonly source: TextureSource;
  readonly frame: AtlasFrame;
  readonly scale: number;
  readonly atlasW?: number;
  readonly atlasH?: number;
  /**
   * Construction reveal fraction (0..1 of `builtPct/100`) — present only on the stage stack of an
   * under-construction building; the pool eases the displayed value toward it between the sim's
   * per-swing `built` steps. With {@link times} (+ {@link revealWindow}) the reveal is per-pixel:
   * each pixel appears once the eased progress, mapped into the window
   * ({@link import('../../data/sprites/index.js').buildTimeThreshold}), reaches its baked TimeMask
   * threshold. Without time data the layer falls back to the
   * bottom-up top-crop approximation.
   */
  readonly reveal?: number;
  /** The atlas's build-progress time sheet, when the loaded {@link import('../sprite-sheet.js').SpriteLayer}
   *  carries one — enables the per-pixel reveal (see {@link reveal}). */
  readonly times?: BuildTimeSheet;
  /** The construction stage's `[fromPct, toPct]` progress window — set with {@link times} on a reveal
   *  layer so the pool can map eased progress into this stage's own threshold scale. */
  readonly revealWindow?: readonly [number, number];
  /**
   * Excluded from the entity's stamped {@link import('./pooled-entity.js').EntityBounds} — set on a
   * building's animated state overlay (the mill's spinning rotor), whose per-frame rects differ in
   * size and sit off the body's centre. The bounds feed the selection ring's size/centre and the
   * details-panel portrait's fit-to-box framing, which must not breathe with the spin cycle. The
   * overlay still draws and still pixel-hit-tests — it just doesn't move the box.
   */
  readonly boundsExempt?: boolean;
  /**
   * A cast-shadow layer ({@link import('./layered-layers.js').shadowLayerFor}) — always also
   * {@link boundsExempt}, and additionally excluded from the pixel hit test: clicking the darkened
   * ground beside a caster must not select it (unlike the rotor overlay, a clickable part of the building).
   */
  readonly shadow?: true;
}
