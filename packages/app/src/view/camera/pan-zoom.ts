import type { Camera } from '@open-northland/render';

/**
 * The pure pan/zoom reducers and their bounds — the interactive camera's *math*, unit-tested headless
 * (`test/camera.test.ts`). Each takes a {@link Camera} and returns a new one; no DOM, no Pixi. The DOM
 * controller (`controller.ts`) drives these from real mouse/wheel/key events.
 */

/**
 * Zoom bounds the scroll-wheel clamps to, so the world can't shrink to nothing or balloon unusably. The
 * lower bound is deliberate: an RTS renders only what's on screen, so the min zoom bounds the visible tile
 * + bob count (and thus frame cost), not a whole-map fit — a mid-size decoded map must NOT fit on screen
 * whole (hands-on feedback + the measured zoomed-out allocation churn,
 * `docs/tickets/render/zoom-out-allocation-churn.md`). `0.35` (~3× out) still frames a battle or a
 * settlement cluster; lower it only alongside a zoom-out LOD (marker sprites + animation freeze).
 */
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 8;
/** CSS px from a canvas edge within which the pointer edge-scrolls (the RTS screen-edge pan). */
export const EDGE_SCROLL_MARGIN = 24;

/** The interactive camera's speed knobs, read each frame by the controller. Eye-tuned defaults in
 *  {@link DEFAULT_CAMERA_TUNING}. */
export interface CameraTuning {
  /** Screen px/s the camera pans while an arrow key is held. */
  readonly arrowPanSpeed: number;
  /** Edge-scroll speed (screen px/s) at the deepest point of the margin; ramps linearly from 0. */
  readonly edgeScrollSpeed: number;
  /** Wheel-zoom glide speed in log-zoom units per second — LINEAR: the scale travels toward its
   *  target at this constant perceptual rate (each ×e of zoom takes `1/rate` seconds), so a long
   *  glide never lurches fast then crawls the tail like an exponential ease. */
  readonly zoomGlideRate: number;
}

/** The default camera speeds ({@link CameraTuning}). The zoom rate is tuned so one wheel notch
 *  (×1.1 ≈ 0.095 log units) lands in ~2 frames — responsive, the glide only smooths the step — while
 *  a stacked burst still travels the full MIN..MAX range in under a second. */
export const DEFAULT_CAMERA_TUNING: CameraTuning = {
  arrowPanSpeed: 900,
  edgeScrollSpeed: 1500,
  zoomGlideRate: 4,
};

/**
 * The edge-scroll pan velocity (screen px/s, camera-scroll convention: pointer at the LEFT edge reveals
 * the world leftward → positive `vx`, like a held ArrowLeft) for a pointer at canvas CSS position
 * `(x, y)` in a `width × height` canvas. Ramps linearly from 0 at the margin's inner boundary to
 * `speed` ({@link CameraTuning.edgeScrollSpeed}) at the edge; `(0, 0)` anywhere deeper inside. Pure.
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
 * One LINEAR step of the wheel-zoom glide: move the camera's scale toward `target` at a constant
 * `ratePerS` in log-zoom space ({@link CameraTuning.zoomGlideRate} — perceptually uniform: ×2 takes
 * the same time zooming from 1→2 as from 4→8), anchored at the cursor like {@link zoomCameraAt},
 * landing exactly on the target when within one step of it. Returns the camera untouched when
 * already there. Pure.
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

/** Pan the camera by a screen-pixel delta (mouse drag / arrow step). Pure; preserves `scale`. */
export function panCamera(cam: Camera, dx: number, dy: number): Camera {
  return { ...cam, offsetX: cam.offsetX + dx, offsetY: cam.offsetY + dy };
}

/**
 * Zoom by `factor`, keeping the world point currently under `(cursorX, cursorY)` pinned to that screen
 * point (so the view magnifies toward the cursor, not the layer origin). `screen = world*scale + offset`,
 * so the world under the cursor is `(cursor − offset)/scale`; after rescaling we re-solve the offset that
 * keeps that world point under the cursor. The new scale is clamped to [{@link MIN_ZOOM},{@link MAX_ZOOM}];
 * if the clamp leaves the scale unchanged the camera is returned untouched. Pure.
 */
export function zoomCameraAt(cam: Camera, factor: number, cursorX: number, cursorY: number): Camera {
  const scale = cam.scale ?? 1;
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale * factor));
  if (next === scale) return cam;
  const worldX = (cursorX - cam.offsetX) / scale;
  const worldY = (cursorY - cam.offsetY) / scale;
  return { offsetX: cursorX - worldX * next, offsetY: cursorY - worldY * next, scale: next };
}
