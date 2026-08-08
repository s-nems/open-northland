import { ONE as SIM_ONE } from '@open-northland/sim';

/** Fixed-point scale: one whole tile. */
export const ONE: number = SIM_ONE;

/**
 * The original's cell pitch in native px, by observation of the running game: the cell is 68.0 px wide
 * (`TILE_HALF_W` is half of it, so a column step right is `2·TILE_HALF_W`) and rows step 38.0 px
 * (±0.1), which is also half the cell diamond's height because rows interlock at half-diamond spacing.
 * At this pitch the pattern-page texture triangles (~64 px) rasterize ~1:1 onto the cell diamond.
 */
export const TILE_HALF_W = 34;
export const TILE_HALF_H = 38;

/**
 * Tile `(col, row)` → pre-camera screen offset for the original's raster-with-stagger projection (by
 * observation this model fits the running game's lattice, a rotated diamond does not): a column step is
 * a pure horizontal `2·TILE_HALF_W`, a row step a pure vertical `TILE_HALF_H` with odd rows shifted
 * half a cell right. Continuous in both arguments - an entity on a fractional row slides `±TILE_HALF_W`
 * sideways along the stagger's triangle wave.
 */
export function tileToScreen(col: number, row: number): { x: number; y: number } {
  return { x: tileToScreenX(col, row), y: tileToScreenY(row) };
}

/** {@link tileToScreen}'s X axis, split out so a per-entity hot loop allocates no `{x,y}` per call. */
export function tileToScreenX(col: number, row: number): number {
  return (2 * col + rowStagger(row)) * TILE_HALF_W;
}

/** {@link tileToScreenX} for the Y axis. */
export function tileToScreenY(row: number): number {
  return row * TILE_HALF_H;
}

/**
 * A (fractional) row's parity stagger as a triangle wave: 0 at even rows, 1 at odd, linear between,
 * and safe for negative rows.
 */
export function rowStagger(row: number): number {
  const cycle = ((row % 2) + 2) % 2;
  return 1 - Math.abs(1 - cycle);
}

/**
 * Half-cell `(hx, hy)` → pre-camera screen offset: a plain rectangular mapping, so an object authored
 * at a half-cell never picks up the fractional-row stagger a walking entity interpolates through.
 * {@link tileToScreen} of an integer cell lands exactly here. Placing odd half-cell rows at the
 * rectangular spot is a named approximation: `lmwb` byte evidence suggests they sit a quarter cell
 * further +x.
 */
export function halfCellToScreen(hx: number, hy: number): { x: number; y: number } {
  return {
    x: hx * TILE_HALF_W,
    y: (hy * TILE_HALF_H) / 2,
  };
}

/**
 * Pre-camera screen offset → the integer cell `(col, row)` whose diamond contains it, floored. A
 * cell-granularity bucket, not a pixel-exact pick: the odd-row parity half-shift is ignored.
 */
export function screenToCell(x: number, y: number): { col: number; row: number } {
  return { col: Math.floor(x / (2 * TILE_HALF_W)), row: Math.floor(y / TILE_HALF_H) };
}

/**
 * The flat `[x, y, …]` point list of a node diamond centred at `(cx, cy)` with half-extents `(hw, hh)`,
 * wound top → right → bottom → left for `Graphics.poly`.
 */
export function nodeDiamondPoly(cx: number, cy: number, hw: number, hh: number): number[] {
  return [cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy];
}

/** The camera transform every projected position passes through, `screen = world·scale + offset`. */
export interface Camera {
  /** Pan, in screen px. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Uniform zoom about the layer origin. Defaults to 1. */
  readonly scale?: number;
}

/**
 * Snap a camera's pan offsets to whole device pixels (`resolution` device px per screen px), leaving
 * `scale` untouched: nearest-sampled pixel art shimmer-crawls when a smooth pan puts texel boundaries
 * on fractional device pixels. Returns the same object when already snapped, so an idle camera
 * allocates nothing.
 */
export function snapCameraToDevicePixels(camera: Camera, resolution: number): Camera {
  const r = resolution > 0 ? resolution : 1;
  const offsetX = Math.round(camera.offsetX * r) / r;
  const offsetY = Math.round(camera.offsetY * r) / r;
  if (offsetX === camera.offsetX && offsetY === camera.offsetY) return camera;
  return { ...camera, offsetX, offsetY };
}

/**
 * Apply the camera to one world axis for draws that cannot ride the camera-transformed layer: a
 * custom-shader mesh self-places in screen space and must mirror the transform plain sprites inherit
 * from the scene graph.
 */
export function cameraScreenX(camera: Camera, worldX: number): number {
  return camera.offsetX + (camera.scale ?? 1) * worldX;
}

/** {@link cameraScreenX} for the Y axis. */
export function cameraScreenY(camera: Camera, worldY: number): number {
  return camera.offsetY + (camera.scale ?? 1) * worldY;
}

/**
 * The secondary depth-key weight in `depthKey = y + x · this`. Small enough that the x term can never
 * overturn a meaningful y difference (max |x| on a 1024-wide map ≈ 70k px contributes ~0.07), large
 * enough to order same-row overlaps stably regardless of attach order.
 */
const DEPTH_X_TIEBREAK = 1 / (1 << 20);

/**
 * The screen-depth sort key for a feet anchor at projected `(x, y)` px: the screen `y` first (lower on
 * screen draws in front), then a tiny `x` tiebreak so same-row sprites order deterministically instead
 * of flickering with attach/detach churn - Pixi's `sortableChildren` sort is stable only in
 * children-array order, which panning reshuffles.
 */
export function depthKey(x: number, y: number): number {
  return y + x * DEPTH_X_TIEBREAK;
}
