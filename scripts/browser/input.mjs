import { VIEWPORT } from './session.mjs';

/**
 * The browser benchmarks' player input: clicks and box drags with a held button, and the settler and
 * building picks they aim at. Shared by `bench:gpu`, `bench:gpu-settings` and `bench:hud`.
 */

/** A click holds the button this long, as a player's does; a bare click can miss DOM swapped under it. */
const CLICK_HOLD_MS = 120;
export const SETTLE_MS = 500;
/** Box drag steps, so the HUD sees a drag rather than a jump. */
const DRAG_STEPS = 10;
/** A settler's anchor is its feet; a click this far above lands on its body. */
const SETTLER_BODY_LIFT = 14;
/** A building's anchor is its footprint; a click this far above lands on its walls. */
const BUILDING_BODY_LIFT = 40;
/** The HUD bars' reach from each window edge at UI scale 1, by observation at 1440x900; the bars hold
 *  to the edges at any window size, and the world area is the window inside them. */
const HUD_INSET = { left: 225, top: 145, right: 225, bottom: 185 };
/** The default `revealToggle` binding (`hud/keybindings.ts`), which switches the see-through view. */
const SEE_THROUGH_KEY = 'Tab';
const SEE_THROUGH_TIMEOUT_MS = 5000;
/** Settlers or buildings tried for a single selection before giving up. */
const SINGLE_PICK_TRIES = 30;
/** Box half-size increment, in screen pixels. */
const BOX_STEP = 5;

/** The world area clear of the HUD bars in a `viewport`-sized window at HUD scale `scale`. */
export function worldArea(viewport = VIEWPORT, scale = 1) {
  return {
    left: HUD_INSET.left * scale,
    top: HUD_INSET.top * scale,
    right: viewport.width - HUD_INSET.right * scale,
    bottom: viewport.height - HUD_INSET.bottom * scale,
  };
}

/** Screen points of drawn items of `kind` inside `area`, with their entity ids. */
export function drawnOnScreen(page, kind, area) {
  return page.evaluate(
    ({ kind, area }) => {
      const d = window.__opennorthland;
      const camera = d.cameraCtl.camera();
      const scale = camera.scale ?? 1;
      return d.renderer
        .drawnItems()
        .filter((item) => item.kind === kind)
        .map((item) => ({
          id: item.ref,
          x: item.x * scale + camera.offsetX,
          y: item.y * scale + camera.offsetY,
        }))
        .filter((p) => p.x > area.left && p.x < area.right && p.y > area.top && p.y < area.bottom);
    },
    { kind, area },
  );
}

/** Drawn people in `area` that a box drag selects: settlers with a person, not livestock or wildlife. */
export async function drawnPeople(page, area) {
  const drawn = await drawnOnScreen(page, 'settler', area);
  const people = await page.evaluate(
    (ids) => {
      const wanted = new Set(ids);
      return window.__opennorthland.host
        .snapshot()
        .entities.filter(
          (e) =>
            wanted.has(e.id) && e.components.Person !== undefined && e.components.Livestock === undefined,
        )
        .map((e) => e.id);
    },
    drawn.map((item) => item.id),
  );
  const selectable = new Set(people);
  return drawn.filter((item) => selectable.has(item.id));
}

export async function click(page, point) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(CLICK_HOLD_MS);
  await page.mouse.up();
  await page.waitForTimeout(SETTLE_MS);
}

export async function drag(page, box) {
  await page.mouse.move(box.left, box.top);
  await page.mouse.down();
  await page.waitForTimeout(CLICK_HOLD_MS);
  for (let step = 1; step <= DRAG_STEPS; step++)
    await page.mouse.move(
      box.left + ((box.right - box.left) * step) / DRAG_STEPS,
      box.top + ((box.bottom - box.top) * step) / DRAG_STEPS,
    );
  await page.waitForTimeout(CLICK_HOLD_MS);
  await page.mouse.up();
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * Whether exactly one entity is selected and it carries `component` (`Settler`, `Building`). Reads
 * `window.__frameInputs`, which {@link watchFrameInputs} keeps.
 */
function selectedHas(page, component) {
  return page.evaluate((name) => {
    const { selection, selectedId } = window.__frameInputs;
    if (selection !== 1) return false;
    const entity = window.__opennorthland.host.snapshot().entities.find((e) => e.id === selectedId);
    return entity?.components[name] !== undefined;
  }, component);
}

/** Record what each frame hands the renderer: selection size and portrait insets. */
export function watchFrameInputs(page) {
  return page.evaluate(() => {
    const renderer = window.__opennorthland.renderer;
    const inputs = { selection: 0, selectedId: null, insets: 0 };
    window.__frameInputs = inputs;
    const update = renderer.update.bind(renderer);
    renderer.update = (frame) => {
      inputs.selection = frame.selection?.size ?? 0;
      inputs.selectedId = inputs.selection > 0 ? frame.selection.values().next().value : null;
      update(frame);
    };
    const setInsets = renderer.setPortraitInsets.bind(renderer);
    renderer.setPortraitInsets = (frames) => {
      inputs.insets = frames.length;
      setInsets(frames);
    };
  });
}

/** Click drawn settlers until a settler alone is selected, not a signpost in front of one; false when
 *  none in `area` would take. */
export async function selectOneSettler(page, area) {
  for (const settler of (await drawnOnScreen(page, 'settler', area)).slice(0, SINGLE_PICK_TRIES)) {
    await click(page, { x: settler.x, y: settler.y - SETTLER_BODY_LIFT });
    if (await selectedHas(page, 'Settler')) return true;
  }
  return false;
}

/** Click drawn buildings until a building alone is selected; false when none in `area` would take. */
export async function selectOneBuilding(page, area) {
  for (const building of (await drawnOnScreen(page, 'building', area)).slice(0, SINGLE_PICK_TRIES)) {
    await click(page, { x: building.x, y: building.y - BUILDING_BODY_LIFT });
    if (await selectedHas(page, 'Building')) return true;
  }
  return false;
}

/** The smallest square centred on the view holding `target` of `points` inside `area`, or null. */
export function boxAround(points, target, area, viewport = VIEWPORT) {
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const reach = Math.min(center.x - area.left, center.y - area.top);
  for (let half = BOX_STEP; half <= reach; half += BOX_STEP) {
    const inside = points.filter((p) => Math.abs(p.x - center.x) <= half && Math.abs(p.y - center.y) <= half);
    if (inside.length >= target)
      return { left: center.x - half, top: center.y - half, right: center.x + half, bottom: center.y + half };
  }
  return null;
}

/** The moving-pointer windows' path: a 3:2 Lissajous curve over the middle of the world area. */
const LISSAJOUS_X = 3;
const LISSAJOUS_Y = 2;
const LISSAJOUS_PHASE = Math.PI / 2;
/** The curve's reach as a share of the world area's half-width and half-height. */
const PATH_REACH = 0.6;
/** Samples per period when the curve's length is measured. */
const PATH_LENGTH_SAMPLES = 4096;

/**
 * A pointer path over `area`: the screen point `seconds` into the move, travelling the curve at a
 * steady parameter rate whose mean speed is `pxPerSecond`.
 */
export function pointerPath(area, pxPerSecond) {
  const cx = (area.left + area.right) / 2;
  const cy = (area.top + area.bottom) / 2;
  const ax = ((area.right - area.left) / 2) * PATH_REACH;
  const ay = ((area.bottom - area.top) / 2) * PATH_REACH;
  const at = (theta) => ({
    x: cx + ax * Math.sin(LISSAJOUS_X * theta + LISSAJOUS_PHASE),
    y: cy + ay * Math.sin(LISSAJOUS_Y * theta),
  });
  let length = 0;
  let previous = at(0);
  for (let i = 1; i <= PATH_LENGTH_SAMPLES; i++) {
    const next = at((2 * Math.PI * i) / PATH_LENGTH_SAMPLES);
    length += Math.hypot(next.x - previous.x, next.y - previous.y);
    previous = next;
  }
  const radiansPerSecond = (2 * Math.PI * pxPerSecond) / length;
  return (seconds) => at(seconds * radiansPerSecond);
}

/** A real mouse sends moves faster than any frame rate; the browser coalesces them to one per frame. */
const MOVE_INTERVAL_MS = 8;

/** Move the real pointer along `path` (from {@link pointerPath}) for `seconds`; resolves when done. */
export async function movePointerAlong(page, path, seconds) {
  const started = Date.now();
  for (;;) {
    const elapsed = (Date.now() - started) / 1000;
    if (elapsed >= seconds) return;
    const point = path(elapsed);
    await page.mouse.move(point.x, point.y);
    const wait = MOVE_INTERVAL_MS - ((Date.now() - started) % MOVE_INTERVAL_MS);
    await new Promise((done) => setTimeout(done, wait));
  }
}

/** A vehicle's anchor is its wheels; a click this far above lands on its body. */
const VEHICLE_BODY_LIFT = 20;

/** The open trade window's portrait insets, and whether it shows at all. */
function tradeWindowState(page) {
  return page.evaluate(() => ({
    open: [...document.querySelectorAll('.on-hud .on-window--trade')].some(
      (e) => e.getClientRects().length > 0,
    ),
    insets: window.__frameInputs.insets,
  }));
}

/**
 * Open the trade window of `route` (from `ownTradeRoutes`) with the player's clicks: the trader, or its
 * cart when it rides one, then the panel's configure button. The camera must show the trader in `area`.
 * Returns the window's state, or null when no click took.
 */
export async function openTradeWindow(page, route, area) {
  const targets = [
    ...(await drawnOnScreen(page, 'settler', area))
      .filter((item) => item.id === route.id)
      .map((item) => ({ x: item.x, y: item.y - SETTLER_BODY_LIFT })),
    ...(await drawnOnScreen(page, 'vehicle', area))
      .filter((item) => item.id === route.cart)
      .map((item) => ({ x: item.x, y: item.y - VEHICLE_BODY_LIFT })),
  ];
  for (const target of targets) {
    await click(page, target);
    const configure = await page.evaluate(() => {
      const button = [...document.querySelectorAll('.on-hud .on-trade-configure')].find(
        (e) => e.getClientRects().length > 0,
      );
      const box = button?.getBoundingClientRect();
      return box === undefined ? null : { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    if (configure === null) continue;
    await click(page, configure);
    const state = await tradeWindowState(page);
    if (state.open) return state;
  }
  return null;
}

/** Switch the see-through view to `on` with its key; the map objects' fade shows the state a frame drew. */
export async function setSeeThrough(page, on) {
  // The map-object layer's fade is a private renderer field, read for this measurement only.
  const shows = (want) => (window.__opennorthland.renderer.mapObjects.decorFade !== undefined) === want;
  if (await page.evaluate(shows, on)) return;
  await page.keyboard.press(SEE_THROUGH_KEY);
  await page.waitForFunction(shows, on, { timeout: SEE_THROUGH_TIMEOUT_MS }).catch(() => {
    throw new Error(`The see-through key did not turn the view ${on ? 'on' : 'off'}`);
  });
}

/** The settlers the last frame ghosted behind an occluder, and the occluders the see-through view faded. */
export function occlusionCounts(page) {
  return page.evaluate(() => {
    // The sprite pool and its ghost sets are private renderer fields, read for this measurement only.
    const ghosts = window.__opennorthland.renderer.pool.occlusionGhosts;
    return { ghosted: ghosts.ghostedUnits.size, faded: ghosts.fadedPes.size + ghosts.fadedStatic.size };
  });
}
