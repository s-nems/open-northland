import type { Camera } from '@open-northland/render';
import { isTypingTarget } from '../../hud/hotkeys.js';
import type { KeyBindings } from '../../hud/keybindings.js';
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
 * App-layer DOM controller wrapping the pure pan and zoom reducers around live input. The deterministic
 * `?shot` entry never installs it, so a reproducible PNG is unaffected.
 */

/** Per-wheel-notch zoom factor (one notch in multiplies, one out divides). */
const WHEEL_ZOOM_STEP = 1.1;
/** Max wall-clock ms one held-key pan step integrates - a backgrounded tab resumes smoothly, not with a lurch. */
const MAX_PAN_STEP_MS = 100;

type PanAction = 'panLeft' | 'panRight' | 'panUp' | 'panDown';
const PAN_ACTIONS: readonly PanAction[] = ['panLeft', 'panRight', 'panUp', 'panDown'];

export interface CameraController {
  camera(): Camera;
  /** Apply held-arrow-key panning for a wall-clock delta in ms; call once per frame. */
  update(dtMs: number): void;
  /** Replace the frame outright; an in-flight middle-drag keeps panning from the new frame. */
  jumpTo(next: Camera): void;
  /** Suspend camera gestures and discard held, dragged, edge-pan, and glide state. */
  setSuspended(suspended: boolean): void;
  /**
   * Claim a client point for the HUD so the wheel does not zoom there; `null` clears. Wired to open
   * pop-up windows only, since the wheel should still zoom over the strip and during placement.
   */
  setPointerGuard(guard: ((clientX: number, clientY: number) => boolean) | null): void;
  /**
   * Claim a client point for the HUD against edge scrolling; `null` clears. The tool-panel strip
   * deliberately does not claim: it hugs the left screen edge, where edge-pan must keep working.
   */
  setEdgeGuard(guard: ((clientX: number, clientY: number) => boolean) | null): void;
  dispose(): void;
}

/** `resolution` reads the owning renderer's live device px per screen px, needed to map mouse deltas on
 *  a HiDPI canvas; a captured value would go stale when a DPR change re-sizes the renderer. */
export function createCameraController(
  canvas: HTMLCanvasElement,
  initial: Camera,
  resolution: () => number,
  bindings: KeyBindings,
): CameraController {
  let cam: Camera = initial;
  const tuning: CameraTuning = DEFAULT_CAMERA_TUNING;
  const panActionByCode = new Map<string, PanAction>();
  for (const action of PAN_ACTIONS) {
    const code = bindings[action];
    if (code !== null) panActionByCode.set(code, action);
  }
  const held = new Set<PanAction>();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pointerGuard: ((clientX: number, clientY: number) => boolean) | null = null;
  let edgeGuard: ((clientX: number, clientY: number) => boolean) | null = null;
  // The clamped scale the wheel glide eases toward, anchored at the last wheel cursor in screen px, so
  // a burst of notches magnifies smoothly about one point.
  let targetScale = initial.scale ?? 1;
  let zoomAnchorX = 0;
  let zoomAnchorY = 0;
  // The edge-scroll probe: the last `mousemove` sample that landed on the canvas, in client px. Null
  // while the cursor is elsewhere or nothing has moved yet, so a parked cursor waits.
  let pointerSample: { readonly x: number; readonly y: number } | null = null;
  let suspended = false;

  const onMouseDown = (e: MouseEvent): void => {
    if (suspended) return;
    if (e.button !== 1) return; // middle button only
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault(); // suppress the middle-click autoscroll widget
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (suspended) return;
    // Every move re-arms the probe, because `mouseenter` fires only on a boundary crossing and a refocus
    // over the canvas gets none. Tested by hit target, so a DOM element stacked over the canvas disarms it.
    pointerSample = e.target === canvas ? { x: e.clientX, y: e.clientY } : null;
    if (!dragging) return;
    const { sx, sy } = screenScale(canvas, resolution());
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
    if (suspended) return;
    // The event is left for the claiming panel's own handler, which scrolls its list and preventDefaults.
    if (pointerGuard?.(e.clientX, e.clientY)) return;
    e.preventDefault(); // don't scroll the page
    const { x, y } = clientToScreen(canvas, resolution(), e.clientX, e.clientY);
    // Retarget the glide rather than zoom outright, so stacked notches read as one magnification.
    const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
    targetScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetScale * factor));
    zoomAnchorX = x;
    zoomAnchorY = y;
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (suspended) return;
    const action = panActionByCode.get(e.code);
    // Modifier combos stay with the browser: a pan key rebound to a letter must not hijack shortcuts
    // like Cmd+A, and macOS swallows the keyup of a key released while Meta is held.
    if (action === undefined || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
    held.add(action);
    e.preventDefault(); // arrow keys (the default bindings) would otherwise scroll the page
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    const action = panActionByCode.get(e.code);
    if (action !== undefined) held.delete(action);
  };
  // Losing focus mid-gesture drops the keyup or mouseup, which would leave a key stuck in `held` or
  // `dragging` stuck true.
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
      // Retargeted, so a jump never carries the old glide into the new view.
      targetScale = next.scale ?? 1;
    },
    setSuspended: (next) => {
      suspended = next;
      if (!next) return;
      held.clear();
      dragging = false;
      pointerSample = null;
      targetScale = cam.scale ?? 1;
    },
    setPointerGuard: (guard) => {
      pointerGuard = guard;
    },
    setEdgeGuard: (guard) => {
      edgeGuard = guard;
    },
    update: (dtMs) => {
      if (suspended) return;
      const dt = Math.min(dtMs, MAX_PAN_STEP_MS);
      if (targetScale !== (cam.scale ?? 1)) {
        cam = stepZoomToward(cam, targetScale, zoomAnchorX, zoomAnchorY, dt, tuning.zoomGlideRate);
      }
      // Pan velocity in screen px/s, applied directly with no ramp-up or glide-out, so the pan starts
      // and stops with the input. Scroll convention: an input reveals the world in its direction, so
      // looking right slides the world left and shrinks the offset.
      let desiredX = 0;
      let desiredY = 0;
      if (held.has('panLeft')) desiredX += tuning.arrowPanSpeed;
      if (held.has('panRight')) desiredX -= tuning.arrowPanSpeed;
      if (held.has('panUp')) desiredY += tuning.arrowPanSpeed;
      if (held.has('panDown')) desiredY -= tuning.arrowPanSpeed;
      // Edge scroll is suppressed mid middle-drag, while the window is unfocused, and wherever a HUD
      // surface claims the point. A left-drag marquee is deliberately not suppressed, so dragging a
      // selection box into the margin pans under it.
      if (
        pointerSample &&
        !dragging &&
        document.hasFocus() &&
        edgeGuard?.(pointerSample.x, pointerSample.y) !== true
      ) {
        const { sx, sy, rect } = screenScale(canvas, resolution());
        const edge = edgePanVelocity(
          pointerSample.x - rect.left,
          pointerSample.y - rect.top,
          rect.width,
          rect.height,
          tuning.edgeScrollSpeed,
        );
        desiredX += edge.vx * sx; // CSS px/s to screen px/s
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
