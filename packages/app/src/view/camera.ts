import { type Camera, type DrawItem, tileToScreen } from '@vinland/render';

/**
 * Camera helpers shared by the map (`entries/map.ts`) and shot (`entries/shot.ts`) entries. The geometry half is
 * pure — no Pixi, no sim. The `?zoom=` knob exists so a human can actually judge a decoded bob's
 * pixels: a ~30px sprite is lost on a 960px canvas, so a verification frame magnifies and re-centres.
 *
 * The interactive entries additionally wrap a {@link CameraController} around the static
 * {@link cameraFor} starting frame, so a human can pan (middle-mouse drag / arrow keys) and zoom
 * (scroll wheel) the view. That's app-layer I/O (DOM + floats — fine here, never in `sim`); the pan/
 * zoom *math* is the pure {@link panCamera}/{@link zoomCameraAt} reducers, unit-tested headless. The
 * deterministic `?shot` entry never installs the controller, so the reproducible PNG is unaffected.
 */

/**
 * Build the camera for a frame. At zoom 1 it keeps the historical pan (the iso strip projects to
 * negative screen-x, so the offset nudges it into view). At a higher zoom it centres on the CENTROID of
 * the SETTLERS (the camera follows the people — they're the animated subjects a pixel check inspects),
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
 * The camera that puts WORLD point `(worldX, worldY)` (projected px, pre-camera) at the viewport centre
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
 * lower bound is a deliberate FLOOR on how far out you can go: an RTS renders only what's on screen, so
 * the min zoom is what bounds the visible tile + bob count (and thus the frame cost) — not a whole-map
 * fit. `0.15` (~6× out) frames a big slab of a large map — a battle, a settlement cluster — which is the
 * stated need; seeing an entire 256×256 map at once (`scale ≈ 0.06`, tens of thousands of bobs) is not a
 * requirement and is where cost balloons, so it's intentionally off the table. Raise it if a scene still
 * churns when fully out; lower it only alongside a zoom-out LOD (marker sprites + animation freeze).
 */
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 8;
/** Screen pixels the camera scrolls per second while an arrow key is held. */
const ARROW_PAN_SPEED = 600;
/** Per-wheel-notch zoom factor (one notch in multiplies, one out divides). */
const WHEEL_ZOOM_STEP = 1.1;
/** The arrow keys the controller pans on (so it ignores every other key). */
const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
/** Max wall-clock ms one held-key pan step integrates — a backgrounded tab resumes smoothly, not with a lurch. */
const MAX_PAN_STEP_MS = 100;

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
   * wheel does NOT zoom (an open window scrolls instead). Pass `null` to clear. The game view wires the
   * tool panel's `claimsWheel` here (an OPEN pop-up window only — NOT the broad `claimsPointer`, which also
   * covers the strip and active placement, where the wheel should still zoom) so scrolling a pop-up list
   * never also zooms the world behind it.
   */
  setPointerGuard(guard: ((clientX: number, clientY: number) => boolean) | null): void;
  /** Remove every installed DOM listener. */
  dispose(): void;
}

/**
 * Wire interactive camera movement onto `canvas`, starting from the `initial` frame: **middle-mouse
 * drag** grabs and pulls the world; the **arrow keys** scroll the camera (press right to look right);
 * the **scroll wheel** zooms toward the cursor. App-layer only — DOM + floats are fine here and the
 * sim is never touched; this just translates DOM events into the pure {@link panCamera}/
 * {@link zoomCameraAt} reducers over a mutable camera. Drag uses mouse (not pointer) events so
 * `preventDefault` on the middle button suppresses the browser's autoscroll widget; move/up listen on
 * `window` so a drag continues when the cursor leaves the canvas.
 */
/**
 * The CSS-px → Pixi-SCREEN-px scale for a canvas (+ its client `rect`). Client (CSS-px) mouse coords
 * must land in the screen px the camera + picking + HUD layouts work in — the backing store divided by
 * `resolution`, the renderer's device-px-per-screen-px (`app.renderer.resolution`: devicePixelRatio for
 * the HiDPI window canvas, 1 for the deterministic `?shot` canvas — every caller passes its app's live
 * value). The live entries keep CSS and screen px 1:1 (`createWindowPixiApp` + `autoDensity` CSS-size
 * the canvas to the logical size), so this is normally identity — but it stays exact for any embedding
 * where they diverge (a fixed-size canvas, a resize not yet flushed), else a drag pans faster than the
 * cursor, a wheel zoom anchors off the cursor, and a click picks the wrong tile. The `rect` is returned
 * so a handler can subtract the canvas origin in CSS px *before* scaling. Guards a zero-size
 * (unlaid-out) canvas. Shared by the camera controller and the selection controller
 * (`view/unit-controls.ts`).
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
 *  origin in CSS px, then scale. The ONE place the client→canvas mapping lives, so the drag/zoom/pick
 *  handlers that share it can't drift — a wrong anchor is exactly the bug {@link screenScale} guards
 *  against. (`hud/` handlers can't import `view/`, so they still apply this inline over their injected
 *  scale.) */
export function clientToCanvas(
  scale: { sx: number; sy: number; rect: DOMRect },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return { x: (clientX - scale.rect.left) * scale.sx, y: (clientY - scale.rect.top) * scale.sy };
}

/** `resolution` is the owning renderer's device-px-per-screen-px (`app.renderer.resolution`) — needed to
 *  map mouse deltas into screen px on the HiDPI window canvas (see {@link screenScale}). */
export function createCameraController(
  canvas: HTMLCanvasElement,
  initial: Camera,
  resolution: number,
): CameraController {
  let cam: Camera = initial;
  const held = new Set<string>();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  // While this claims the cursor (an open HUD window), the wheel scrolls that window, not the camera.
  let pointerGuard: ((clientX: number, clientY: number) => boolean) | null = null;

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 1) return; // middle button only
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault(); // suppress the middle-click autoscroll widget
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!dragging) return;
    const { sx, sy } = screenScale(canvas, resolution);
    cam = panCamera(cam, (e.clientX - lastX) * sx, (e.clientY - lastY) * sy);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onMouseUp = (e: MouseEvent): void => {
    if (e.button === 1) dragging = false;
  };
  const onWheel = (e: WheelEvent): void => {
    // Over an open HUD window the wheel belongs to that window's list, not the camera — leave the event
    // for the panel's own handler (which scrolls + preventDefaults) and don't zoom the world behind it.
    if (pointerGuard?.(e.clientX, e.clientY)) return;
    e.preventDefault(); // don't scroll the page
    const { x, y } = clientToCanvas(screenScale(canvas, resolution), e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
    cam = zoomCameraAt(cam, factor, x, y);
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
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    camera: () => cam,
    jumpTo: (next) => {
      cam = next;
      // A drag in flight keeps panning FROM the new frame: its deltas apply per-move (lastX/lastY track
      // the cursor, not the camera), so no drag state needs resetting here.
    },
    setPointerGuard: (guard) => {
      pointerGuard = guard;
    },
    update: (dtMs) => {
      if (held.size === 0) return;
      // Clamp the delta so a held key doesn't lurch the camera after the tab was backgrounded (RAF
      // pauses, then resumes with one huge elapsed) — the pan stays smooth, never a jump.
      const step = (ARROW_PAN_SPEED * Math.min(dtMs, MAX_PAN_STEP_MS)) / 1000;
      let dx = 0;
      let dy = 0;
      // Camera-scroll convention: an arrow reveals the world in its direction (press right → look
      // right → the world slides left → offset shrinks).
      if (held.has('ArrowLeft')) dx += step;
      if (held.has('ArrowRight')) dx -= step;
      if (held.has('ArrowUp')) dy += step;
      if (held.has('ArrowDown')) dy -= step;
      cam = panCamera(cam, dx, dy);
    },
    dispose: () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
