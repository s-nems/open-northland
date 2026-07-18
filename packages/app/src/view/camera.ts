import { type Camera, type DrawItem, tileToScreen } from '@open-northland/render';

/**
 * Camera helpers shared by the map (`entries/map.ts`) and shot (`entries/shot.ts`) entries. The geometry half is
 * pure — no Pixi, no sim. The `?zoom=` knob exists so a human can actually judge a decoded bob's
 * pixels: a ~30px sprite is lost on a 960px canvas, so a verification frame magnifies and re-centres.
 *
 * The interactive entries additionally wrap a {@link CameraController} around the static
 * {@link cameraFor} starting frame, so a human can pan (middle-mouse drag / arrow keys / the RTS
 * screen-edge scroll) and zoom (scroll wheel, eased toward its target) the view. That's app-layer I/O (DOM + floats — fine here, never in `sim`); the pan/
 * zoom *math* is the pure {@link panCamera}/{@link zoomCameraAt} reducers, unit-tested headless. The
 * deterministic `?shot` entry never installs the controller, so the reproducible PNG is unaffected.
 */

/**
 * Build the camera for a frame. At zoom 1 it keeps the historical pan (the iso strip projects to
 * negative screen-x, so the offset nudges it into view). At a higher zoom it centres on the centroid of
 * the settlers (the camera follows the people — they're the animated subjects a pixel check inspects),
 * falling back to all non-tile sprites, then the origin. This frames a small decoded bob reliably rather
 * than letting the big placeholder boxes drag the focus off it. `screen = world*scale + offset` (see
 * {@link Camera}).
 */
export function cameraFor(scene: readonly DrawItem[], zoom: number, width: number, height: number): Camera {
  if (zoom === 1) return { offsetX: width / 2, offsetY: height / 3 };
  const focus = centroid(scene, (k) => k === 'settler') ?? centroid(scene, (k) => k !== 'tile') ?? null;
  const focusX = focus?.x ?? 0;
  const focusY = focus?.y ?? 0;
  return { offsetX: width / 2 - focusX * zoom, offsetY: height / 2 - focusY * zoom, scale: zoom };
}

/**
 * The camera that puts tile `(tileX, tileY)` at the viewport centre at `zoom` — the inverse of the iso
 * projection the renderer applies (`screen = world*scale + offset`, like {@link cameraFor}). Backs the
 * `?center=x,y` inspection knob (`entries/map.ts`): a decoded map's feature — a bridge, a coastline —
 * that the settler-centroid framing would never land on. Pure.
 */
export function cameraCenteredOnTile(
  tileX: number,
  tileY: number,
  zoom: number,
  width: number,
  height: number,
): Camera {
  const s = tileToScreen(tileX, tileY);
  return cameraCenteredOnWorld(s.x, s.y, zoom, width, height);
}

/**
 * The camera that puts world point `(worldX, worldY)` (projected px, pre-camera) at the viewport centre
 * at `zoom` — {@link cameraCenteredOnTile} without the tile→world projection, for callers that already
 * hold a world point (the minimap's click-to-jump). Pure.
 */
export function cameraCenteredOnWorld(
  worldX: number,
  worldY: number,
  zoom: number,
  width: number,
  height: number,
): Camera {
  return { offsetX: width / 2 - worldX * zoom, offsetY: height / 2 - worldY * zoom, scale: zoom };
}

/** Mean (x,y) of the draw items whose kind passes `keep`, or null when none match. */
function centroid(
  scene: readonly DrawItem[],
  keep: (kind: DrawItem['kind']) => boolean,
): { x: number; y: number } | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const item of scene) {
    if (!keep(item.kind)) continue;
    sumX += item.x;
    sumY += item.y;
    count++;
  }
  return count > 0 ? { x: sumX / count, y: sumY / count } : null;
}

// ─── Interactive camera ──────────────────────────────────────────────────────────────────────────

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
/** Per-wheel-notch zoom factor (one notch in multiplies, one out divides). */
const WHEEL_ZOOM_STEP = 1.1;
/** The arrow keys the controller pans on (so it ignores every other key). */
const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
/** Max wall-clock ms one held-key pan step integrates — a backgrounded tab resumes smoothly, not with a lurch. */
const MAX_PAN_STEP_MS = 100;
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

/** An installed interactive camera: read the current transform, advance held-key pan, tear down. */
export interface CameraController {
  /** The current {@link Camera} to hand the renderer's `update`. */
  camera(): Camera;
  /** Apply held-arrow-key panning for a wall-clock delta in ms — call once per frame. */
  update(dtMs: number): void;
  /**
   * Replace the current frame outright (the minimap's click-to-jump). The next `camera()` read returns
   * `next` verbatim; an in-flight middle-drag simply continues panning from the new frame.
   */
  jumpTo(next: Camera): void;
  /**
   * Install a predicate that claims a client point for the HUD; while it returns true for the cursor, the
   * wheel does not zoom (an open window scrolls instead). Pass `null` to clear. The game view wires the
   * tool panel's `claimsWheel` here (an open pop-up window only — not the broad `claimsPointer`, which also
   * covers the strip and active placement, where the wheel should still zoom) so scrolling a pop-up list
   * never also zooms the world behind it.
   */
  setPointerGuard(guard: ((clientX: number, clientY: number) => boolean) | null): void;
  /**
   * Install a predicate that claims a client point for the HUD against EDGE SCROLLING. The game view
   * wires the open pop-up windows + the minimap here — surfaces whose hover must not also pan the
   * camera. The tool-panel STRIP deliberately does NOT claim: it hugs the left screen edge, and the
   * RTS edge-pan must keep working when the cursor rests on it. Pass `null` to clear.
   */
  setEdgeGuard(guard: ((clientX: number, clientY: number) => boolean) | null): void;
  /** Remove every installed DOM listener. */
  dispose(): void;
}

/**
 * The CSS-px → Pixi-screen-px scale for a canvas (+ its client `rect`). Client (CSS-px) mouse coords
 * must land in the screen px the camera + picking + HUD layouts work in — the backing store divided by
 * `resolution`, the renderer's device-px-per-screen-px (`app.renderer.resolution`: devicePixelRatio for
 * the HiDPI window canvas, 1 for the deterministic `?shot` canvas — every caller passes its app's live
 * value). The live entries keep CSS and screen px 1:1 (`createWindowPixiApp` + `autoDensity` CSS-size
 * the canvas to the logical size), so this is normally identity — but it stays exact for any embedding
 * where they diverge (a fixed-size canvas, a resize not yet flushed), else a drag pans faster than the
 * cursor, a wheel zoom anchors off the cursor, and a click picks the wrong tile. The `rect` is returned
 * so a handler can subtract the canvas origin in CSS px *before* scaling. Guards a zero-size
 * (unlaid-out) canvas. Shared by the camera controller and the selection controller
 * (`view/unit-controls/`).
 */
export function screenScale(
  canvas: HTMLCanvasElement,
  resolution: number,
): { sx: number; sy: number; rect: DOMRect } {
  const rect = canvas.getBoundingClientRect();
  return {
    sx: rect.width === 0 ? 1 : canvas.width / resolution / rect.width,
    sy: rect.height === 0 ? 1 : canvas.height / resolution / rect.height,
    rect,
  };
}

/** Apply a {@link screenScale} result to a client (CSS) point → canvas (screen) px: subtract the canvas
 *  origin in CSS px, then scale. The building block behind {@link clientToScreen}; `hud/` handlers can't
 *  import `view/`, so they apply this same mapping inline over their injected scale. */
function clientToCanvas(
  scale: { sx: number; sy: number; rect: DOMRect },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return { x: (clientX - scale.rect.left) * scale.sx, y: (clientY - scale.rect.top) * scale.sy };
}

/** Client (CSS) point → canvas (screen) px in one call ({@link screenScale} then {@link clientToCanvas}) —
 *  the one composition the camera, tool panel, unit controls, settler ring and map view share, so the
 *  `app.renderer.resolution` threading and anchor math can't drift between drag, zoom, pick and placement. */
export function clientToScreen(
  canvas: HTMLCanvasElement,
  resolution: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return clientToCanvas(screenScale(canvas, resolution), clientX, clientY);
}

/** `resolution` is the owning renderer's device-px-per-screen-px (`app.renderer.resolution`) — needed to
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
  // Last known pointer position (client px) + whether it is over the canvas — the edge-scroll probe.
  // `pointerMoved` gates the probe until a real `mousemove` sample lands: `onPointerEnter` sets
  // `pointerInside` but records no position (the browser fires `mouseenter` when the canvas mounts under
  // a stationary cursor, e.g. the loading-card→scene swap), so without this gate the still-(0,0)
  // `pointerX/pointerY` would edge-scroll toward the top-left corner. It also honours the "parked cursor
  // doesn't pan until it moves" intent.
  let pointerX = 0;
  let pointerY = 0;
  let pointerInside = false;
  let pointerMoved = false;

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 1) return; // middle button only
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault(); // suppress the middle-click autoscroll widget
  };
  const onMouseMove = (e: MouseEvent): void => {
    pointerX = e.clientX;
    pointerY = e.clientY;
    pointerMoved = true;
    if (!dragging) return;
    const { sx, sy } = screenScale(canvas, resolution);
    cam = panCamera(cam, (e.clientX - lastX) * sx, (e.clientY - lastY) * sy);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onMouseUp = (e: MouseEvent): void => {
    if (e.button === 1) dragging = false;
  };
  const onPointerEnter = (): void => {
    pointerInside = true;
  };
  const onPointerLeave = (): void => {
    pointerInside = false;
  };
  const onWheel = (e: WheelEvent): void => {
    // Over an open HUD window the wheel belongs to that window's list, not the camera — leave the event
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
    pointerInside = false;
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseenter', onPointerEnter);
  canvas.addEventListener('mouseleave', onPointerLeave);
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
      // pauses, then resumes with one huge elapsed) — the pan stays smooth, never a jump.
      const dt = Math.min(dtMs, MAX_PAN_STEP_MS);
      // Wheel zoom glide: ease the scale toward the last wheel target about its cursor anchor.
      if (targetScale !== (cam.scale ?? 1)) {
        cam = stepZoomToward(cam, targetScale, zoomAnchorX, zoomAnchorY, dt, tuning.zoomGlideRate);
      }
      // Pan velocity (screen px/s), applied DIRECTLY — no ramp-up/glide-out easing: an RTS pan must
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
      // Edge scroll: pointer resting in the margin band pans, but only once a real pointer sample has
      // landed (`pointerMoved`; until then the position is the stale (0,0)) and not while mid-drag (the
      // drag owns the motion), the window is unfocused (RAF still runs when visible), or a HUD surface
      // claims the point (an open window / the minimap must not also pan). A LEFT-drag marquee is not suppressed
      // — dragging a selection box into the margin pans under the screen-anchored box (a named
      // tradeoff: RTS players use exactly that to select past the screen edge).
      if (
        pointerInside &&
        pointerMoved &&
        !dragging &&
        document.hasFocus() &&
        edgeGuard?.(pointerX, pointerY) !== true
      ) {
        const { sx, sy, rect } = screenScale(canvas, resolution);
        const edge = edgePanVelocity(
          pointerX - rect.left,
          pointerY - rect.top,
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
      canvas.removeEventListener('mouseenter', onPointerEnter);
      canvas.removeEventListener('mouseleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
