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
 * + bob count (and thus frame cost), not a whole-map fit. `0.15` (~6× out) frames a big slab of a large
 * map (a battle, a settlement cluster); seeing a whole 256×256 map at once (`scale ≈ 0.06`, tens of
 * thousands of bobs) is where cost balloons, so it's off the table. Raise it if a scene still churns when
 * fully out; lower it only alongside a zoom-out LOD (marker sprites + animation freeze).
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
/** CSS px from a canvas edge within which the pointer edge-scrolls (the RTS screen-edge pan). */
export const EDGE_SCROLL_MARGIN = 24;
/** Edge-scroll speed (screen px/s) at the deepest point of the margin; ramps linearly from 0. */
const EDGE_SCROLL_SPEED = 900;
/** Half-life (ms) of the pan-velocity easing: held-key/edge pans ramp up and glide out briefly
 *  instead of starting and stopping dead. Short — feel, not float. */
const PAN_EASE_HALF_LIFE_MS = 60;
/** Half-life (ms) of the wheel zoom's glide toward its target scale. */
const ZOOM_EASE_HALF_LIFE_MS = 50;
/** Relative gap to the zoom target below which the eased scale snaps onto it exactly. */
const ZOOM_SNAP_EPS = 1e-3;
/** Pan speed (px/s) below which a decaying glide is stopped dead (avoids an endless sub-pixel tail). */
const PAN_STOP_SPEED = 1;

/** The fraction of the remaining gap an exponential ease covers in `dtMs` at the given half-life —
 *  frame-rate independent (two 8 ms steps land where one 16 ms step does). Pure. */
export function easeFactor(dtMs: number, halfLifeMs: number): number {
  return 1 - 0.5 ** (dtMs / halfLifeMs);
}

/**
 * The edge-scroll pan velocity (screen px/s, camera-scroll convention: pointer at the LEFT edge reveals
 * the world leftward → positive `vx`, like a held ArrowLeft) for a pointer at canvas CSS position
 * `(x, y)` in a `width × height` canvas. Ramps linearly from 0 at the margin's inner boundary to
 * {@link EDGE_SCROLL_SPEED} at the edge; `(0, 0)` anywhere deeper inside. Pure.
 */
export function edgePanVelocity(
  x: number,
  y: number,
  width: number,
  height: number,
): { vx: number; vy: number } {
  const depth = (into: number): number =>
    into >= EDGE_SCROLL_MARGIN ? 0 : (EDGE_SCROLL_MARGIN - Math.max(0, into)) / EDGE_SCROLL_MARGIN;
  return {
    vx: (depth(x) - depth(width - x)) * EDGE_SCROLL_SPEED,
    vy: (depth(y) - depth(height - y)) * EDGE_SCROLL_SPEED,
  };
}

/**
 * One eased step of the wheel zoom: glide the camera's scale toward `target` (frame-rate-independent
 * exponential, {@link ZOOM_EASE_HALF_LIFE_MS}), anchored at the cursor like {@link zoomCameraAt},
 * snapping onto the target when within {@link ZOOM_SNAP_EPS} of it. Returns the camera untouched when
 * already there. Pure.
 */
export function stepZoomToward(
  cam: Camera,
  target: number,
  cursorX: number,
  cursorY: number,
  dtMs: number,
): Camera {
  const scale = cam.scale ?? 1;
  if (scale === target) return cam;
  const eased = scale + (target - scale) * easeFactor(dtMs, ZOOM_EASE_HALF_LIFE_MS);
  const next = Math.abs(eased - target) <= target * ZOOM_SNAP_EPS ? target : eased;
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
   * Install a predicate that claims a client point for the HUD against EDGE SCROLLING (the tool-panel
   * strip hugs the left edge, the minimap the corner — hovering them must not also pan the camera).
   * Broader than the wheel guard on purpose: the wheel should still zoom over the strip, but the
   * edge-pan must yield to any HUD surface under the cursor. Pass `null` to clear.
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
  // The eased pan velocity (screen px/s) the held keys + edge scroll drive; decays to a stop.
  let panVx = 0;
  let panVy = 0;
  // Last known pointer position (client px) + whether it is over the canvas — the edge-scroll probe.
  let pointerX = 0;
  let pointerY = 0;
  let pointerInside = false;

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
  // key stuck in `held` (the camera pans forever) or `dragging` stuck true. Reset on blur; the eased pan
  // velocity is killed too so the camera doesn't glide on while the window is unfocused.
  const onBlur = (): void => {
    held.clear();
    dragging = false;
    pointerInside = false;
    panVx = 0;
    panVy = 0;
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
      // The jump replaces the frame outright, so the wheel glide retargets to the new scale and any
      // in-flight eased pan stops (a minimap jump must not carry the old glide into the new view).
      targetScale = next.scale ?? 1;
      panVx = 0;
      panVy = 0;
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
        cam = stepZoomToward(cam, targetScale, zoomAnchorX, zoomAnchorY, dt);
      }
      // Desired pan velocity (screen px/s): held arrows plus the screen-edge pointer. Camera-scroll
      // convention throughout: an input reveals the world in its direction (look right → the world
      // slides left → offset shrinks).
      let desiredX = 0;
      let desiredY = 0;
      if (held.has('ArrowLeft')) desiredX += ARROW_PAN_SPEED;
      if (held.has('ArrowRight')) desiredX -= ARROW_PAN_SPEED;
      if (held.has('ArrowUp')) desiredY += ARROW_PAN_SPEED;
      if (held.has('ArrowDown')) desiredY -= ARROW_PAN_SPEED;
      // Edge scroll: pointer resting in the margin band pans, unless mid-drag (the drag owns the
      // motion), the window is unfocused (RAF still runs when visible), or a HUD surface claims the
      // point (hovering the strip/minimap must not also pan).
      if (pointerInside && !dragging && document.hasFocus() && edgeGuard?.(pointerX, pointerY) !== true) {
        const { sx, sy, rect } = screenScale(canvas, resolution);
        const edge = edgePanVelocity(pointerX - rect.left, pointerY - rect.top, rect.width, rect.height);
        desiredX += edge.vx * sx; // CSS px/s → screen px/s, same scroll convention as the arrows
        desiredY += edge.vy * sy;
      }
      // Ease the velocity toward the desire (ramp up + glide out), stopping dead below the sub-pixel
      // tail threshold so an idle camera does no per-frame work.
      const ease = easeFactor(dt, PAN_EASE_HALF_LIFE_MS);
      panVx += (desiredX - panVx) * ease;
      panVy += (desiredY - panVy) * ease;
      if (desiredX === 0 && Math.abs(panVx) < PAN_STOP_SPEED) panVx = 0;
      if (desiredY === 0 && Math.abs(panVy) < PAN_STOP_SPEED) panVy = 0;
      if (panVx !== 0 || panVy !== 0) {
        cam = panCamera(cam, (panVx * dt) / 1000, (panVy * dt) / 1000);
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
