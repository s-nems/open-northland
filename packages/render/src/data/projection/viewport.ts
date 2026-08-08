import { clamp } from '../math.js';
import { type Camera, TILE_HALF_H, TILE_HALF_W } from './iso.js';

/** The pure viewport-culling math, unit-testable without a screen. */

/**
 * A world-space (pre-camera) axis-aligned rectangle - the slice of the projected plane the camera
 * frames. A draw item is visible iff its screen anchor falls inside it.
 */
export interface Viewport {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Invert `screen = world·scale + offset` over the canvas rect to the world rectangle the camera frames,
 * grown on every side by `margin` world px. That slack keeps a tall sprite culled by its feet anchor
 * from popping while its body still pokes on screen, so pass the largest sprite extent.
 */
export function cameraViewport(camera: Camera, canvasW: number, canvasH: number, margin = 0): Viewport {
  const scale = camera.scale ?? 1;
  const minX = (0 - camera.offsetX) / scale - margin;
  const maxX = (canvasW - camera.offsetX) / scale + margin;
  const minY = (0 - camera.offsetY) / scale - margin;
  const maxY = (canvasH - camera.offsetY) / scale + margin;
  return { minX, minY, maxX, maxY };
}

/** `margin` stacks on top of any slack already baked into the viewport. */
export function isVisible(vp: Viewport, x: number, y: number, margin = 0): boolean {
  return x >= vp.minX - margin && x <= vp.maxX + margin && y >= vp.minY - margin && y <= vp.maxY + margin;
}

/** A world-space axis-aligned box. */
export interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Touching edges count as visible, and any slack is baked into the box's own bounds by the caller. */
export function aabbIntersects(vp: Viewport, box: Box): boolean {
  return box.maxX >= vp.minX && box.minX <= vp.maxX && box.maxY >= vp.minY && box.minY <= vp.maxY;
}

/** A closed tile band - both `min` and `max` inclusive - clamped to the grid. */
export interface TileRange {
  readonly minCol: number;
  readonly maxCol: number;
  readonly minRow: number;
  readonly maxRow: number;
}

/**
 * The visible `(col, row)` band for the staggered raster, inverting `tileToScreen` over the world rect.
 * The projection is axis-aligned, so the band is a straight interval per axis, widened by the diamond
 * half-extents and the odd-row parity shift. Padded by `tileMargin` tiles and clamped to the grid.
 */
export function visibleTileRange(vp: Viewport, gridW: number, gridH: number, tileMargin = 0): TileRange {
  // col c covers x ∈ [(2c−1)·HALF_W, (2c+2)·HALF_W]  (centre span + diamond half-width both sides)
  const minCol = Math.floor(vp.minX / (2 * TILE_HALF_W) - 1);
  const maxCol = Math.ceil(vp.maxX / (2 * TILE_HALF_W) + 0.5);
  // row r covers y ∈ [(r−1)·HALF_H, (r+1)·HALF_H]
  const minRow = Math.floor(vp.minY / TILE_HALF_H - 1);
  const maxRow = Math.ceil(vp.maxY / TILE_HALF_H + 1);
  return {
    minCol: clamp(minCol - tileMargin, 0, gridW - 1),
    maxCol: clamp(maxCol + tileMargin, 0, gridW - 1),
    minRow: clamp(minRow - tileMargin, 0, gridH - 1),
    maxRow: clamp(maxRow + tileMargin, 0, gridH - 1),
  };
}
