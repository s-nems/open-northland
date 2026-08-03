import type { Camera } from '@open-northland/render';
import {
  type CameraTuning,
  DEFAULT_CAMERA_TUNING,
  edgePanVelocity,
  MAX_ZOOM,
  MIN_ZOOM,
  panCamera,
  stepZoomToward,
} from './pan-zoom.js';
import { clientToScreen, screenScale } from './screen-scale.js';

/**
 * The interactive camera's DOM controller - app-layer I/O (DOM + floats, fine here, never in `sim`) that
 * wraps the pure {@link panCamera}/{@link zoomCameraAt} reducers around live input so a human can pan
 * (middle-mouse drag / arrow keys / RTS screen-edge scroll) and zoom (scroll wheel, eased toward its
 * target). Installed by the two playable entries over `frame.ts`'s starting frame; the deterministic
 * `?shot` entry never installs it, so the reproducible PNG is unaffected.
 */

/** Per-wheel-notch zoom factor (one notch in multiplies, one out divides). */
const WHEEL_ZOOM_STEP = 1.1;
/** The arrow keys the controller pans on (so it ignores every other key). */
const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
/** Max wall-clock ms one held-key pan step integrates - a backgrounded tab resumes smoothly, not with a lurch. */
const MAX_PAN_STEP_MS = 100;

/** An installed interactive camera: read the current transform, advance held-key pan, tear down. */
export interface CameraController {
  /** The current {@link Camera} to hand the renderer's `update`. */
  camera(): Camera;
  /** Apply held-arrow-key panning for a wall-clock delta in ms - call once per frame. */
  update(dtMs: number): void;
  /**
   * Replace the current frame outright (the minimap's click-to-jump). The next `camera()` read returns
   * `next` verbatim; an in-flight middle-drag simply continues panning from the new frame.
   */
  jumpTo(next: Camera): void;
  /**
   * Install a predicate that claims a client point for the HUD; while it returns true for the cursor, the
   * wheel does not zoom (an open window scrolls instead). Pass `null` to clear. The game view wires the
   * tool panel's `claimsWheel` here (an open pop-up window only - not the broad `claimsPointer`, which also
   * covers the strip and active placement, where the wheel should still zoom) so scrolling a pop-up list
   * never also zooms the world behind it.
   */
  setPointerGuard(guard: ((clientX: number, clientY: number) => boolean) | null): void;
  /**
   * Install a predicate that claims a client point for the HUD against EDGE SCROLLING. The game view
   * wires the open pop-up windows + the minimap here - surfaces whose hover must not also pan the
   * camera. The tool-panel STRIP deliberately does NOT claim: it hugs the left screen edge, and the
   * RTS edge-pan must keep working when the cursor rests on it. Pass `null` to clear.
   */
  setEdgeGuard(guard: ((clientX: number, clientY: number) => boolean) | null): void;
  /** Remove every installed DOM listener. */
  dispose(): void;
}

/** `resolution` is the owning renderer's device-px-per-screen-px (`app.renderer.resolution`) - needed to
 *  map mouse deltas into screen px on the HiDPI window canvas (see {@link screenScale}). */
export function createCameraController(
  canvas: HTMLCanvasElement,
  initial: Camera,
  resolution: number,
): CameraController {
  let cam: Camera = initial;
  const tuning: CameraTuning = DEFAULT_CAMERA_TUNING;
  const held = new Set<string>();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  // While this claims the cursor (an open HUD window), the wheel scrolls that window, not the camera.
  let pointerGuard: ((clientX: number, clientY: number) => boolean) | null = null;
  // While this claims the cursor (any HUD surface), the screen edge under it does not pan.
  let edgeGuard: ((clientX: number, clientY: number) => boolean) | null = null;
  // The wheel zoom's glide state: the clamped scale the camera eases toward, anchored at the last
  // wheel cursor (screen px) so a rapid notch burst magnifies about one point, smoothly.
  let targetScale = initial.scale ?? 1;
  let zoomAnchorX = 0;
  let zoomAnchorY = 0;
  // The edge-scroll probe: the last `mousemove` sample that landed ON the canvas (client px), null while
  // the cursor is elsewhere, the window is unfocused, or nothing has moved yet (a parked cursor waits).
  let pointerSample: { readonly x: number; readonly y: number } | null = null;

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 1) return; // middle button only
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault(); // suppress the middle-click autoscroll widget
  };
  const onMouseMove = (e: MouseEvent): void => {
    // Every move re-arms the probe, because `mouseenter` fires only on a boundary crossing: a refocus
    // with the cursor already resting over the canvas gets none. Hit target rather than canvas rect, so a
    // DOM element stacked over the canvas (an open picker window's full-screen backdrop) disarms it.
    pointerSample = e.target === canvas ? { x: e.clientX, y: e.clientY } : null;
    if (!dragging) return;
    const { sx, sy } = screenScale(canvas, resolution);
    cam = panCamera(cam, (e.clientX - lastX) * sx, (e.clientY - lastY) * sy);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onMouseUp = (e: MouseEvent): void => {
    if (e.button === 1) dragging = false;
  };
  // The crossing still disarms: a cursor that leaves the browser window lands no further `mousemove`.
  const onMouseLeave = (): void => {
    pointerSample = null;
  };
  const onWheel = (e: WheelEvent): void => {
    // Over an open HUD window the wheel belongs to that window's list, not the camera - leave the event
    // for the panel's own handler (which scrolls + preventDefaults) and don't zoom the world behind it.
    if (pointerGuard?.(e.clientX, e.clientY)) return;
    e.preventDefault(); // don't scroll the page
    const { x, y } = clientToScreen(canvas, resolution, e.clientX, e.clientY);
    // Retarget the glide instead of zooming outright: update() eases the scale toward the (clamped)
    // target about this anchor, so stacked notches read as one smooth magnification.
    const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
    targetScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetScale * factor));
    zoomAnchorX = x;
    zoomAnchorY = y;
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!ARROW_KEYS.has(e.key)) return;
    held.add(e.key);
    e.preventDefault(); // arrows would otherwise scroll the page
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.key);
  };
  // Losing focus mid-gesture (alt-tab, devtools) drops the keyup/mouseup, which would otherwise leave a
  // key stuck in `held` (the camera pans forever) or `dragging` stuck true. Reset on blur.
  const onBlur = (): void => {
    held.clear();
    dragging = false;
    pointerSample = null;
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    camera: () => cam,
    jumpTo: (next) => {
      cam = next;
      // The jump replaces the frame outright, so the wheel glide retargets to the new scale (a minimap
      // jump must not carry the old glide into the new view).
      targetScale = next.scale ?? 1;
      // A drag in flight keeps panning from the new frame: its deltas apply per-move (lastX/lastY track
      // the cursor, not the camera), so no drag state needs resetting here.
    },
    setPointerGuard: (guard) => {
      pointerGuard = guard;
    },
    setEdgeGuard: (guard) => {
      edgeGuard = guard;
    },
    update: (dtMs) => {
      // Clamp the delta so a held key doesn't lurch the camera after the tab was backgrounded (RAF
      // pauses, then resumes with one huge elapsed) - the pan stays smooth, never a jump.
      const dt = Math.min(dtMs, MAX_PAN_STEP_MS);
      // Wheel zoom glide: ease the scale toward the last wheel target about its cursor anchor.
      if (targetScale !== (cam.scale ?? 1)) {
        cam = stepZoomToward(cam, targetScale, zoomAnchorX, zoomAnchorY, dt, tuning.zoomGlideRate);
      }
      // Pan velocity (screen px/s), applied DIRECTLY - no ramp-up/glide-out easing: an RTS pan must
      // start and stop with the input (hands-on feedback; the spatial edge-margin ramp in
      // `edgePanVelocity` still grades the speed by pointer depth). Camera-scroll convention
      // throughout: an input reveals the world in its direction (look right → the world slides
      // left → offset shrinks).
      let desiredX = 0;
      let desiredY = 0;
      if (held.has('ArrowLeft')) desiredX += tuning.arrowPanSpeed;
      if (held.has('ArrowRight')) desiredX -= tuning.arrowPanSpeed;
      if (held.has('ArrowUp')) desiredY += tuning.arrowPanSpeed;
      if (held.has('ArrowDown')) desiredY -= tuning.arrowPanSpeed;
      // Edge scroll: a pointer sample resting in the margin band pans, but not while mid-drag (the drag
      // owns the motion), the window is unfocused (RAF still runs when visible), or a HUD surface claims
      // the point (an open window / the minimap must not also pan). A LEFT-drag marquee is not suppressed
      // - dragging a selection box into the margin pans under the screen-anchored box (a named
      // tradeoff: RTS players use exactly that to select past the screen edge).
      if (
        pointerSample &&
        !dragging &&
        document.hasFocus() &&
        edgeGuard?.(pointerSample.x, pointerSample.y) !== true
      ) {
        const { sx, sy, rect } = screenScale(canvas, resolution);
        const edge = edgePanVelocity(
          pointerSample.x - rect.left,
          pointerSample.y - rect.top,
          rect.width,
          rect.height,
          tuning.edgeScrollSpeed,
        );
        desiredX += edge.vx * sx; // CSS px/s → screen px/s, same scroll convention as the arrows
        desiredY += edge.vy * sy;
      }
      if (desiredX !== 0 || desiredY !== 0) {
        cam = panCamera(cam, (desiredX * dt) / 1000, (desiredY * dt) / 1000);
      }
    },
    dispose: () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
