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

/**
 * The stereo pan alone of world tile `(col, row)`: its screen-side position, clamped to the sides for a
 * point off screen, with no cull and no attenuation. A voice answering the player's order pans this way
 * in the original: the pan is clamped to the edges, the volume is left whole and no screen or fog
 * test is made.
 */
export function computePan(col: number, row: number, camera: Camera, canvasW: number): number {
  const s = tileToScreen(col, row);
  const scale = camera.scale ?? 1;
  const sx = s.x * scale + camera.offsetX;
  const halfW = canvasW / 2;
  return halfW === 0 ? 0 : clamp((sx - halfW) / halfW, -1, 1) * MAX_PAN;
}

/** The fade band's depth in half-screen units: a share of the whole viewport is twice that of its half. */
const OFFSCREEN_FADE_HALF_EXTENTS = 2 * OFFSCREEN_FADE_SHARE;

/** The shared cull/attenuate/pan half: a pre-camera screen point in, `Spatial` (or `null`) out. A
 *  screen with no area hears nothing. */
function spatialiseScreenPoint(
  s: { x: number; y: number },
  camera: Camera,
  canvasW: number,
  canvasH: number,
): Spatial | null {
  const halfW = canvasW / 2;
  const halfH = canvasH / 2;
  if (!(halfW > 0 && halfH > 0)) return null;
  const scale = camera.scale ?? 1;
  // Normalised offset from centre on each axis: -1..1 within the canvas, past 1 beyond its edges.
  const nx = (s.x * scale + camera.offsetX - halfW) / halfW;
  const ny = (s.y * scale + camera.offsetY - halfH) / halfH;
  const beyond = Math.max(Math.abs(nx), Math.abs(ny)) - 1;
  const fade = beyond <= 0 ? 1 : 1 - beyond / OFFSCREEN_FADE_HALF_EXTENTS;
  if (fade <= 0) return null;
  const dist = clamp(Math.hypot(nx, ny), 0, 1);
  const gain = (EDGE_GAIN + (1 - EDGE_GAIN) * (1 - dist)) * fade;
  const pan = clamp(nx, -1, 1) * MAX_PAN;
  return { gain, pan };
}
