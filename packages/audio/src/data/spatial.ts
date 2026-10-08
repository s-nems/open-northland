import { type Camera, halfCellToScreen, tileToScreen } from '@open-northland/render/data';
import { clamp } from './math.js';

/**
 * The pure spatial-audio math: project a world position to the screen through the renderer's own
 * projections ({@link tileToScreen} for fractional tile positions, {@link halfCellToScreen} for
 * half-cell node addresses, then `screen = world*scale + offset`), attenuate + pan toward the nearer
 * edge, fade out over a band past the edge and cull beyond it (`null`).
 */

/**
 * How far past each screen edge a positioned sound still carries, as a share of the viewport's own
 * width (past a side) or height (past the top or bottom). It fades linearly from {@link EDGE_GAIN} at
 * the edge to silence at the band's end, where it is culled. Approximation: the original cuts exactly
 * at the edge, the documented RTS practice fades out to a whole screen beyond; a quarter keeps the
 * just-off-screen fight audible while the band stays a fixed share of the screen.
 */
export const OFFSCREEN_FADE_SHARE = 0.25;

/** Gain at the very edge of the screen; it rises to 1 at the centre. */
export const EDGE_GAIN = 0.35;

/** Pan strength: 1 = full hard-left/right at the screen sides. Kept < 1 so nothing fully leaves an ear. */
export const MAX_PAN = 0.85;

/** A spatialised emitter: playback gain and stereo pan already resolved from its screen position. */
export interface Spatial {
  /** 0..1 - screen-position gain (1 at centre, {@link EDGE_GAIN} at the edge). Zoom is not in it: the
   *  engine applies it once per layer ({@link import('./perspective.js').perspectiveGain}). */
  readonly gain: number;
  /** -1 (hard left) .. +1 (hard right), scaled by {@link MAX_PAN}. */
  readonly pan: number;
}

/**
 * Project world tile `(col, row)` through `camera` onto a `canvasW × canvasH` screen and return its
 * spatialisation, or `null` when it lies past the viewport's {@link OFFSCREEN_FADE_SHARE} band.
 */
export function computeSpatial(
  col: number,
  row: number,
  camera: Camera,
  canvasW: number,
  canvasH: number,
): Spatial | null {
  return spatialiseScreenPoint(tileToScreen(col, row), camera, canvasW, canvasH);
}

/**
 * {@link computeSpatial} for a half-cell node address `(hx, hy)` - the space every `SimEvent.at` carries
 * (the same grid as command payloads). Projects through the renderer's own {@link halfCellToScreen}, so
 * the node→screen stagger math has one owner.
 */
export function computeSpatialAtNode(
  hx: number,
  hy: number,
  camera: Camera,
  canvasW: number,
  canvasH: number,
): Spatial | null {
  return spatialiseScreenPoint(halfCellToScreen(hx, hy), camera, canvasW, canvasH);
}

/** The pan of a normalised horizontal screen offset (-1..1 inside the canvas), clamped to the sides. */
export function panAt(nx: number): number {
  return clamp(nx, -1, 1) * MAX_PAN;
}

/** World tile `(col, row)`'s offset from the screen centre on each axis, -1..1 within the canvas and past
 *  1 beyond its edges; null for a screen with no area. */
export function screenOffset(
  col: number,
  row: number,
  camera: Camera,
  canvasW: number,
  canvasH: number,
): ScreenOffset | null {
  return offsetOfScreenPoint(tileToScreen(col, row), camera, canvasW, canvasH);
}

/** A point's offset from the screen centre in half-screen units on each axis. */
export interface ScreenOffset {
  readonly nx: number;
  readonly ny: number;
}

/** A pre-camera screen point's {@link ScreenOffset}; null for a screen with no area. */
export function offsetOfScreenPoint(
  s: { x: number; y: number },
  camera: Camera,
  canvasW: number,
  canvasH: number,
): ScreenOffset | null {
  const halfW = canvasW / 2;
  const halfH = canvasH / 2;
  if (!(halfW > 0 && halfH > 0)) return null;
  const scale = camera.scale ?? 1;
  return {
    nx: (s.x * scale + camera.offsetX - halfW) / halfW,
    ny: (s.y * scale + camera.offsetY - halfH) / halfH,
  };
}

/** The fade band's depth in half-screen units: a share of the whole viewport is twice that of its half. */
const OFFSCREEN_FADE_HALF_EXTENTS = 2 * OFFSCREEN_FADE_SHARE;

/** The share of its gain a point keeps for lying past the screen edge: 1 on screen, falling to 0 at the
 *  end of the {@link OFFSCREEN_FADE_SHARE} band. */
function edgeFade({ nx, ny }: ScreenOffset): number {
  const beyond = Math.max(Math.abs(nx), Math.abs(ny)) - 1;
  return beyond <= 0 ? 1 : 1 - beyond / OFFSCREEN_FADE_HALF_EXTENTS;
}

/** Whether a positioned sound at `offset` is heard at all: on screen or inside the fade band. */
export function inEarshot(offset: ScreenOffset): boolean {
  return edgeFade(offset) > 0;
}

/** The shared cull/attenuate/pan half: a pre-camera screen point in, `Spatial` (or `null`) out. A
 *  screen with no area hears nothing. */
function spatialiseScreenPoint(
  s: { x: number; y: number },
  camera: Camera,
  canvasW: number,
  canvasH: number,
): Spatial | null {
  const offset = offsetOfScreenPoint(s, camera, canvasW, canvasH);
  if (offset === null) return null;
  const fade = edgeFade(offset);
  if (fade <= 0) return null;
  const { nx, ny } = offset;
  const dist = clamp(Math.hypot(nx, ny), 0, 1);
  const gain = (EDGE_GAIN + (1 - EDGE_GAIN) * (1 - dist)) * fade;
  return { gain, pan: panAt(nx) };
}
