import type { Camera, WorldBounds } from '@open-northland/render';
import { isFieldKey } from '../../hud/hotkeys.js';
import { bindingFromKeyboardEvent, type KeyBindings } from '../../hud/keybindings.js';
import { createDragCapture } from './drag-capture.js';
import {
  type CameraTuning,
  clampCameraToBounds,
  DEBUG_MIN_ZOOM,
  DEFAULT_CAMERA_TUNING,
  edgeExitPoint,
  edgePanVelocity,
  HUD_EDGE_SCROLL_REACH,
  integerZoomLevels,
  MAX_ZOOM,
  MIN_ZOOM,
  nearestZoomLevel,
  panCamera,
  stepZoomLevel,
  stepZoomToward,
  zoomCameraAt,
} from './pan-zoom.js';
import { clientToScreen, screenScale } from './screen-scale.js';

/**
 * App-layer DOM controller wrapping the pure pan and zoom reducers around live input. The deterministic
 * `?shot` entry never installs it, so a reproducible PNG is unaffected.
 */

/** Per-wheel-notch zoom factor (one notch in multiplies, one out divides). */
const WHEEL_ZOOM_STEP = 1.1;
/** Approximation: ms one integer zoom level step holds off the next, so a trackpad's stream of small
 *  wheel events walks the levels at a readable pace instead of leaping to a bound. */
const LEVEL_STEP_COOLDOWN_MS = 150;
/** Max wall-clock ms one held-key pan step integrates - a backgrounded tab resumes smoothly, not with a lurch. */
const MAX_PAN_STEP_MS = 100;

type PanAction = 'panLeft' | 'panRight' | 'panUp' | 'panDown';
const PAN_ACTIONS: readonly PanAction[] = ['panLeft', 'panRight', 'panUp', 'panDown'];
/** Original behavior: the numpad scrolls beside the bindable pan keys, its corners diagonally. Fixed, but a
 *  numpad key the player bound to another action is that action's alone. */
const NUMPAD_PAN: Readonly<Record<string, readonly PanAction[]>> = {
  Numpad8: ['panUp'],
  Numpad2: ['panDown'],
  Numpad4: ['panLeft'],
  Numpad6: ['panRight'],
  Numpad7: ['panUp', 'panLeft'],
  Numpad9: ['panUp', 'panRight'],
  Numpad1: ['panDown', 'panLeft'],
  Numpad3: ['panDown', 'panRight'],
};

/** The camera's gestures for a modal over the map to hand on, since the canvas beneath it is inert. They
 *  skip the HUD pointer guard: the modal's backdrop, not a HUD control, is under the pointer. */
export interface CameraGestures {
  /** Holds a pan key as the page would and answers true; any other key is left to the modal. */
  key(event: KeyboardEvent): boolean;
  /** A middle-button press starts a drag scroll. */
  press(event: MouseEvent): void;
  wheel(event: WheelEvent): void;
}

export interface CameraController {
  camera(): Camera;
  readonly gestures: CameraGestures;
  /** Apply camera input preferences immediately, including to an in-flight middle drag. */
  setInputSettings(settings: CameraInputSettings): void;
  /**
   * Set the map's projected bounds (render's `WorldBounds`, as the minimap reads them) the view clamps
   * to, and clamp the current camera at once; `null` removes the limit.
   */
  setMapBounds(bounds: WorldBounds | null): void;
  /** Apply changed shortcuts immediately and release any key held under the previous mapping. */
  setBindings(bindings: KeyBindings): void;
  /** Apply held-arrow-key panning for a wall-clock delta in ms; call once per frame. */
  update(dtMs: number): void;
  /** Replace the frame outright; an in-flight middle-drag keeps panning from the new frame. */
  jumpTo(next: Camera): void;
  /** Lower the zoom-out floor to {@link DEBUG_MIN_ZOOM}; relocking snaps a wider view back to
   *  {@link MIN_ZOOM} about the screen centre. */
  setZoomOutUnlocked(unlocked: boolean): void;
  /** Suspend camera gestures and discard held, dragged, edge-pan, and glide state. */
  setSuspended(suspended: boolean): void;
  /**
   * Claim a client point for the HUD so wheel zoom and middle dragging yield to its controls and
   * edge scrolling narrows to {@link HUD_EDGE_SCROLL_REACH}. `null` clears the guard.
   */
  setPointerGuard(guard: ((clientX: number, clientY: number) => boolean) | null): void;
  /** Hold edge scrolling while a HUD gesture steers the camera itself; `null` clears. */
  setEdgeHold(hold: (() => boolean) | null): void;
  dispose(): void;
}

export interface CameraInputSettings {
  readonly keyboardScrollSpeed: number;
  readonly edgeScrollSpeed: number;
  readonly dragScrollSpeed: number;
  readonly edgeScrollEnabled: boolean;
  readonly invertDragScroll: boolean;
  /** Zoom only to {@link integerZoomLevels}, jumping instead of gliding. */
  readonly integerScaling: boolean;
}

/** CSS px a display-covering window may fall short of the screen by, for page-zoom rounding. */
const DISPLAY_FIT_SLACK = 1;

/** True when the window fills its display, as in browser or desktop fullscreen, so no other window
 *  borders it on this display. */
function windowCoversDisplay(): boolean {
  return (
    window.innerWidth >= window.screen.width - DISPLAY_FIT_SLACK &&
    window.innerHeight >= window.screen.height - DISPLAY_FIT_SLACK
  );
}

/** `resolution` reads the owning renderer's live device px per screen px, needed to map mouse deltas on
 *  a HiDPI canvas; a captured value would go stale when a DPR change re-sizes the renderer. */
export function createCameraController(
  canvas: HTMLCanvasElement,
  initial: Camera,
  resolution: () => number,
  bindings: KeyBindings,
  inputSettings: CameraInputSettings,
): CameraController {
  let cam: Camera = initial;
  let activeBindings = bindings;
  let activeInputSettings = inputSettings;
  const tuning: CameraTuning = DEFAULT_CAMERA_TUNING;
  // Null until an entry hands in the map's projected bounds; the clamp then guards every pan, zoom and
  // jump assignment below. The viewport size in screen px matches the space `onLevel` zooms about.
  let mapBounds: WorldBounds | null = null;
  const clampCam = (next: Camera): Camera => {
    if (mapBounds === null) return next;
    const res = resolution();
    return clampCameraToBounds(next, mapBounds, canvas.width / res, canvas.height / res);
  };
  const panActionFor = (event: KeyboardEvent): PanAction | undefined => {
    const binding = bindingFromKeyboardEvent(event);
    return binding === null ? undefined : PAN_ACTIONS.find((action) => activeBindings[action] === binding);
  };
  const held = new Set<PanAction>();
  const heldNumpad = new Set<string>();
  const numpadPans = (e: KeyboardEvent): boolean => {
    if (NUMPAD_PAN[e.code] === undefined || e.ctrlKey || e.altKey || e.metaKey) return false;
    const binding = bindingFromKeyboardEvent(e);
    return !Object.values(activeBindings).some((bound) => bound === binding);
  };
  let dragging = false;
  let pointerGuard: ((clientX: number, clientY: number) => boolean) | null = null;
  let edgeHold: (() => boolean) | null = null;
  // The clamped scale the wheel glide eases toward, anchored at the last wheel cursor in screen px, so
  // a burst of notches magnifies smoothly about one point.
  let targetScale = initial.scale ?? 1;
  let minZoom = MIN_ZOOM;
  let zoomAnchorX = 0;
  let zoomAnchorY = 0;
  let lastLevelStepMs = Number.NEGATIVE_INFINITY;
  // Rebuilt only when the resolution or the zoom-out floor moves, since `onLevel` runs every frame.
  let levelsKey = { resolution: 0, minZoom: 0 };
  let levels: readonly number[] = [];
  const zoomLevels = (): readonly number[] => {
    const res = resolution();
    if (levelsKey.resolution !== res || levelsKey.minZoom !== minZoom) {
      levelsKey = { resolution: res, minZoom };
      levels = integerZoomLevels(res, minZoom);
    }
    return levels;
  };
  /** `next` on an integer zoom level about the screen centre when the mode is on; else unchanged. */
  const onLevel = (next: Camera): Camera => {
    if (!activeInputSettings.integerScaling) return next;
    const scale = next.scale ?? 1;
    const level = nearestZoomLevel(zoomLevels(), scale);
    if (level === scale) return next;
    const res = resolution();
    return zoomCameraAt(next, level / scale, canvas.width / res / 2, canvas.height / res / 2, minZoom);
  };
  // The edge-scroll probe: the last `mousemove` sample in client px, whatever element it hit, so HUD
  // chrome along a screen edge still scrolls. Pinned to the edge a cursor left a display-covering window
  // through, and null after a blur, after leaving a smaller window or before any move.
  let pointerSample: { readonly x: number; readonly y: number } | null = null;
  let suspended = false;
  const endMiddleDrag = (): void => {
    dragging = false;
    dragCapture.end();
  };
  const dragCapture = createDragCapture(canvas, endMiddleDrag);

  const pressDrag = (e: MouseEvent): void => {
    if (suspended || e.button !== 1) return;
    dragging = true;
    dragCapture.begin(e.clientX, e.clientY);
    e.preventDefault(); // suppress the middle-click autoscroll widget
  };
  const onMouseDown = (e: MouseEvent): void => {
    if (e.button === 1 && !pointerGuard?.(e.clientX, e.clientY)) pressDrag(e);
  };
  // The page cannot hold the cursor inside the window. One that leaves a window covering its display
  // went to another display, so it keeps scrolling as if pressed against the edge it crossed until it
  // returns or focus moves; leaving a smaller window lands on another application and disarms.
  const pinToExitEdge = (clientX: number, clientY: number): void => {
    if (!windowCoversDisplay()) {
      pointerSample = null;
      return;
    }
    const { rect } = screenScale(canvas, resolution());
    const exit = edgeExitPoint(clientX - rect.left, clientY - rect.top, rect.width, rect.height);
    pointerSample = { x: exit.x + rect.left, y: exit.y + rect.top };
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (suspended) return;
    // Every move re-arms the probe, because `mouseenter` fires only on a boundary crossing and a refocus
    // gets none. A held button keeps moves coming from beyond the window, which pin like an exit.
    if (e.clientX < 0 || e.clientY < 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
      pinToExitEdge(e.clientX, e.clientY);
    } else {
      pointerSample = { x: e.clientX, y: e.clientY };
    }
    if (!dragging) return;
    const { sx, sy } = screenScale(canvas, resolution());
    const direction = activeInputSettings.invertDragScroll ? -1 : 1;
    const { dx, dy } = dragCapture.step(e);
    cam = clampCam(
      panCamera(
        cam,
        dx * sx * activeInputSettings.dragScrollSpeed * direction,
        dy * sy * activeInputSettings.dragScrollSpeed * direction,
      ),
    );
  };
  const onMouseUp = (e: MouseEvent): void => {
    if (e.button === 1) endMiddleDrag();
  };
  // A null `relatedTarget` marks leaving the window; moves between page elements carry one.
  const onMouseOut = (e: MouseEvent): void => {
    if (e.relatedTarget !== null || pointerSample === null) return;
    pinToExitEdge(e.clientX, e.clientY);
  };
  const wheelZoom = (e: WheelEvent): void => {
    if (suspended) return;
    e.preventDefault(); // don't scroll the page
    const { x, y } = clientToScreen(canvas, resolution(), e.clientX, e.clientY);
    if (activeInputSettings.integerScaling) {
      if (e.timeStamp - lastLevelStepMs < LEVEL_STEP_COOLDOWN_MS) return;
      lastLevelStepMs = e.timeStamp;
      const scale = cam.scale ?? 1;
      const level = stepZoomLevel(zoomLevels(), scale, e.deltaY < 0 ? 1 : -1);
      cam = clampCam(zoomCameraAt(cam, level / scale, x, y, minZoom));
      targetScale = cam.scale ?? 1;
      return;
    }
    // Retarget the glide rather than zoom outright, so stacked notches read as one magnification.
    const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
    targetScale = Math.min(MAX_ZOOM, Math.max(minZoom, targetScale * factor));
    zoomAnchorX = x;
    zoomAnchorY = y;
  };
  const onWheel = (e: WheelEvent): void => {
    // The event is left for the claiming panel's own handler, which scrolls its list and preventDefaults.
    if (!pointerGuard?.(e.clientX, e.clientY)) wheelZoom(e);
  };
  const holdPanKey = (e: KeyboardEvent): boolean => {
    // A focused control that took the key (a tab strip's arrows) keeps it from the camera.
    if (suspended || e.defaultPrevented || isFieldKey(e)) return false;
    const action = panActionFor(e);
    if (action !== undefined) held.add(action);
    else if (numpadPans(e)) heldNumpad.add(e.code);
    else return false;
    e.preventDefault(); // arrow keys (the default bindings) would otherwise scroll the page
    return true;
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    holdPanKey(e);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    heldNumpad.delete(e.code);
    const releasedModifier = e.code.startsWith('Control')
      ? 'Ctrl'
      : e.code.startsWith('Shift')
        ? 'Shift'
        : e.code.startsWith('Alt')
          ? 'Alt'
          : e.code.startsWith('Meta')
            ? 'Meta'
            : null;
    for (const action of PAN_ACTIONS) {
      const binding = activeBindings[action];
      if (binding === null) continue;
      const parts = binding.split('+');
      const usesReleasedModifier =
        releasedModifier !== null &&
        (parts.includes(releasedModifier) ||
          (parts.includes('Primary') && (releasedModifier === 'Ctrl' || releasedModifier === 'Meta')));
      if (parts.at(-1) === e.code || usesReleasedModifier) held.delete(action);
    }
  };
  // Losing focus mid-gesture drops the keyup or mouseup, which would leave a key stuck in `held` or
  // `dragging` stuck true.
  const onBlur = (): void => {
    held.clear();
    heldNumpad.clear();
    endMiddleDrag();
    pointerSample = null;
  };

  cam = onLevel(cam);
  targetScale = cam.scale ?? 1;

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mouseout', onMouseOut);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    camera: () => cam,
    gestures: { key: holdPanKey, press: pressDrag, wheel: wheelZoom },
    setInputSettings: (next) => {
      activeInputSettings = next;
      cam = clampCam(onLevel(cam));
      targetScale = cam.scale ?? 1;
    },
    setMapBounds: (bounds) => {
      mapBounds = bounds;
      cam = clampCam(cam);
    },
    setBindings: (next) => {
      activeBindings = next;
      held.clear();
    },
    jumpTo: (next) => {
      cam = clampCam(onLevel(next));
      // Retargeted, so a jump never carries the old glide into the new view.
      targetScale = cam.scale ?? 1;
    },
    setZoomOutUnlocked: (unlocked) => {
      minZoom = unlocked ? DEBUG_MIN_ZOOM : MIN_ZOOM;
      targetScale = Math.max(minZoom, targetScale);
      const scale = cam.scale ?? 1;
      if (scale >= minZoom) return;
      const res = resolution();
      cam = clampCam(
        onLevel(zoomCameraAt(cam, minZoom / scale, canvas.width / res / 2, canvas.height / res / 2, minZoom)),
      );
      targetScale = cam.scale ?? 1;
    },
    setSuspended: (next) => {
      suspended = next;
      if (!next) return;
      held.clear();
      heldNumpad.clear();
      endMiddleDrag();
      pointerSample = null;
      targetScale = cam.scale ?? 1;
    },
    setPointerGuard: (guard) => {
      pointerGuard = guard;
    },
    setEdgeHold: (hold) => {
      edgeHold = hold;
    },
    update: (dtMs) => {
      if (suspended) return;
      const dt = Math.min(dtMs, MAX_PAN_STEP_MS);
      // A display or render-scale change moves the device px under a level, so it is checked per frame.
      const settled = clampCam(onLevel(cam));
      if (settled !== cam) {
        cam = settled;
        targetScale = cam.scale ?? 1;
      }
      if (targetScale !== (cam.scale ?? 1)) {
        cam = clampCam(
          stepZoomToward(cam, targetScale, zoomAnchorX, zoomAnchorY, dt, tuning.zoomGlideRate, minZoom),
        );
      }
      // Pan velocity in screen px/s, applied directly with no ramp-up or glide-out, so the pan starts
      // and stops with the input. Scroll convention: an input reveals the world in its direction, so
      // looking right slides the world left and shrinks the offset.
      let desiredX = 0;
      let desiredY = 0;
      const keyboardSpeed = tuning.arrowPanSpeed * activeInputSettings.keyboardScrollSpeed;
      const panning = (action: PanAction): boolean => {
        if (held.has(action)) return true;
        for (const code of heldNumpad) if (NUMPAD_PAN[code]?.includes(action) === true) return true;
        return false;
      };
      if (panning('panLeft')) desiredX += keyboardSpeed;
      if (panning('panRight')) desiredX -= keyboardSpeed;
      if (panning('panUp')) desiredY += keyboardSpeed;
      if (panning('panDown')) desiredY -= keyboardSpeed;
      // Edge scroll is suppressed while the window is unfocused and while a drag steers the camera (a
      // middle-drag or an edge hold). HUD surfaces over the margin only narrow it, so chrome along an
      // edge never blocks scrolling. A left-drag marquee is deliberately not suppressed, so dragging a
      // selection box into the margin pans under it.
      if (
        activeInputSettings.edgeScrollEnabled &&
        pointerSample &&
        !dragging &&
        edgeHold?.() !== true &&
        document.hasFocus()
      ) {
        const { sx, sy, rect } = screenScale(canvas, resolution());
        const x = pointerSample.x - rect.left;
        const y = pointerSample.y - rect.top;
        if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
          let edge = edgePanVelocity(x, y, rect.width, rect.height, tuning.edgeScrollSpeed);
          // The guard hit-tests the page, so it runs only for a pointer already inside the margin.
          if ((edge.vx !== 0 || edge.vy !== 0) && pointerGuard?.(pointerSample.x, pointerSample.y) === true) {
            edge = edgePanVelocity(
              x,
              y,
              rect.width,
              rect.height,
              tuning.edgeScrollSpeed,
              HUD_EDGE_SCROLL_REACH,
            );
          }
          desiredX += edge.vx * sx * activeInputSettings.edgeScrollSpeed; // CSS px/s to screen px/s
          desiredY += edge.vy * sy * activeInputSettings.edgeScrollSpeed;
        }
      }
      if (desiredX !== 0 || desiredY !== 0) {
        cam = clampCam(panCamera(cam, (desiredX * dt) / 1000, (desiredY * dt) / 1000));
      }
    },
    dispose: () => {
      dragging = false;
      dragCapture.dispose();
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mouseout', onMouseOut);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
