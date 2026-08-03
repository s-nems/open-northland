import type { Camera } from '@open-northland/render';

/** The pure pan and zoom reducers and their bounds; each takes a {@link Camera} and returns a new one. */

/**
 * Zoom bounds the scroll wheel clamps to. The lower bound caps the visible tile and bob count, and so
 * the frame cost, rather than fitting a whole map on screen: a mid-size decoded map must not fit whole.
 * Lower it only together with a zoom-out LOD.
 */
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 8;
/** CSS px from a canvas edge within which the pointer edge-scrolls. */
export const EDGE_SCROLL_MARGIN = 24;

/** The interactive camera's speed knobs, read each frame by the controller. */
export interface CameraTuning {
  /** Screen px/s the camera pans while an arrow key is held. */
  readonly arrowPanSpeed: number;
  /** Edge-scroll speed (screen px/s) at the deepest point of the margin; ramps linearly from 0. */
  readonly edgeScrollSpeed: number;
  /** Wheel-zoom glide speed in log-zoom units per second, so each factor of e takes `1/rate` seconds
   *  and a long glide never lurches then crawls like an exponential ease. */
  readonly zoomGlideRate: number;
}

/** Approximation: eye-tuned speeds. The zoom rate lands one wheel notch in roughly two frames. */
export const DEFAULT_CAMERA_TUNING: CameraTuning = {
  arrowPanSpeed: 900,
  edgeScrollSpeed: 1500,
  zoomGlideRate: 4,
};

/**
 * The edge-scroll pan velocity in screen px/s for a pointer at canvas CSS position `(x, y)`. Ramps
 * linearly from 0 at the margin's inner boundary to `speed` at the edge, and is zero deeper inside.
 * Scroll convention: a pointer at the left edge reveals the world leftward, giving a positive `vx`.
 */
export function edgePanVelocity(
  x: number,
  y: number,
  width: number,
  height: number,
  speed: number,
): { vx: number; vy: number } {
  const depth = (into: number): number =>
    into >= EDGE_SCROLL_MARGIN ? 0 : (EDGE_SCROLL_MARGIN - Math.max(0, into)) / EDGE_SCROLL_MARGIN;
  return {
    vx: (depth(x) - depth(width - x)) * speed,
    vy: (depth(y) - depth(height - y)) * speed,
  };
}

/**
 * One step of the wheel-zoom glide: move the scale toward `target` at a constant `ratePerS` in log-zoom
 * space, so doubling takes the same time from 1 to 2 as from 4 to 8. Anchored at the cursor, and lands
 * exactly on the target once within one step of it.
 */
export function stepZoomToward(
  cam: Camera,
  target: number,
  cursorX: number,
  cursorY: number,
  dtMs: number,
  ratePerS: number,
): Camera {
  const scale = cam.scale ?? 1;
  if (scale === target) return cam;
  const gap = Math.log(target / scale);
  const step = (ratePerS * dtMs) / 1000;
  const next = Math.abs(gap) <= step ? target : scale * Math.exp(Math.sign(gap) * step);
  return zoomCameraAt(cam, next / scale, cursorX, cursorY);
}

/** Pan the camera by a screen-pixel delta, preserving `scale`. */
export function panCamera(cam: Camera, dx: number, dy: number): Camera {
  return { ...cam, offsetX: cam.offsetX + dx, offsetY: cam.offsetY + dy };
}

/**
 * Zoom by `factor`, keeping the world point under `(cursorX, cursorY)` pinned to that screen point. With
 * `screen = world*scale + offset` the world under the cursor is `(cursor - offset)/scale`, and the offset
 * is re-solved after rescaling. The new scale is clamped to `[MIN_ZOOM, MAX_ZOOM]`.
 */
export function zoomCameraAt(cam: Camera, factor: number, cursorX: number, cursorY: number): Camera {
  const scale = cam.scale ?? 1;
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale * factor));
  if (next === scale) return cam;
  const worldX = (cursorX - cam.offsetX) / scale;
  const worldY = (cursorY - cam.offsetY) / scale;
  return { offsetX: cursorX - worldX * next, offsetY: cursorY - worldY * next, scale: next };
}
