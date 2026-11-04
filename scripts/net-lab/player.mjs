// One player's page in the browser lab: its join, its orders through the real HUD, its measurement
// windows and its recovery after a chaos event. Every page call carries a hard timeout, since a page
// under load can stall `page.evaluate` for good.
import { resolve } from 'node:path';
import { seedHarnessSettings } from '../browser/harness-settings.mjs';
import { boxAround, drag, worldArea } from '../browser/input.mjs';
import { repoRoot } from '../content/dir.mjs';
import { createRecoveryTrack, percentile } from './plan.mjs';

export const VIEWPORT = { width: 1280, height: 800 };
const EVALUATE_TIMEOUT_MS = 15000;
const JOIN_TIMEOUT_MS = 180000;
const POLL_MS = 150;
/** A click holds the button this long, as a player's does. */
const CLICK_HOLD_MS = 120;
const SETTLE_MS = 400;
/** How long an order may take to show in the world before it counts as lost. */
const APPLY_TIMEOUT_MS = 20000;
const ARM_TIMEOUT_MS = 2000;
/** A walk target sits this far from the group's centre on screen, alternating sides. */
const WALK_REACH = { x: 170, y: 70 };
/** No drawn sprite may stand this close to a ground target, so the right click lands on bare ground. */
const GROUND_CLEARANCE = 34;
/** A walk's route ends this close to the clicked point on screen: a group spreads around its target. */
const ARRIVAL_REACH = 110;
/** Settlers a marquee aims to take; a small group keeps the order and its pathing cheap. */
const GROUP_SIZE = 5;
/** Screen offsets from the group's centre a building is tried at, farthest first: ground near the
 *  settlement's centre is the most crowded. */
const SITE_OFFSETS = [
  [260, 120],
  [-260, 120],
  [260, -110],
  [-260, -110],
  [0, 190],
  [0, -170],
  [340, 0],
  [-340, 0],
];
/** A building's footprint is wider than a settler's: no sprite this close to a site point. */
const SITE_CLEARANCE = 70;
/** A placed site shows within the input delay and a bad link's stall; a click that placed nothing
 *  shows nothing. */
const SITE_TRY_MS = 6000;
/** Error texts kept per page; a reconnect loop can print thousands. */
const MAX_ERRORS = 200;

/** `promise`, or a rejection naming `what` after `ms`. */
export function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, fail) => {
      timer = setTimeout(() => fail(new Error(`${what} timed out after ${ms} ms`)), ms);
    }),
  ]);
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

function evaluate(page, fn, arg, what = 'page.evaluate') {
  return withTimeout(page.evaluate(fn, arg), EVALUATE_TIMEOUT_MS, what);
}

/** A page in its own browser context, so its nick keeps its own reconnect token, recording its errors. */
export async function openPlayer(browser, { nick, profile, log }) {
  const context = await browser.newContext({ viewport: VIEWPORT, locale: 'en-US' });
  let page;
  try {
    await seedHarnessSettings(context);
    page = await context.newPage();
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
  const player = { nick, profile, context, page, errors: [], droppedErrors: 0, log };
  const record = (source, text) => {
    if (player.errors.length >= MAX_ERRORS) {
      player.droppedErrors += 1;
      return;
    }
    player.errors.push({ at: new Date().toISOString(), source, text: text.slice(0, 300) });
  };
  page.on('console', (message) => {
    if (message.type() === 'error') record('console', message.text());
  });
  page.on('pageerror', (error) => record('pageerror', error.message));
  page.on('crash', () => record('crash', 'page crashed'));
  return player;
}

/** The world as the page shows it, or null before one is up: its tick, the link and the lost screen. */
function worldState(page) {
  return evaluate(
    page,
    async () => {
      const debug = window.__opennorthland;
      if (debug === undefined) return null;
      const report = await debug.perf();
      const lost = document.querySelector('.on-link-lost');
      return {
        tick: debug.host.tick,
        paused: report.paused,
        connected: report.net?.connected ?? null,
        linkLost: lost !== null && lost.getClientRects().length > 0,
      };
    },
    undefined,
    'world state',
  );
}

/** Navigate `player` to `url`; `lobbyMs` is the time from the navigation until the room view shows,
 *  which `roomShown` decides from the page. */
export async function joinRoom(player, url, roomShown) {
  const { page } = player;
  const started = Date.now();
  await withTimeout(
    page.goto(url, { waitUntil: 'domcontentloaded' }),
    JOIN_TIMEOUT_MS,
    `${player.nick} navigation`,
  );
  await page.waitForFunction(roomShown.fn, roomShown.arg, { timeout: JOIN_TIMEOUT_MS, polling: POLL_MS });
  const lobbyMs = Date.now() - started;
  player.log(`${player.nick}: room shown after ${lobbyMs} ms`);
  return { started, lobbyMs };
}

/** After a join that started at `started`: `worldMs` until the world is up, `runningMs` until its clock
 *  ran past the tick it showed first. */
export async function awaitRunning(player, started) {
  const { page } = player;
  await page.waitForFunction(() => window.__opennorthland !== undefined, null, {
    timeout: JOIN_TIMEOUT_MS,
    polling: POLL_MS,
  });
  const worldMs = Date.now() - started;
  const first = (await worldState(page))?.tick ?? 0;
  await page.waitForFunction((tick) => (window.__opennorthland?.host.tick ?? -1) > tick, first, {
    timeout: JOIN_TIMEOUT_MS,
    polling: POLL_MS,
  });
  const runningMs = Date.now() - started;
  player.log(`${player.nick}: world after ${worldMs} ms, running after ${runningMs} ms`);
  return { worldMs, runningMs };
}

/** Keeps the selection each frame draws in `window.__labSelection`, read when asked since the set may
 *  change in place; a rebuilt world brings a new renderer, so this is repeated before each read. */
function watchSelection(page) {
  return evaluate(
    page,
    () => {
      const renderer = window.__opennorthland.renderer;
      if (renderer.__labWatched === true) return;
      renderer.__labWatched = true;
      window.__labSelection = undefined;
      const update = renderer.update.bind(renderer);
      renderer.update = (frame) => {
        window.__labSelection = frame.selection;
        update(frame);
      };
    },
    undefined,
    'selection watch',
  );
}

async function selectedIds(page) {
  await pause(SETTLE_MS);
  return evaluate(page, () => [...(window.__labSelection ?? [])], undefined, 'selection read');
}

async function pressKey(page, key) {
  await page.keyboard.press(key);
  await pause(SETTLE_MS);
}

/** A held mouse click at `point` with `button`, the pointer then parked mid-screen so edge scrolling
 *  never moves the camera. */
async function holdClick(page, point, button = 'left') {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button });
  await pause(CLICK_HOLD_MS);
  await page.mouse.up({ button });
  await parkPointer(page);
}

export function parkPointer(page) {
  return page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
}

/** Close the mission book and any open HUD window with a real click on its close button, then start a
 *  clock the book paused. */
export async function clearScreen(player) {
  const { page } = player;
  const buttons = await evaluate(
    page,
    () =>
      [...document.querySelectorAll('.on-book__close, .on-window:not(.on-link-lost) .on-window__close')]
        .map((button) => button.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0)
        .map((box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })),
    undefined,
    'close buttons',
  );
  for (const point of buttons) await holdClick(page, point);
  const state = await worldState(page);
  if (state?.paused === true) {
    player.log(`${player.nick}: clock paused; unpausing`);
    await withTimeout(
      page.evaluate(() => window.__opennorthland.setPaused(false)),
      EVALUATE_TIMEOUT_MS,
      'unpause',
    ).catch((error) => player.log(`${player.nick}: unpause: ${error.message}`));
  }
  return buttons.length;
}

const sourceModules = {
  fixed: `/@fs${resolve(repoRoot, 'packages/sim/src/core/fixed.ts')}`,
  projection: `/@fs${resolve(repoRoot, 'packages/render/src/data/projection/iso.ts')}`,
};

/**
 * The seat this page plays, read as the owner of the settler the next-civilian key selects, with the
 * camera then centred on that seat's people. Null when the key selects nobody.
 */
export async function findSeat(player) {
  const { page } = player;
  await watchSelection(page);
  await parkPointer(page);
  await pressKey(page, 'Period');
  const [id] = await selectedIds(page);
  if (id === undefined) return null;
  return evaluate(
    page,
    async ({ id, modules, viewport }) => {
      const { ONE } = await import(modules.fixed);
      const { tileToScreen } = await import(modules.projection);
      const debug = window.__opennorthland;
      const entities = debug.host.snapshot().entities;
      const seat = entities.find((entity) => entity.id === id)?.components.Owner?.player ?? null;
      if (seat === null) return null;
      const points = entities
        .filter((e) => e.components.Settler && e.components.Position && e.components.Owner?.player === seat)
        .map((e) => tileToScreen(e.components.Position.x / ONE, e.components.Position.y / ONE));
      const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const centre = { x: median(points.map((p) => p.x)), y: median(points.map((p) => p.y)) };
      const camera = debug.cameraCtl.camera();
      debug.cameraCtl.jumpTo({
        ...camera,
        offsetX: viewport.width / 2 - centre.x * camera.scale,
        offsetY: viewport.height / 2 - centre.y * camera.scale,
      });
      return seat;
    },
    { id, modules: sourceModules, viewport: VIEWPORT },
    'seat',
  );
}

/** The screen points of `seat`'s drawn settlers inside the world area, and every drawn sprite's point. */
function screenPoints(page, seat, area) {
  return evaluate(
    page,
    ({ seat, area }) => {
      const debug = window.__opennorthland;
      const camera = debug.cameraCtl.camera();
      const owners = new Map();
      for (const entity of debug.host.snapshot().entities)
        if (entity.components.Owner !== undefined) owners.set(entity.id, entity.components.Owner.player);
      const own = [];
      const sprites = [];
      for (const item of debug.renderer.drawnItems()) {
        if (item.kind === 'tile') continue;
        const point = {
          id: item.ref,
          x: item.x * camera.scale + camera.offsetX,
          y: item.y * camera.scale + camera.offsetY,
        };
        sprites.push(point);
        const inside =
          point.x > area.left && point.x < area.right && point.y > area.top && point.y < area.bottom;
        if (item.kind === 'settler' && inside && owners.get(item.ref) === seat) own.push(point);
      }
      return { own, sprites };
    },
    { seat, area },
    'screen points',
  );
}

/** Marquee-select a few of `seat`'s settlers near the screen centre; the selected ids, or [] when none
 *  stand there. */
export async function selectGroup(player, seat) {
  const { page } = player;
  await watchSelection(page);
  const area = worldArea(VIEWPORT);
  const { own } = await screenPoints(page, seat, area);
  if (own.length === 0) return [];
  const box = boxAround(own, Math.min(GROUP_SIZE, own.length), area, VIEWPORT);
  if (box === null) return [];
  await drag(page, box);
  await parkPointer(page);
  return selectedIds(page);
}

/** A bare ground point beside the group, on the side `side` (1 or -1), inside the world area. */
async function groundTarget(page, seat, ids, side) {
  const area = worldArea(VIEWPORT);
  const { own, sprites } = await screenPoints(page, seat, area);
  const group = own.filter((point) => ids.includes(point.id));
  const from = group.length > 0 ? group : own;
  const centre = {
    x:
      percentile(
        from.map((p) => p.x),
        0.5,
      ) ?? VIEWPORT.width / 2,
    y:
      percentile(
        from.map((p) => p.y),
        0.5,
      ) ?? VIEWPORT.height / 2,
  };
  const candidates = [];
  for (const scale of [1, 0.7, 1.3, 0.4])
    for (const flip of [1, -1])
      candidates.push({
        x: centre.x + side * flip * WALK_REACH.x * scale,
        y: centre.y + flip * WALK_REACH.y * scale,
      });
  return (
    candidates.find(
      (point) =>
        point.x > area.left &&
        point.x < area.right &&
        point.y > area.top &&
        point.y < area.bottom &&
        sprites.every((sprite) => Math.hypot(sprite.x - point.x, sprite.y - point.y) > GROUND_CLEARANCE),
    ) ?? null
  );
}

/** Each of `ids`' order, queue and route end, the end as a point on screen, as the world holds them now. */
function orderState(page, ids) {
  return evaluate(
    page,
    async ({ ids, modules }) => {
      const { ONE } = await import(modules.fixed);
      const { tileToScreen } = await import(modules.projection);
      const debug = window.__opennorthland;
      const camera = debug.cameraCtl.camera();
      const wanted = new Set(ids);
      const rows = {};
      for (const entity of debug.host.snapshot().entities) {
        if (!wanted.has(entity.id)) continue;
        const route = entity.components.PathRoute?.waypoints;
        const last = route === undefined || route.length === 0 ? null : route[route.length - 1];
        const end = last === null ? null : tileToScreen(last.x / ONE, last.y / ONE);
        rows[entity.id] = {
          end:
            end === null
              ? null
              : { x: end.x * camera.scale + camera.offsetX, y: end.y * camera.scale + camera.offsetY },
          order: entity.components.PlayerOrder !== undefined,
          attackMove: entity.components.PlayerOrder?.attackMove !== undefined,
          queued: entity.components.OrderQueue?.orders.length ?? 0,
        };
      }
      return { tick: debug.host.tick, rows };
    },
    { ids, modules: sourceModules },
    'order state',
  );
}

/** Poll until `test(before, now)` holds; the wall ms from `issuedAt` and the ticks it took, or null. */
async function awaitEffect(page, ids, before, issuedAt, test) {
  const deadline = issuedAt + APPLY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const now = await orderState(page, ids);
    if (test(before, now)) return { appliedMs: Date.now() - issuedAt, ticks: now.tick - before.tick };
    await pause(POLL_MS);
  }
  return { appliedMs: null, ticks: null };
}

/** A selected settler holds a player order whose route now ends by `target`, which it did not before:
 *  an older order still being walked out cannot pass for this one. */
const routeTo = (target) => (before, now) =>
  Object.entries(now.rows).some(([id, row]) => {
    const near = (end) => end !== null && Math.hypot(end.x - target.x, end.y - target.y) <= ARRIVAL_REACH;
    return row.order && near(row.end) && !near(before.rows[id]?.end ?? null);
  });

/** Right-click bare ground beside the selected group: a walk order, applied once a selected settler's
 *  route ends by the clicked point. */
export async function walkOrder(player, seat, ids, side) {
  const { page } = player;
  const target = await groundTarget(page, seat, ids, side);
  if (target === null)
    return { kind: 'walk', appliedMs: null, ticks: null, note: 'no bare ground beside the group' };
  const before = await orderState(page, ids);
  const issuedAt = Date.now();
  await holdClick(page, target, 'right');
  return { kind: 'walk', ...(await awaitEffect(page, ids, before, issuedAt, routeTo(target))) };
}

/** Shift + right-click on bare ground: a walk queued behind the current one, applied once a selected
 *  settler's order queue grew. */
export async function queuedWalkOrder(player, seat, ids, side) {
  const { page } = player;
  const target = await groundTarget(page, seat, ids, side);
  if (target === null) return { kind: 'queuedWalk', appliedMs: null, ticks: null, note: 'no bare ground' };
  const before = await orderState(page, ids);
  const issuedAt = Date.now();
  await page.keyboard.down('Shift');
  await holdClick(page, target, 'right');
  await page.keyboard.up('Shift');
  return {
    kind: 'queuedWalk',
    ...(await awaitEffect(page, ids, before, issuedAt, (then, now) =>
      Object.entries(now.rows).some(([id, row]) => row.queued > (then.rows[id]?.queued ?? 0)),
    )),
  };
}

/** The attack-move key, then a left click on bare ground: applied once a selected settler marches. Null
 *  when the key arms nothing, as for a group without fighters. */
export async function attackMoveOrder(player, seat, ids, side) {
  const { page } = player;
  const target = await groundTarget(page, seat, ids, side);
  if (target === null) return { kind: 'attackMove', appliedMs: null, ticks: null, note: 'no bare ground' };
  await page.keyboard.press('KeyA');
  const armed = await page
    .waitForFunction(() => document.querySelector('canvas')?.style.cursor === 'crosshair', null, {
      timeout: ARM_TIMEOUT_MS,
      polling: POLL_MS,
    })
    .then(() => true)
    .catch(() => false);
  if (!armed) return null;
  const before = await orderState(page, ids);
  const issuedAt = Date.now();
  await holdClick(page, target);
  return {
    kind: 'attackMove',
    ...(await awaitEffect(
      page,
      ids,
      before,
      issuedAt,
      (then, now) => routeTo(target)(then, now) && Object.values(now.rows).some((row) => row.attackMove),
    )),
  };
}

/** How many building sites the seat has, which a placed building adds to. */
function siteCount(page, seat) {
  return evaluate(
    page,
    (seat) => {
      let sites = 0;
      for (const entity of window.__opennorthland.host.snapshot().entities)
        if (entity.components.UnderConstruction !== undefined && entity.components.Owner?.player === seat)
          sites += 1;
      return { tick: window.__opennorthland.host.tick, sites };
    },
    seat,
    'site count',
  );
}

/** The first open card's pick button in the construction window, or null while none shows. */
function firstOpenCard(page) {
  return evaluate(
    page,
    () => {
      const pick = [
        ...document.querySelectorAll(
          '.on-window--construction .on-bcard:not(.on-bcard--locked) .on-bcard__pick',
        ),
      ]
        .map((button) => ({
          box: button.getBoundingClientRect(),
          title: button.closest('.on-bcard')?.querySelector('.on-bcard__title')?.textContent ?? '',
        }))
        .find(({ box }) => box.width > 0 && box.height > 0);
      return pick === undefined
        ? null
        : {
            x: pick.box.x + pick.box.width / 2,
            y: pick.box.y + pick.box.height / 2,
            title: pick.title?.trim() ?? '',
          };
    },
    undefined,
    'construction card',
  );
}

/**
 * The construction key, the first building the window offers, then left clicks on ground around the group
 * until one takes: applied once the seat has one more building site. A click on ground the building may
 * not stand on places nothing, so each point gets {@link SITE_TRY_MS} before the next.
 */
export async function buildOrder(player, seat, ids) {
  const { page } = player;
  await pressKey(page, 'KeyB');
  const card = await firstOpenCard(page);
  if (card === null) return { kind: 'build', appliedMs: null, ticks: null, note: 'no open building card' };
  await holdClick(page, card);
  const area = worldArea(VIEWPORT);
  const { own, sprites } = await screenPoints(page, seat, area);
  const group = own.filter((point) => ids.includes(point.id));
  const from = group.length > 0 ? group : own;
  const centre = {
    x:
      percentile(
        from.map((p) => p.x),
        0.5,
      ) ?? VIEWPORT.width / 2,
    y:
      percentile(
        from.map((p) => p.y),
        0.5,
      ) ?? VIEWPORT.height / 2,
  };
  const points = SITE_OFFSETS.map(([dx, dy]) => ({ x: centre.x + dx, y: centre.y + dy })).filter(
    (point) =>
      point.x > area.left &&
      point.x < area.right &&
      point.y > area.top &&
      point.y < area.bottom &&
      sprites.every((sprite) => Math.hypot(sprite.x - point.x, sprite.y - point.y) > SITE_CLEARANCE),
  );
  const before = await siteCount(page, seat);
  for (const point of points) {
    const issuedAt = Date.now();
    await holdClick(page, point);
    while (Date.now() - issuedAt < SITE_TRY_MS) {
      const now = await siteCount(page, seat);
      if (now.sites > before.sites)
        return {
          kind: 'build',
          appliedMs: Date.now() - issuedAt,
          ticks: now.tick - before.tick,
          building: card.title,
        };
      await pause(POLL_MS);
    }
  }
  // Calls the held building off, as the right button or Esc does while one is held.
  await page.keyboard.press('Escape');
  return {
    kind: 'build',
    appliedMs: null,
    ticks: null,
    note: `no site took ${card.title} at ${points.length} clear ground point(s)`,
  };
}

/** The seat's finished shelter buildings and how many of them defend. */
function defenceState(page, seat) {
  return evaluate(
    page,
    (seat) => {
      const host = window.__opennorthland.host;
      const shelters = new Set(
        host.content.buildings.filter((def) => (def.shelterCapacity ?? 0) > 0).map((def) => def.typeId),
      );
      let total = 0;
      let defending = 0;
      for (const entity of host.snapshot().entities) {
        const building = entity.components.Building;
        if (building === undefined || entity.components.Owner?.player !== seat) continue;
        if (!shelters.has(building.buildingType) || entity.components.UnderConstruction !== undefined)
          continue;
        total += 1;
        if (entity.components.DefenceMode !== undefined) defending += 1;
      }
      return { tick: host.tick, total, defending };
    },
    seat,
    'defence state',
  );
}

/** The defence key (`key` on, `Shift+key` off) for every shelter of the seat: applied once the count of
 *  defending shelters reaches all or none. Null when the seat has no shelter to order. */
export async function defenceOrder(player, seat, enabled) {
  const { page } = player;
  const before = await defenceState(page, seat);
  if (before.total === 0) return null;
  const goal = enabled ? before.total : 0;
  if (before.defending === goal) return null;
  const issuedAt = Date.now();
  await page.keyboard.press(enabled ? 'KeyV' : 'Shift+KeyV');
  const deadline = issuedAt + APPLY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const now = await defenceState(page, seat);
    if (now.defending === goal)
      return {
        kind: enabled ? 'defenceOn' : 'defenceOff',
        appliedMs: Date.now() - issuedAt,
        ticks: now.tick - before.tick,
      };
    await pause(POLL_MS);
  }
  return { kind: enabled ? 'defenceOn' : 'defenceOff', appliedMs: null, ticks: null };
}

/** One measurement window's figures, then a fresh window. */
export async function sampleWindow(player) {
  const sample = await evaluate(
    player.page,
    async () => {
      const debug = window.__opennorthland;
      if (debug === undefined) return null;
      const report = await debug.perf();
      debug.resetPerf();
      return {
        tick: report.tick,
        hidden: report.sampling.hidden,
        ms: report.window.ms,
        frames: report.window.frames,
        p95Ms: report.frame.p95Ms,
        p99Ms: report.frame.p99Ms,
        maxMs: report.frame.maxMs,
        fps: report.frame.fps,
        deliveredSpeed: report.throughput.deliveredSpeed,
        connected: report.net?.connected ?? null,
        roundTripMs: report.net?.roundTripMs ?? null,
        delayTicks: report.net?.delayTicks ?? null,
        delayMs: report.net?.delayMs ?? null,
        clickToApplyMs: report.net?.clickToApplyMs ?? null,
        bufferedTicks: report.net?.bufferedTicks ?? null,
      };
    },
    undefined,
    'perf window',
  );
  return sample === null ? null : { at: new Date().toISOString(), ...sample };
}

/**
 * Follow `player` after a chaos event fired at `firedAt` until its world runs again
 * (`createRecoveryTrack`). `observer`, another page, gives the longest the room's clock stood still
 * meanwhile. `expectLoss` false reports no loss time (a reload replaces the page instead).
 */
export async function followRecovery(player, observer, { firedAt, timeoutMs, expectLoss, lossWaitMs }) {
  const deadline = firedAt + timeoutMs;
  const track = createRecoveryTrack({ firedAt, lossWaitMs });
  let stall = { tick: null, since: Date.now(), longest: 0 };
  const watchObserver = async () => {
    if (observer === null) return;
    const tick = (await worldState(observer.page).catch(() => null))?.tick ?? null;
    const now = Date.now();
    if (tick === null || tick !== stall.tick) stall = { tick, since: now, longest: stall.longest };
    stall.longest = Math.max(stall.longest, now - stall.since);
  };
  const finish = (result) => ({
    ...result,
    ...(expectLoss ? {} : { lostMs: 0 }),
    roomStallMs: stall.longest,
  });
  while (Date.now() < deadline) {
    await watchObserver();
    const state = await worldState(player.page).catch(() => null);
    const result = track.observe(state, Date.now());
    if (result !== null) return finish(result);
    await pause(POLL_MS);
  }
  return finish(track.unfinished());
}
