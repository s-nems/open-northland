import type { TextureSource } from 'pixi.js';
import type { AtlasFrame, BuildTimeSheet } from '../../data/sprites/index.js';
import type { ClothWind } from '../cloth-wind.js';

/** One resolved atlas layer to draw: which source page, which frame rect, at what scale.
 *  `atlasW`/`atlasH` are the source sheet's pixel size, needed only by the paletted path, whose mesh
 *  samples its atlas by UV. */
export interface ResolvedLayer {
  readonly source: TextureSource;
  readonly frame: AtlasFrame;
  readonly scale: number;
  /** Per-instance offset from the entity anchor in world pixels, used by independently moving swarms. */
  readonly dx?: number;
  readonly dy?: number;
  readonly shear?: number;
  /** Wind through the layer's cloth pixels; paletted path only. */
  readonly cloth?: ClothWind;
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
  /**
   * A {@link shadow} layer drawn from the caster's own body frame rather than an authored silhouette
   * atlas: the binder projects it onto the ground instead of printing it upright. Drawn only while the
   * shadow enhancement is on, so the frame's art never reaches the screen unprojected.
   */
  readonly cast?: true;
  /**
   * Rows of a {@link cast} layer's frame to keep, counted from its top. Present only on a character's
   * head overlay, where it drops the rows that project onto ground the body's own cast already covers.
   */
  readonly castRows?: number;
  /** A settler's head overlay, which the paletted path reads through the LUT's head row. */
  readonly head?: true;
}

const NO_LAYERS: readonly ResolvedLayer[] = [];

/**
 * A resolve's output list, refilled every frame without reallocating: emptying a JS array by
 * `length = 0` releases its backing store, so this overwrites the last resolve's entries by index and
 * trims only the tail.
 */
export class LayerBuffer {
  private readonly layers: ResolvedLayer[] = [];
  private count = 0;

  get length(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
  }

  push(layer: ResolvedLayer): void {
    this.layers[this.count++] = layer;
  }

  /** The layers pushed since {@link reset}, valid until the next one. An empty resolve returns a shared
   *  list so the buffer keeps its storage. */
  finish(): readonly ResolvedLayer[] {
    if (this.count === 0) return NO_LAYERS;
    this.layers.length = this.count;
    return this.layers;
  }
}
