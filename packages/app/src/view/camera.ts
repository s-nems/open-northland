import type { Camera, DrawItem } from '@vinland/render';

/**
 * Camera helpers shared by the live (`entries/live.ts`) and shot (`entries/shot.ts`) entries. The geometry half is
 * pure — no Pixi, no sim. The `?zoom=` knob exists so a human can actually judge a decoded bob's
 * pixels: a ~30px sprite is lost on a 960px canvas, so a verification frame magnifies and re-centres.
 *
 * The live entries additionally wrap an interactive {@link CameraController} around the static
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
export function createCameraController(canvas: HTMLCanvasElement, initial: Camera): CameraController {
  let cam: Camera = initial;
  const held = new Set<string>();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  // Client (CSS-px) coords must land in the backing-store px the camera works in. The live entries now
  // keep the two 1:1 (`createWindowPixiApp` sizes the backing store to the window, `index.html` CSS-sizes
  // `#game` the same), so this is normally identity — but it stays exact for any embedding where they
  // diverge (a fixed-size canvas, a resize event not yet flushed), else a drag pans faster than the
  // cursor and a wheel zoom anchors off the cursor. `rect` is returned too, so the wheel handler
  // subtracts the canvas origin in CSS px *before* scaling. Guards a zero-size (unlaid-out) canvas.
  const backingScale = (): { sx: number; sy: number; rect: DOMRect } => {
    const rect = canvas.getBoundingClientRect();
    return {
      sx: rect.width === 0 ? 1 : canvas.width / rect.width,
      sy: rect.height === 0 ? 1 : canvas.height / rect.height,
      rect,
    };
  };

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 1) return; // middle button only
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault(); // suppress the middle-click autoscroll widget
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!dragging) return;
    const { sx, sy } = backingScale();
    cam = panCamera(cam, (e.clientX - lastX) * sx, (e.clientY - lastY) * sy);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onMouseUp = (e: MouseEvent): void => {
    if (e.button === 1) dragging = false;
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault(); // don't scroll the page
    const { sx, sy, rect } = backingScale();
    const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
    cam = zoomCameraAt(cam, factor, (e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy);
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
    update: (dtMs) => {
      if (held.size === 0) return;
      // Clamp the delta so a held key doesn't lurch the camera after the tab was backgrounded (RAF
      // pauses, then resumes with one huge elapsed) — the pan stays smooth, never a jump.
      const step = (ARROW_PAN_SPEED * Math.min(dtMs, 100)) / 1000;
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
