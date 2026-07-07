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
 * The original engine's cell pitch in native pixels, MEASURED from the running game (source basis
 * "projection" — calibration-by-observation, 2026-07, superseding an earlier fit that aliased to exactly
 * HALF these values). From a uniform 7-shot corpus tiling the full 250-column top strip of one map:
 * the shots' capture scale was pinned at exactly 1.25× by five independent building-sprite templates
 * (peak scores 0.96–0.98), then 19 detected buildings were joined to their map half-cell placements and
 * the lattice solved least-squares with a free column step, row step, row-parity term and elevation term
 * — x rms 0.31 px, y rms 1.21 px, parity 0.00: **cell width 68.0 px, row step 38.0 px** (±0.1), and a
 * vertical lift of ≈1.24 px per elevation unit (unrendered for now, source basis). Cross-check
 * without templates: 7 shots × ~3170 px with the observed small seam overlaps ≈ 250 cells × 68 × 1.25.
 * At this pitch the pattern-page texture triangles (~64 px) rasterize ~1:1 onto the cell diamond, which
 * is why terrain detail reads exactly like the original's.
 */
export const CALIBRATED_HALF_W = 34;
export const CALIBRATED_HALF_H = 38;

/**
 * Projection constants — the measured original cell pitch (source basis "projection"):
 * `TILE_HALF_W` is HALF the cell width (a column step right = `2·TILE_HALF_W` px), `TILE_HALF_H` is one
 * ROW step down (also half the cell diamond's height — rows interlock at half-diamond spacing). This is
 * the master scale the whole world hangs off: every ground triangle, every feet-anchored bob (drawn at
 * its NATIVE pixel size — see the render AGENTS.md) and the camera derive from it, so getting it right
 * is what makes a bob read at the correct size against the terrain.
 *
 * Defaults: the measured original pitch {@link CALIBRATED_HALF_W}×{@link CALIBRATED_HALF_H}. Still
 * LIVE-TUNABLE for verification: the live entry sets it from `?pitch=<fullCellWidth>` (+ optional
 * `?pitchy=<cellDiamondHeight>`) via {@link setTilePitch}, keeping the measured ratio when only
 * `?pitch` is given.
 *
 * Calibration history (why the earlier values were wrong): `32×16` was eyeballed from the art;
 * footprint-vs-sprite ratios (bridge collision area vs visible deck) once suggested `20×10` and
 * overshot. Both are superseded by the measured values above; the full method + numbers live in
 * source basis "projection".
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

/**
 * Tile (col,row) → screen offset (before camera): the original's RASTER-WITH-STAGGER projection,
 * MEASURED from the running game (source basis "projection" — the map-data water grid fitted the
 * screenshots under this model 3–7× better than a rotated diamond). A column step is a pure horizontal
 * `2·TILE_HALF_W`; a row step is a pure vertical `TILE_HALF_H` with ODD rows shifted half a cell right —
 * so the whole map reads as a rectangle (not a rotated diamond) and map N/S/E/W match the screen's.
 * Cell diamonds are `2·TILE_HALF_W` wide and `2·TILE_HALF_H` tall, interlocking across rows.
 *
 * Continuous in both arguments (entities walk fractional positions): the parity stagger is interpolated
 * as a triangle wave over the row, so moving one row down slides `±TILE_HALF_W` sideways along the way —
 * the same diagonal a unit walks along the original's mesh edges. Pure.
 */
export function tileToScreen(col: number, row: number): { x: number; y: number } {
  const cycle = ((row % 2) + 2) % 2; // row's place in the 2-row stagger cycle, robust to negatives
  const stagger = 1 - Math.abs(1 - cycle); // 0 at even rows, 1 at odd, linear between
  return {
    x: (2 * col + stagger) * TILE_HALF_W,
    y: row * TILE_HALF_H,
  };
}

/**
 * Half-cell (hx,hy) → screen offset (before camera). The original's `emla` object lattice is a PLAIN
 * rectangular grid at half-cell resolution — `(hx·TILE_HALF_W, hy·TILE_HALF_H/2)` — with the cell
 * stagger arising from which half-cells the cells occupy (cell `(c,r)` sits at half-cell
 * `(2c + (r&1), 2r)`; {@link tileToScreen} of an integer cell lands exactly here). Map objects
 * (trees/stones/waves) are authored at half-cells and must NOT get the fractional-row stagger
 * interpolation a walking entity gets, hence the dedicated mapping. Pure.
 */
export function halfCellToScreen(hx: number, hy: number): { x: number; y: number } {
  return {
    x: hx * TILE_HALF_W,
    y: (hy * TILE_HALF_H) / 2,
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
