import { ONE as SIM_ONE } from '@open-northland/sim';

/**
 * Isometric projection + the camera transform — the dependency-light math the rest of `render` builds
 * on. It lives in its own module rather than the {@link import('../../index.js')} barrel so the pure
 * scene/terrain/viewport modules and the GPU renderer can import it without the barrel↔module cycle,
 * which forces a TDZ workaround.
 */

/** Fixed-point scale (one whole tile), re-exported so the scene layer reads snapshot positions. */
export const ONE: number = SIM_ONE;

/**
 * The original engine's cell pitch in native pixels, measured from the running game (source basis
 * "projection", 2026-07, which records the full method): `TILE_HALF_W` is half the 68.0 px cell width,
 * so a column step right is `2·TILE_HALF_W`; `TILE_HALF_H` is the 38.0 px row step (±0.1), and also half
 * the cell diamond's height (rows interlock at half-diamond spacing). At this pitch the pattern-page
 * texture triangles (~64 px) rasterize ~1:1 onto the cell diamond. The elevation lift derives from the
 * row step and is owned by {@link import('../terrain/index.js')}.
 */
export const TILE_HALF_W = 34;
export const TILE_HALF_H = 38;

/**
 * Tile (col,row) → screen offset (before camera): the original's raster-with-stagger projection (source
 * basis "projection" — this model fits the running game's lattice, a rotated diamond does not). A column
 * step is a pure horizontal `2·TILE_HALF_W`; a row step is a pure vertical `TILE_HALF_H` with odd rows
 * shifted half a cell right — so the whole map reads as a rectangle and map N/S/E/W match the screen's.
 * Cell diamonds are `2·TILE_HALF_W` wide and `2·TILE_HALF_H` tall, interlocking across rows.
 *
 * Continuous in both arguments (entities walk fractional positions): the parity stagger is interpolated
 * as a triangle wave over the row, so moving one row down slides `±TILE_HALF_W` sideways along the way —
 * the same diagonal a unit walks along the original's mesh edges.
 */
export function tileToScreen(col: number, row: number): { x: number; y: number } {
  return {
    x: (2 * col + rowStagger(row)) * TILE_HALF_W,
    y: row * TILE_HALF_H,
  };
}

/**
 * The parity stagger of a (fractional) row, as a triangle wave: 0 at even rows, 1 at odd, linear
 * between (robust to negative rows). The fog cell mapper (`fog/mask.ts`) shares it (halved for its
 * half-cell step) so a unit resolves to the same cell the sim's vision mask stamped.
 */
export function rowStagger(row: number): number {
  const cycle = ((row % 2) + 2) % 2;
  return 1 - Math.abs(1 - cycle);
}

/**
 * Half-cell (hx,hy) → screen offset (before camera). The original's `emla` object lattice is a plain
 * rectangular grid at half-cell resolution — `(hx·TILE_HALF_W, hy·TILE_HALF_H/2)` — with the cell
 * stagger arising from which half-cells the cells occupy (cell `(c,r)` sits at half-cell
 * `(2c + (r&1), 2r)`; {@link tileToScreen} of an integer cell lands exactly here). Map objects
 * (trees/stones/waves) are authored at half-cells and must not get the fractional-row stagger
 * interpolation a walking entity gets, hence the dedicated mapping.
 */
export function halfCellToScreen(hx: number, hy: number): { x: number; y: number } {
  return {
    x: hx * TILE_HALF_W,
    y: (hy * TILE_HALF_H) / 2,
  };
}

/**
 * Screen offset (pre-camera) → the integer cell `(col, row)` whose diamond contains it — the cell-resolution
 * inverse of {@link tileToScreen}/{@link halfCellToScreen}, floored. A cell spans `2·TILE_HALF_W` across and
 * one `TILE_HALF_H` row step down (cell `(c,r)` occupies half-cell nodes `2c..2c+1 × 2r..2r+1`), so
 * `col = ⌊x / (2·TILE_HALF_W)⌋`, `row = ⌊y / TILE_HALF_H⌋`. Ignores the odd-row parity half-shift — this is a
 * cell-granularity bucket (e.g. a world object's fog-state lookup), not a pixel-exact pick.
 */
export function screenToCell(x: number, y: number): { col: number; row: number } {
  return { col: Math.floor(x / (2 * TILE_HALF_W)), row: Math.floor(y / TILE_HALF_H) };
}

/**
 * The flat `[x, y, …]` point list of a node diamond centred at `(cx, cy)` with half-extents `(hw, hh)`,
 * wound top → right → bottom → left — the shape a single half-cell node fills on the lattice. The
 * world-space per-cell wash ({@link import('../../gpu/overlays/placement-overlay.js').PlacementOverlayLayer})
 * feeds it straight to `Graphics.poly` with its own padded + resolution-scaled `(hw, hh)`.
 */
export function nodeDiamondPoly(cx: number, cy: number, hw: number, hh: number): number[] {
  return [cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy];
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
 * Snap a camera's pan offsets to whole device pixels (`resolution` device px per screen px), leaving
 * `scale` untouched. Nearest-sampled pixel art shimmer-crawls when a smooth pan puts texel boundaries
 * on fractional device pixels — snapping the layer offset pins the sampling phase so a pan steps
 * texels whole. Returns the same object when already snapped (no per-frame allocation on an idle
 * camera). Pure; the interactive renderer applies it, the deterministic `?shot` path never does.
 */
export function snapCameraToDevicePixels(camera: Camera, resolution: number): Camera {
  const r = resolution > 0 ? resolution : 1;
  const offsetX = Math.round(camera.offsetX * r) / r;
  const offsetY = Math.round(camera.offsetY * r) / r;
  if (offsetX === camera.offsetX && offsetY === camera.offsetY) return camera;
  return { ...camera, offsetX, offsetY };
}

/**
 * Apply the camera to one world axis — `screen = world·scale + offset` — for the case that needs it
 * explicitly: the team-colour {@link import('../../gpu/paletted-sprite/index.js').PalettedSprite} meshes
 * self-place in screen space (a custom-shader mesh can't ride the camera-transformed layer), so they
 * mirror the transform plain sprites inherit from the scene graph. Split X/Y (not a `{x,y}` return) so
 * the per-frame paletted path allocates nothing.
 */
export function cameraScreenX(camera: Camera, worldX: number): number {
  return camera.offsetX + (camera.scale ?? 1) * worldX;
}

/** {@link cameraScreenX} for the Y axis. */
export function cameraScreenY(camera: Camera, worldY: number): number {
  return camera.offsetY + (camera.scale ?? 1) * worldY;
}

/**
 * The deterministic secondary depth key weight: a feet-anchored sprite sorts by `depthKey = y + x *
 * this`. Small enough that the x term can never overturn a meaningful y difference (max |x| on a
 * 1024-wide map ≈ 32k px → contributes ~0.03), large enough to order same-row overlaps stably
 * regardless of attach order.
 */
const DEPTH_X_TIEBREAK = 1 / (1 << 20);

/**
 * The screen-depth sort key for a feet anchor at projected `(x, y)` px: primarily the screen `y`
 * (lower on screen = drawn later = in front), with a tiny `x` tiebreak ({@link DEPTH_X_TIEBREAK}) so
 * two sprites on the same row order deterministically instead of flickering with attach/detach churn
 * (Pixi's `sortableChildren` sort is stable only in children-array order, which panning reshuffles).
 * The pooled entities and the tall map objects share this key so a settler and the tree it walks
 * behind sort into one painter order.
 */
export function depthKey(x: number, y: number): number {
  return y + x * DEPTH_X_TIEBREAK;
}
