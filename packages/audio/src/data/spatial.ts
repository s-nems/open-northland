import { type Camera, halfCellToScreen, tileToScreen } from '@open-northland/render/data';
import { clamp } from './math.js';

/**
 * The pure spatial-audio math: project a world position to the screen through the same projections the
 * renderer draws with ({@link tileToScreen} for fractional tile positions, {@link halfCellToScreen} for
 * half-cell node addresses, + `screen = world*scale + offset`), then decide whether the emitter is on
 * screen and, if so, how loud and how far left/right it sounds. An emitter outside the framed viewport
 * returns `null` (silent); one near a screen edge attenuates and pans toward that edge.
 */

/** Emitter falls silent this many screen px beyond the canvas edge (slack so a straddling sprite still sounds). */
export const CULL_MARGIN_PX = 96;

/** Gain at the very edge of the screen; it rises to 1 at the centre. */
export const EDGE_GAIN = 0.35;

/** Pan strength: 1 = full hard-left/right at the screen sides. Kept < 1 so nothing fully leaves an ear. */
export const MAX_PAN = 0.85;

/**
 * Loudness floor as the camera zooms out — a zoomed-out camera is "further away", so its sounds fade
 * toward this floor (never to silence); zooming in past 1:1 never boosts past full gain.
 */
export const ZOOM_GAIN_FLOOR = 0.45;

/** A spatialised emitter: playback gain and stereo pan already resolved from its screen position. */
export interface Spatial {
  /** 0..1 — screen-position gain (1 at centre, {@link EDGE_GAIN} at the edge) times the zoom attenuation. */
  readonly gain: number;
  /** -1 (hard left) .. +1 (hard right), scaled by {@link MAX_PAN}. */
  readonly pan: number;
}

/**
 * Project world tile `(col, row)` through `camera` onto a `canvasW × canvasH` screen and return its
 * spatialisation, or `null` when it lies outside the viewport (grown by {@link CULL_MARGIN_PX}).
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
 * {@link computeSpatial} for a half-cell node address `(hx, hy)` — the space every `SimEvent.at` carries
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

/** The shared cull/attenuate/pan half: a pre-camera screen point in, `Spatial` (or `null`) out. */
function spatialiseScreenPoint(
  s: { x: number; y: number },
  camera: Camera,
  canvasW: number,
  canvasH: number,
): Spatial | null {
  const scale = camera.scale ?? 1;
  const sx = s.x * scale + camera.offsetX;
  const sy = s.y * scale + camera.offsetY;
  if (
    sx < -CULL_MARGIN_PX ||
    sx > canvasW + CULL_MARGIN_PX ||
    sy < -CULL_MARGIN_PX ||
    sy > canvasH + CULL_MARGIN_PX
  ) {
    return null;
  }
  const halfW = canvasW / 2;
  const halfH = canvasH / 2;
  // Normalised offset from centre on each axis (-1..1 within the canvas), then radial distance.
  const nx = halfW === 0 ? 0 : (sx - halfW) / halfW;
  const ny = halfH === 0 ? 0 : (sy - halfH) / halfH;
  const dist = clamp(Math.hypot(nx, ny), 0, 1);
  const screenGain = EDGE_GAIN + (1 - EDGE_GAIN) * (1 - dist);
  // Zoom attenuation: scale clamped into [ZOOM_GAIN_FLOOR, 1].
  const zoomGain = clamp(scale, ZOOM_GAIN_FLOOR, 1);
  const pan = clamp(nx, -1, 1) * MAX_PAN;
  return { gain: screenGain * zoomGain, pan };
}
