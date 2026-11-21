import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform, release } from 'node:os';
import { resolve } from 'node:path';
import {
  boxAround,
  drag,
  drawnPeople,
  occlusionCounts,
  openTradeWindow,
  SETTLE_MS,
  selectOneSettler,
  setSeeThrough,
  watchFrameInputs,
  worldArea,
} from '../../browser/input.mjs';
import {
  benchBrowserInfo,
  cameraAt,
  checkpointSession,
  DEVICE_SCALE,
  densestBattle,
  densestBuildings,
  loadGateNote,
  MAX_LOAD_PER_CPU,
  machineLoad,
  nearestCoast,
  openBenchBrowser,
  openBenchPage,
  overloaded,
  ownTradeRoutes,
  restoreCheckpoint,
  unlockAudio,
  VIEWPORT,
  verifyDevServer,
} from '../../browser/session.mjs';
import {
  MANY_SELECTED,
  MANY_SELECTION_ZOOM,
  markdownTable,
  parseGpuBenchArgs,
  scenarioSettings,
  summarizeRepeats,
} from './gpu-plan.mjs';
import { countGlCalls, guardCamera } from './profile.mjs';

/**
 * GPU time and WebGL call counts per graphics setting, panel, selection, weather and zoom, from a
 * `bench:map` checkpoint against this checkout's development server. See docs/DEVELOPMENT.md.
 */

const options = parseGpuBenchArgs(process.argv.slice(2), process.env);
const { seconds, repeats, output } = options;
/** Shader compiles and the FPS counter's first readings settle within this. */
const WARM_MS = 3000;
/** A prescaled scaler redraws the pages a view draws over the following frames; a scenario waits this
 *  long for it to finish before its window is void. */
const PRESCALE_SETTLE_MS = 30000;
const PRESCALE_POLL_MS = 100;
/** The FPS counter folds half-second windows; sampling at that rate sees each reading about once. */
const READING_MS = 500;
/** The pointer rests on the bottom HUD bar, where no world hover card can rise, or for
 *  `pointer: 'world'` over the middle of the world. */
const POINTER_REST = { x: VIEWPORT.width / 2, y: VIEWPORT.height - 3 };
const POINTER_WORLD = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
/** The trade view tries this many of the traders nearest the dense view before giving up. */
const TRADE_CANDIDATES = 10;
const FAILURE_SHOT_TIMEOUT_MS = 10000;

const saveText = await readFile(options.checkpoint, 'utf8');
const { header, stateHash, params } = checkpointSession(JSON.parse(saveText));
await mkdir(output, { recursive: true });
const metadata = {
  startedAt: new Date().toISOString(),
  checkpoint: resolve(options.checkpoint),
  header,
  viewport: VIEWPORT,
  deviceScale: DEVICE_SCALE,
  seconds,
  repeats,
  os: {
    platform: platform(),
    release: release(),
    cpus: cpus().map((c) => ({ model: c.model, speed: c.speed })),
    loadAtStart: loadavg(),
  },
  limitations: [
    'GPU ms is perf().gpu.ms, the FPS counter meter: a half-second mean from the ground-wave lift map through the stage render to the last inset, read every half second. It excludes the compositor and the DOM HUD.',
    'The figure per scenario is the lowest per-repeat median; GL counts are per rendered frame over every repeat.',
    'Repeats of a scenario run back to back from one restore, so a running scenario measures later ticks each repeat.',
    'One selected settler always opens the settler panel, so the single-selection case is panel-*.',
    'Ghosted units and faded occluders are read once, from the last frame of the last repeat.',
    ...[loadGateNote()].filter((note) => note !== null),
  ],
  scenarios: [],
  skipped: [],
  errors: [],
};
const progress = (message) => {
  metadata.lastProgress = { at: new Date().toISOString(), message };
  console.log(`bench:gpu ${message}`);
};
// Windows reports no load average, so the gate cannot void a scenario there; the report says so.
const startLoad = machineLoad();
const startLoadText = startLoad.available ? startLoad.loadPerCpu.toFixed(1) : 'unavailable';
const writeReport = async () => {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(metadata, null, 2));
  const head = [
    `# bench:gpu ${header.mapId} tick ${header.tick}`,
    '',
    `Adapter: ${metadata.adapter ?? 'unknown'}; GPU timer ${metadata.gpuTimer ? 'available' : 'unavailable'}.`,
    `Browser: ${metadata.browser?.version ?? 'not started'}${metadata.browser?.cdp ? ` over CDP at ${metadata.browser.cdp}` : ''}.`,
    `${VIEWPORT.width}x${VIEWPORT.height} at device scale ${DEVICE_SCALE}, ${repeats} x ${seconds} s per scenario; one-minute load per CPU at start ${startLoadText}, gate ${MAX_LOAD_PER_CPU}.`,
    '',
    markdownTable(metadata.scenarios),
    '',
    ...metadata.skipped.map((skip) => `Skipped ${skip.id}: ${skip.reason}.`),
  ];
  await writeFile(resolve(output, 'report.md'), head.join('\n'));
};

/** Select `target` settlers with the player's own input: a click for one, a box drag for more. */
async function select(page, target, dense) {
  const area = worldArea();
  if (target === 1) {
    await selectOneSettler(page, area);
    return;
  }
  if (target >= MANY_SELECTED) {
    await page.evaluate(
      (c) => window.__opennorthland.cameraCtl.jumpTo(c),
      cameraAt(dense, MANY_SELECTION_ZOOM),
    );
    await page.waitForTimeout(SETTLE_MS);
    await drag(page, area);
    return;
  }
  const box = boxAround(await drawnPeople(page, area), target, area);
  if (box !== null) await drag(page, box);
}

/**
 * Open a trade window with the player's clicks, trying the own trade routes nearest `dense` in turn,
 * each framed at `zoom`: the camera that shows the trader and the window's state, or the reason none
 * opened.
 */
async function openTrade(page, dense, zoom) {
  const routes = await ownTradeRoutes(page, dense, TRADE_CANDIDATES);
  for (const route of routes) {
    const camera = cameraAt(route.point, zoom);
    await page.evaluate((c) => window.__opennorthland.cameraCtl.jumpTo(c), camera);
    await page.waitForTimeout(SETTLE_MS);
    const state = await openTradeWindow(page, route, worldArea());
    if (state !== null) return { camera, trader: route.id, cart: route.cart, ...state };
  }
  return {
    failed:
      routes.length === 0
        ? 'no trader plies between two houses of its own owner'
        : `none of the ${routes.length} nearest traders between own houses opened its trade window`,
  };
}

/** Hide the named world layers (`HIDEABLE_LAYERS`) for the rest of the page's life. */
function hideLayers(page, names) {
  return page.evaluate((hidden) => {
    // The world renderer's terrain layer is a private field, reached for this measurement only.
    const terrain = window.__opennorthland.renderer.terrain;
    const layers = { roads: terrain.roadContainer };
    for (const name of hidden) layers[name].visible = false;
  }, names);
}

/** The prescaler's state once two consecutive frames found no page waiting for a twin, or the last
 *  state read with `settled: false` after {@link PRESCALE_SETTLE_MS}; null without a prescaled scaler. */
async function settlePrescale(page) {
  const started = Date.now();
  for (;;) {
    const stats = await page.evaluate(async () => {
      const renderer = window.__opennorthland.renderer;
      const frame = () => new Promise((done) => requestAnimationFrame(done));
      const first = renderer.prescaleStats();
      await frame();
      const second = renderer.prescaleStats();
      return {
        ...second,
        quiet: first.pending - first.overBudget === 0 && second.pending - second.overBudget === 0,
      };
    });
    if (stats.scaler === null) return null;
    const settled = stats.quiet;
    if (settled || Date.now() - started > PRESCALE_SETTLE_MS)
      return { pages: stats.pages, bytes: stats.bytes, overBudget: stats.overBudget, settled };
    await page.waitForTimeout(PRESCALE_POLL_MS);
  }
}

async function measureRepeat(page) {
  await countGlCalls(page);
  const loadAtStart = machineLoad();
  await page.evaluate((readingMs) => {
    const d = window.__opennorthland;
    const probe = { gpuMs: [], hidden: document.hidden, stop: false, selected: 0, insets: 0 };
    window.__gpuBench = probe;
    const frame = () => {
      if (probe.stop) return;
      window.__measurementGuard.check();
      probe.hidden ||= document.hidden;
      probe.selected = Math.max(probe.selected, window.__frameInputs.selection);
      probe.insets = Math.max(probe.insets, window.__frameInputs.insets);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    probe.timer = setInterval(async () => {
      const ms = (await d.perf()).gpu.ms;
      if (ms !== null && !probe.stop) probe.gpuMs.push(ms);
    }, readingMs);
  }, READING_MS);
  await page.waitForTimeout(seconds * 1000);
  const result = await page.evaluate(() => {
    const probe = window.__gpuBench;
    probe.stop = true;
    clearInterval(probe.timer);
    return {
      gpuMs: probe.gpuMs,
      hidden: probe.hidden || document.hidden,
      drift: window.__measurementGuard.drift,
      selected: probe.selected,
      insets: probe.insets,
      tick: window.__opennorthland.host.tick,
      gl: window.__glCalls.report(),
    };
  });
  const loadAtEnd = machineLoad();
  const invalid = [];
  if (overloaded(loadAtStart, loadAtEnd)) invalid.push('load');
  if (result.hidden) invalid.push('hidden');
  if (result.drift) invalid.push('camera drift');
  if (metadata.gpuTimer && result.gpuMs.length === 0) invalid.push('no GPU reading');
  return { ...result, loadAtStart, loadAtEnd, invalid };
}

let browser;
let page;
try {
  const previewUrl = new URL(`?${params}`, options.origin);
  progress('verifying development server and content');
  metadata.preview = await verifyDevServer(previewUrl);
  browser = await openBenchBrowser();
  metadata.browser = benchBrowserInfo(browser);
  page = await openBenchPage(browser);
  page.on('pageerror', (e) => metadata.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') metadata.errors.push(m.text());
  });
  await page.goto(options.origin.origin);
  let dense = null;
  let battle = null;
  for (const scenario of options.scenarios) {
    progress(`restoring for ${scenario.id}`);
    const url = new URL(previewUrl);
    if (scenario.weather !== null) url.searchParams.set('weather', scenario.weather);
    const settings = scenarioSettings(scenario);
    await restoreCheckpoint(page, { saveText, header, stateHash, url: url.href, settings });
    const stored = await page.evaluate(async () => {
      const { readStoredSettings } = await import('/src/view/settings/store.ts');
      return readStoredSettings();
    });
    const unapplied = Object.keys(settings).filter((key) => stored[key] !== settings[key]);
    if (unapplied.length > 0) throw new Error(`Settings did not apply: ${unapplied}`);
    const audio = (await unlockAudio(page)) ? 'audible' : 'no sound bank';
    if (metadata.audio !== undefined && metadata.audio !== audio)
      throw new Error(`Audio changed between scenarios: ${metadata.audio} then ${audio} at ${scenario.id}`);
    metadata.audio = audio;
    if (dense === null) {
      dense = (await densestBuildings(page)).point;
      const gpu = await page.evaluate(async () => {
        const gl = window.__opennorthland.renderer.app.renderer.gl;
        return {
          adapter: (await window.__opennorthland.perf()).gpu.adapter,
          timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
        };
      });
      metadata.adapter = gpu.adapter;
      metadata.gpuTimer = gpu.timer;
    }
    if (scenario.view === 'battle' && battle === null) {
      const found = await densestBattle(page);
      if (found.count <= 0) throw new Error(`No fighting or bone piles to frame for ${scenario.id}`);
      battle = found.point;
      metadata.battle = found;
    }
    if (scenario.view === 'coast' && metadata.coast === undefined)
      metadata.coast = await nearestCoast(page, dense, scenario.zoom);
    if (scenario.view === 'coast' && metadata.coast === null) {
      metadata.skipped.push({ id: scenario.id, reason: 'the map has no shore waves' });
      await writeReport();
      continue;
    }
    await watchFrameInputs(page);
    const views = { dense, battle, coast: metadata.coast?.point, trade: dense };
    let camera = cameraAt(views[scenario.view], scenario.zoom);
    await page.evaluate((c) => {
      const d = window.__opennorthland;
      d.cameraCtl.setSuspended(true);
      d.cameraCtl.jumpTo(c);
    }, camera);
    await page.waitForTimeout(SETTLE_MS);
    if (scenario.hidden.length > 0) await hideLayers(page, scenario.hidden);
    if (scenario.view === 'trade') {
      const trade = await openTrade(page, dense, scenario.zoom);
      if (trade.failed !== undefined) {
        metadata.skipped.push({ id: scenario.id, reason: trade.failed });
        await writeReport();
        continue;
      }
      camera = trade.camera;
      metadata.trade = trade;
    } else if (scenario.selection > 0) await select(page, scenario.selection, dense);
    if (scenario.seeThrough) await setSeeThrough(page, true);
    const pointer = scenario.pointer === 'world' ? POINTER_WORLD : POINTER_REST;
    await page.mouse.move(pointer.x, pointer.y);
    await guardCamera(page, camera);
    await page.evaluate(async (speed) => {
      const d = window.__opennorthland;
      if (speed > 0) d.setSpeed(speed);
      await d.setPaused(speed === 0);
    }, scenario.speed);
    await page.waitForTimeout(WARM_MS);
    let prescale = await settlePrescale(page);
    const runs = [];
    for (let repeat = 1; repeat <= repeats; repeat++) {
      progress(`measuring ${scenario.id} ${repeat}/${repeats} for ${seconds}s`);
      const run = await measureRepeat(page);
      if (run.selected < scenario.selection)
        run.invalid.push(`selected ${run.selected} of ${scenario.selection}`);
      // A window that drew prescale passes measured them, not the scaler's steady state.
      if (prescale !== null && !prescale.settled) run.invalid.push('prescaling');
      prescale = await settlePrescale(page);
      if (prescale !== null && !prescale.settled) run.invalid.push('prescaling');
      runs.push(run);
    }
    const occlusion = await occlusionCounts(page);
    await page.screenshot({ path: resolve(output, `${scenario.id}.png`) });
    const summary = summarizeRepeats(runs);
    const result = {
      ...scenario,
      settings,
      selected: Math.max(...runs.map((run) => run.selected)),
      insets: Math.max(...runs.map((run) => run.insets)),
      occlusion,
      prescale,
      summary,
      runs,
    };
    metadata.scenarios.push(result);
    progress(
      `${scenario.id}: GPU ${summary.gpuMs.minP50?.toFixed(2) ?? '-'} ms, ${Math.round(summary.gl.drawsPerFrame ?? 0)} draws${summary.invalid.length > 0 ? `, void: ${summary.invalid}` : ''}`,
    );
    await writeReport();
  }
  const invalid = metadata.scenarios.filter((result) => result.summary.invalid.length > 0).map((r) => r.id);
  if (metadata.errors.length || invalid.length)
    throw new Error(
      `Invalid GPU measurement: ${metadata.errors.length} browser errors; void scenarios ${invalid}`,
    );
  metadata.completed = true;
} catch (error) {
  metadata.failure = { message: error.message, stack: error.stack };
  if (page && !page.isClosed()) {
    try {
      await page.screenshot({ path: resolve(output, 'failure.png'), timeout: FAILURE_SHOT_TIMEOUT_MS });
    } catch (captureError) {
      metadata.failure.captureError = captureError.message;
    }
  }
  console.error(`bench:gpu ${error.message}`);
  process.exitCode = 1;
} finally {
  metadata.finishedAt = new Date().toISOString();
  metadata.os.loadAtEnd = loadavg();
  try {
    await writeReport();
  } finally {
    await browser?.close();
  }
}
