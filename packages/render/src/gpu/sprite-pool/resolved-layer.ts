import type { TextureSource } from 'pixi.js';
import type { AtlasFrame, BuildTimeSheet } from '../../data/sprites/index.js';

/** One resolved atlas layer to draw: which source page, which frame rect, at what scale.
 *  `atlasW`/`atlasH` are the source sheet's pixel size, needed only by the paletted settler path, whose
 *  mesh samples the indexed atlas by UV. */
export interface ResolvedLayer {
  readonly source: TextureSource;
  readonly frame: AtlasFrame;
  readonly scale: number;
  readonly atlasW?: number;
  readonly atlasH?: number;
  /** Construction reveal fraction, 0..1 of `builtPct/100`, present only on an under-construction
   *  building's stage stack. */
  readonly reveal?: number;
  /** The atlas's build-progress time sheet, when the loaded layer carries one; enables the per-pixel
   *  reveal. */
  readonly times?: BuildTimeSheet;
  /** The construction stage's `[fromPct, toPct]` progress window, mapping eased progress into this
   *  stage's own threshold scale. */
  readonly revealWindow?: readonly [number, number];
  /** Excluded from the entity's stamped bounds: a building's animated state overlay (the mill's rotor)
   *  breathes in size and offset per frame and must not move the box. It still draws and still
   *  pixel-hit-tests. */
  readonly boundsExempt?: boolean;
  /**
   * A cast-shadow layer: always also {@link boundsExempt}, and additionally excluded from the pixel hit
   * test, since clicking the darkened ground beside a caster must not select it.
   */
  readonly shadow?: true;
}
