import { ONE as SIM_ONE } from '@vinland/sim';

/**
 * Isometric projection + the camera transform — the foundational, dependency-light math the rest of
 * `render` builds on. It lives in its OWN module (not the {@link import('../index.js')} barrel) so the
 * pure scene/terrain/viewport modules and the GPU renderer can import it WITHOUT importing the barrel
 * that re-exports them — the barrel↔module import cycle that used to force a TDZ workaround (a const
 * read before its initializer ran). No Pixi, no canvas, no sim state read back: plain projection.
 */

/** Fixed-point scale (one whole tile), re-exported so the scene layer reads snapshot positions. */
export const ONE: number = SIM_ONE;

/** Isometric projection constants — tile diamond half-extents in pixels. Tune to the art. */
export const TILE_HALF_W = 32;
export const TILE_HALF_H = 16;

/** Cartesian tile (col,row) -> isometric screen offset (before camera). Pure, unit-tested-able. */
export function tileToScreen(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - row) * TILE_HALF_W,
    y: (col + row) * TILE_HALF_H,
  };
}

/**
 * A camera transform applied to every projected screen position before drawing. Plain data (a pan
 * offset + a uniform zoom), so the pure viewport-cull math ({@link import('./viewport.js')}) can invert
 * it without touching the GPU layer.
 */
export interface Camera {
  /** Pixel offset added to every item's screen position (pan). */
  readonly offsetX: number;
  readonly offsetY: number;
  /**
   * Uniform zoom factor (1 = no scale). Magnifies the whole scene about the layer origin, so a small
   * pixel-art bob is large enough for a human to judge decode fidelity. Applied as the draw layer's
   * scale, with {@link offsetX}/{@link offsetY} as the layer position — so `screen = world*scale +
   * offset`. Defaults to 1.
   */
  readonly scale?: number;
}
