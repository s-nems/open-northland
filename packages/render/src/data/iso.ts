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
 * The original engine's cell pitch in native pixels, MEASURED from the running game (docs/FIDELITY.md
 * "projection" — calibration-by-observation, 2026-07). Screenshots of the original were scale-anchored by
 * template-matching decoded bobs (the 730px stone bridge pinned one shot at exactly 1.25×), then the cell
 * lattice was read from planted-bush constellations (123 matched bushes; the elementary lattice step
 * clusters at (±17.0, +18.7) native), the map-data water grid fitted against the observed river, and the
 * fog-of-war staircase angles. Four independent methods agree: **cell width ≈ 34.5 px** (±0.3), **mesh
 * row height ≈ 18.7 px** (±0.4).
 *
 * The same fit also showed the original projects rows as a RASTER WITH STAGGER (a row down is a pure
 * vertical step; odd rows shift half a cell) — NOT this renderer's rotated diamond. Migrating the
 * projection is a tracked follow-up (docs/FIDELITY.md); until then these constants preserve the
 * original's cell size and per-cell screen density under the diamond model.
 */
export const CALIBRATED_HALF_W = 17.25;
export const CALIBRATED_HALF_H = 18.7;

/**
 * Isometric projection constants — the tile diamond's half-extents in pixels, i.e. the on-screen cell
 * PITCH (stepping one cell moves the draw position by `(±TILE_HALF_W, TILE_HALF_H)`). This is the master
 * scale the whole world hangs off: every ground triangle, every feet-anchored bob (drawn at its NATIVE
 * pixel size — see the render CLAUDE.md) and the camera derive from it, so getting it right is what makes
 * a bob read at the correct size against the terrain.
 *
 * Defaults: the measured original pitch {@link CALIBRATED_HALF_W}×{@link CALIBRATED_HALF_H}. Note the
 * ratio is ~1:1.08 (near-square diamonds), not the classic iso 2:1 — that is what the original measures
 * as (see above). Still LIVE-TUNABLE for verification: the live entry sets it from
 * `?pitch=<fullTileWidth>` (+ optional `?pitchy=<fullCellDownStep>`) via {@link setTilePitch}, keeping
 * the measured ratio when only `?pitch` is given.
 *
 * Calibration history (why the earlier values were wrong): `32×16` was eyeballed from the art;
 * footprint-vs-sprite ratios (bridge collision area vs visible deck) once suggested `20×10` and
 * overshot. Both are superseded by the measured values above; the full method + numbers live in
 * docs/FIDELITY.md "projection".
 */
export let TILE_HALF_W = CALIBRATED_HALF_W;
export let TILE_HALF_H = CALIBRATED_HALF_H;

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
