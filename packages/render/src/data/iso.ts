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

/**
 * The deterministic secondary depth key weight: a feet-anchored sprite sorts by `depthKey = y + x *
 * this`. Small enough that the x term can never overturn a meaningful y difference (max |x| on a
 * 1024-wide map ≈ 32k px → contributes ~0.03), large enough to order same-row overlaps stably
 * regardless of attach order.
 */
export const DEPTH_X_TIEBREAK = 1 / (1 << 20);

/**
 * The screen-depth sort key for a feet anchor at projected `(x, y)` px: primarily the screen `y`
 * (lower on screen = drawn later = in front), with a tiny `x` tiebreak ({@link DEPTH_X_TIEBREAK}) so
 * two sprites on the same row order deterministically instead of flickering with attach/detach churn
 * (Pixi's `sortableChildren` sort is stable only in children-array order, which panning reshuffles).
 * The pooled entities and the tall map objects share this key so a settler and the tree it walks
 * behind sort into one painter order. Pure.
 */
export function depthKey(x: number, y: number): number {
  return y + x * DEPTH_X_TIEBREAK;
}
