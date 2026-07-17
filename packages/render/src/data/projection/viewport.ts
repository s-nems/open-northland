import { clamp } from '../math.js';
import { type Camera, TILE_HALF_H, TILE_HALF_W } from './iso.js';

/**
 * The pure viewport-culling math — the "what is on screen" half of drawing a large world, kept out of
 * the GPU so it is unit-testable without a screen. The retained
 * {@link import('../../gpu/world-renderer/index.js').WorldRenderer} calls these to skip entities/terrain outside
 * the camera, so a 256×256 map only pays for the tiles a player can see; when fully zoomed out
 * (everything visible) they simply pass everything through and the renderer leans on GPU batching instead.
 *
 * No Pixi, no canvas: a {@link Camera} (`screen = world*scale + offset`) + the canvas size in, a
 * world-space rectangle / tile band out. `import type { Camera }` is erased at build, so this stays a
 * dependency-light pure module (never pulls Pixi in). Floats are fine — this is `render`.
 */

/**
 * A world-space (pre-camera) axis-aligned rectangle — the slice of the projected iso plane the camera
 * currently frames. Everything drawn lives in this space (the camera transform is the world layer's own
 * scale+position), so a draw item is visible iff its screen anchor falls inside this rect.
 */
export interface Viewport {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Invert `screen = world*scale + offset` over the canvas rect `[0,canvasW]×[0,canvasH]` to the world
 * rectangle the camera frames, grown on every side by `margin` world px. The margin is the slack that
 * keeps a tall sprite (a building whose feet are just off-screen but whose body pokes in) from popping:
 * cull by the feet anchor, but widen the box by the largest sprite extent so a straddling one still draws.
 */
export function cameraViewport(camera: Camera, canvasW: number, canvasH: number, margin = 0): Viewport {
  const scale = camera.scale ?? 1;
  // world = (screen - offset) / scale, evaluated at the canvas corners (0,0)..(canvasW,canvasH).
  const minX = (0 - camera.offsetX) / scale - margin;
  const maxX = (canvasW - camera.offsetX) / scale + margin;
  const minY = (0 - camera.offsetY) / scale - margin;
  const maxY = (canvasH - camera.offsetY) / scale + margin;
  return { minX, minY, maxX, maxY };
}

/**
 * Whether a world-space point `(x, y)` (a draw item's screen anchor) falls inside `vp`, with an extra
 * per-point `margin` on top of any slack already baked into the viewport.
 */
export function isVisible(vp: Viewport, x: number, y: number, margin = 0): boolean {
  return x >= vp.minX - margin && x <= vp.maxX + margin && y >= vp.minY - margin && y <= vp.maxY + margin;
}

/** A world-space axis-aligned box (a terrain/decor chunk or a tall-object block AABB). */
export interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Whether an axis-aligned world-space `box` overlaps the viewport — the block-cull primitive the
 * terrain and map-object layers share (a chunk/block is drawn iff its AABB meets the framed rect).
 * Touching edges count as visible. Any slack is baked into the box's own bounds by the caller.
 * `Viewport` is itself a {@link Box}, so this doubles as a rect-rect test.
 */
export function aabbIntersects(vp: Viewport, box: Box): boolean {
  return box.maxX >= vp.minX && box.minX <= vp.maxX && box.maxY >= vp.minY && box.minY <= vp.maxY;
}

/** A closed tile band (inclusive `min` AND inclusive `max`) clamped to the grid — a chunk-cull rectangle. */
export interface TileRange {
  readonly minCol: number;
  readonly maxCol: number;
  readonly minRow: number;
  readonly maxRow: number;
}

/**
 * The visible `(col,row)` band for the staggered raster: invert {@link tileToScreen}
 * (`x = (2·col + parity)·HALF_W`, `y = row·HALF_H`) over the world rect. The projection is
 * axis-aligned, so the band is a straight interval per axis — a cell's diamond reaches `±HALF_W`
 * around a centre whose x lies in `[2c·HALF_W, (2c+1)·HALF_W]` (the parity shift), and `±HALF_H`
 * (a full row step — diamonds interlock across rows) around `y = row·HALF_H`. Pad by `tileMargin`
 * tiles and clamp to `[0,gridW-1]×[0,gridH-1]`. Feeds terrain chunk visibility (a chunk is drawn
 * iff its tile AABB intersects this band).
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
