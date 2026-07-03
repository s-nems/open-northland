import { type Camera, tileToScreen } from '@vinland/render/data';
import { clamp } from './math.js';

/**
 * The PURE spatial-audio math: project a world tile to the screen through the SAME camera transform
 * the renderer draws with ({@link tileToScreen} + `screen = world*scale + offset`), then decide
 * whether the emitter is on screen and, if so, how loud and how far left/right it should sound. This
 * is the "only what's on screen makes sound" contract for positioned one-shots — an emitter outside
 * the framed viewport returns `null` (silent), one near a screen edge attenuates and pans toward that
 * edge. No Web Audio here: a `(tile, camera, canvas)` in, a `{ gain, pan }` (or `null`) out, so it is
 * unit-testable without an `AudioContext`. Floats are fine — this is a render-side concern.
 */

/** Emitter falls silent this many screen px beyond the canvas edge (slack so a straddling sprite still sounds). */
export const CULL_MARGIN_PX = 96;

/** Gain at the very edge of the screen; it rises to 1 at the centre. Edges stay audible, never silent. */
export const EDGE_GAIN = 0.35;

/** Pan strength: 1 = full hard-left/right at the screen sides. Kept < 1 so nothing fully leaves an ear. */
export const MAX_PAN = 0.85;

/**
 * Loudness floor as the camera zooms OUT. A zoomed-out camera is "further away", so its sounds fade
 * toward this floor (never to silence — a wide battle view still murmurs); zooming IN past 1:1 never
 * boosts past full gain (no clipping). At scale 1 (1:1) there is no zoom attenuation.
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
 * spatialisation, or `null` when it lies outside the viewport (grown by {@link CULL_MARGIN_PX}) — the
 * caller then plays nothing, so off-screen emitters are silent. Gain falls radially from 1 at the
 * centre to {@link EDGE_GAIN} at the edge, and is further scaled down as the camera zooms OUT (a
 * further-away camera is quieter, floored at {@link ZOOM_GAIN_FLOOR}); pan tracks the horizontal screen
 * fraction. Mirrors the renderer's projection exactly so a sound comes from where its sprite is drawn.
 */
export function computeSpatial(
  col: number,
  row: number,
  camera: Camera,
  canvasW: number,
  canvasH: number,
): Spatial | null {
  const scale = camera.scale ?? 1;
  const s = tileToScreen(col, row);
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
  // Zoom attenuation: a zoomed-OUT camera (scale < 1) is further away, so quieter — floored so a wide
  // view never goes silent; zooming IN (scale >= 1) is clamped to 1, never boosting past full gain.
  const zoomGain = clamp(scale, ZOOM_GAIN_FLOOR, 1);
  const pan = clamp(nx, -1, 1) * MAX_PAN;
  return { gain: screenGain * zoomGain, pan };
}
