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

/**
 * Isometric projection constants — the tile diamond's half-extents in pixels, i.e. the on-screen cell
 * PITCH (stepping one cell moves the draw position by `(±TILE_HALF_W, TILE_HALF_H)`). This is the master
 * scale the whole world hangs off: every ground triangle, every feet-anchored bob (drawn at its NATIVE
 * pixel size — see the render CLAUDE.md) and the camera derive from it, so getting it right is what makes
 * a bob read at the correct size against the terrain.
 *
 * The exact value is HUMAN-GATED (pixels — an agent cannot self-judge; docs/FIDELITY.md "projection")
 * and, because it is the whole look, LIVE-TUNABLE: the live entry sets it from `?pitch=<fullTileWidth>`
 * via {@link setTilePitch} (halving to the half-extents, keeping the iso-standard 2:1 W:H), so a human can
 * dial the sprite-vs-terrain scale in real time and report the value instead of a rebuild per guess.
 *
 * Default `32×16` (a 64px-wide tile). Calibration history (why not eyeballed blind): the original
 * projection isn't reverse-engineered, so the ballpark came from the art — a placed object's
 * `LogicWalkBlockArea` footprint is in CELLS and its bob in PIXELS, and flat objects imply ~17–21 px/cell
 * (stone bridge 20×12→676px, clay/iron mine 5×3→134px). A first pass took that literally and set `20×10`,
 * but it OVERSHOT: it made the whole world too zoomed-in — nature (trees/plants/waves) too big, too little
 * free space, water tiles visibly repeating. The bridge footprint (a wide collision area, not the visible
 * deck) had skewed the estimate low. Reverted to `32×16`; the separate "buildings too small" report is
 * fixed by dropping the 0.7 building fudge (they draw NATIVE now), NOT by shrinking the pitch. Per-object
 * scale conflicts a single pitch can't resolve (if nature reads right but buildings/bridge don't) are the
 * signal to reach for a per-class scale, surfaced by sweeping `?pitch=`.
 */
export let TILE_HALF_W = 32;
export let TILE_HALF_H = 16;

/**
 * Override the tile pitch (the {@link TILE_HALF_W}/{@link TILE_HALF_H} half-extents) at runtime — the live
 * calibration knob behind `?pitch=`. Reassigns the module bindings, which every consumer reads live (ES
 * module live bindings), so the terrain mesh, object lattice, viewport cull and camera all pick it up as
 * long as it is called BEFORE the scene/renderer is built. Render-only; the sim never reads these.
 */
export function setTilePitch(halfW: number, halfH: number): void {
  TILE_HALF_W = halfW;
  TILE_HALF_H = halfH;
}

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
