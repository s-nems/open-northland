import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform, release } from 'node:os';
import { resolve } from 'node:path';
import {
  drag,
  SETTLE_MS,
  selectOneBuilding,
  selectOneSettler,
  watchFrameInputs,
  worldArea,
} from '../../browser/input.mjs';
import {
  benchBrowserInfo,
  cameraAt,
  checkpointSession,
  DEVICE_SCALE,
  densestBuildings,
  machineLoad,
  openBenchBrowser,
  openBenchPage,
  overloaded,
  restoreCheckpoint,
  unlockAudio,
  VIEWPORT,
  verifyDevServer,
} from '../../browser/session.mjs';
import { MANY_SELECTED } from './gpu-plan.mjs';
import {
  foldCpuProfile,
  foldInvalidations,
  foldLayers,
  foldTrace,
  hudSettings,
  INVALIDATION_CATEGORY,
  markdownTable,
  meanOfWindows,
  metricDeltas,
  parseHudBenchArgs,
} from './hud-plan.mjs';
import { guardCamera } from './profile.mjs';

/**
 * The in-game interface's main-thread and compositor cost per HUD scenario, from a `bench:map`
 * checkpoint against this checkout's development server. See docs/PERFORMANCE.md.
 */

const options = parseHudBenchArgs(process.argv.slice(2), process.env);
const { seconds, output } = options;
const viewport = VIEWPORT;
/** Panels settle, first figures paint and the hover card rises within this. */
const WARM_MS = 3000;
const FAILURE_SHOT_TIMEOUT_MS = 10000;
/** Playwright's channel for the full Chromium build, whose headless mode renders on the GPU. */
const HEADLESS_CHANNEL = 'chromium';
/** The resting pointer sits this far above the window's bottom edge, on the bottom bar. */
const POINTER_BAR_LIFT = 3;
/** Every trace category the fold reads: the renderer's frame phases, the compositor and the GPU process. */
const TRACE_CATEGORIES = [
  '-*',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'toplevel',
  'blink',
  'cc',
  'gpu',
  'viz',
  'v8',
];
/** The trace window is short: a trace of every category grows by megabytes a second. */
const TRACE_SECONDS = 3;
/** CPU profile sampling interval (microseconds); the fold attributes self time by source area. */
const PROFILE_INTERVAL_US = 250;

/** Windows and the mission book the HUD shows on the plane, open ones having a layout box. */
function openWindows(page) {
  return page.evaluate(
    () =>
      [...document.querySelectorAll('.on-hud :is(.on-window, .on-book-scene)')].filter(
        (e) => e.getClientRects().length > 0,
      ).length,
  );
}

/** Open a HUD window by its default key and check it showed. */
async function openByKey(page, key) {
  const before = await openWindows(page);
  await page.keyboard.press(key);
  await page.waitForTimeout(SETTLE_MS);
  const after = await openWindows(page);
  return { ready: after > before, note: `${key} opened ${after - before} window(s)` };
}

/** The window's middle, over the world whatever panel is open. */
const worldCentre = (viewport) => ({ x: viewport.width / 2, y: viewport.height / 2 });

/** `build-tabs` clicks the construction window's next category tab this often, from inside the page. */
const TAB_SWITCH_MS = 400;

/** Open the construction window and keep switching its category tabs until the page reloads. */
async function switchBuildTabs(page) {
  const opened = await openByKey(page, 'KeyB');
  const tabs = await page.evaluate((ms) => {
    const catalogue = [...document.querySelectorAll('.on-hud .on-window')].find(
      (element) => element.getClientRects().length > 0 && element.querySelector('.on-catalog') !== null,
    );
    const shown = [...(catalogue?.querySelectorAll('.on-tabs [role="tab"]') ?? [])].filter(
      (tab) => tab instanceof HTMLElement && tab.getClientRects().length > 0,
    );
    let at = 0;
    if (shown.length > 1)
      setInterval(() => {
        at = (at + 1) % shown.length;
        shown[at].click();
      }, ms);
    return shown.length;
  }, TAB_SWITCH_MS);
  return {
    ready: opened.ready && tabs > 1,
    note: `${opened.note}; ${tabs} tabs switched every ${TAB_SWITCH_MS} ms`,
  };
}

/** Where the pointer rests unless the scenario is about the pointer: the bottom bar. */
const restingPointer = (viewport) => ({ x: viewport.width / 2, y: viewport.height - POINTER_BAR_LIFT });

/** `presses` presses or releases the left mouse button this often, as pointer events on the element
 *  under the resting pointer. They do not bubble, so only capturing listeners such as the cursor
 *  theme's take them. */
const PRESS_MS = 250;

/** Keep pressing and releasing the mouse button at `pointer` until the page reloads. */
async function pressButtons(page, pointer) {
  const under = await page.evaluate(
    ({ ms, x, y }) => {
      let down = false;
      setInterval(() => {
        down = !down;
        const type = down ? 'pointerdown' : 'pointerup';
        const target = document.elementFromPoint(x, y) ?? window;
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerType: 'mouse',
            buttons: down ? 1 : 0,
          }),
        );
      }, ms);
      const element = document.elementFromPoint(x, y);
      return element === null ? 'nothing' : `${element.tagName.toLowerCase()}.${element.className}`;
    },
    { ms: PRESS_MS, ...pointer },
  );
  return { ready: true, note: `button pressed or released every ${PRESS_MS} ms over ${under}` };
}

/**
 * Each scenario's HUD state, reached with the player's input. `pointer` is where the pointer rests
 * while measuring: the bottom bar, where no hover card rises, unless the scenario is about the pointer.
 */
const SETUPS = {
  none: async () => ({ ready: true, note: '' }),
  settler: async ({ page, area }) => {
    const ready = await selectOneSettler(page, area);
    return { ready, note: ready ? '' : 'no settler took a click' };
  },
  'settler-world': async (context) => ({
    ...(await SETUPS.settler(context)),
    pointer: worldCentre(context.viewport),
  }),
  building: async ({ page, area }) => {
    const ready = await selectOneBuilding(page, area);
    return { ready, note: ready ? '' : 'no building took a click' };
  },
  'building-world': async (context) => ({
    ...(await SETUPS.building(context)),
    pointer: worldCentre(context.viewport),
  }),
  residents: ({ page }) => openByKey(page, 'F2'),
  mission: ({ page }) => openByKey(page, 'F1'),
  diplomacy: ({ page }) => openByKey(page, 'F5'),
  build: ({ page }) => openByKey(page, 'KeyB'),
  'build-tabs': ({ page }) => switchBuildTabs(page),
  // A restored game starts with an empty column; a few minutes of game time fill it as a player's does.
  notices: async ({ page }) => {
    await page.evaluate(async (speed) => {
      const d = window.__opennorthland;
      d.setSpeed(speed);
      await d.setPaused(false);
    }, NOTICE_FILL_SPEED);
    await page
      .waitForFunction(
        (cards) => document.querySelectorAll('.on-hud .on-notice').length >= cards,
        NOTICE_FILL_CARDS,
        { timeout: NOTICE_FILL_TIMEOUT_MS },
      )
      .catch(() => undefined);
    await page.evaluate(() => window.__opennorthland.setPaused(true));
    const shown = await page.evaluate(() => ({
      cards: document.querySelectorAll('.on-hud .on-notice').length,
      stacks: document.querySelectorAll('.on-hud .on-notice--stack').length,
    }));
    return { ready: shown.cards > 0, note: `${shown.cards} notice cards, ${shown.stacks} stacks` };
  },
  select50: async ({ page, area }) => {
    await drag(page, area);
    const selected = await page.evaluate(() => window.__frameInputs.selection);
    return { ready: selected >= MANY_SELECTED, note: `${selected} selected` };
  },
  hover: async ({ viewport }) => ({ ready: true, note: '', pointer: worldCentre(viewport) }),
  presses: ({ page, viewport }) => pressButtons(page, restingPointer(viewport)),
  'presses-world': async ({ page, viewport }) => {
    const pointer = worldCentre(viewport);
    return { ...(await pressButtons(page, pointer)), pointer };
  },
  groups: async ({ page, area }) => {
    await drag(page, area);
    const grouped = await page.evaluate(() => window.__frameInputs.selection);
    await page.keyboard.press('Control+Digit1');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(SETTLE_MS);
    return { ready: grouped > 0, note: `${grouped} in group 1` };
  },
};
/** Every scenario measures at the game speed players run at. */
const SCENARIO_SPEED = 3;
/** The notices scenario runs the game at this speed until the column holds this many cards, or gives up
 *  after the timeout and measures what came. */
const NOTICE_FILL_SPEED = 10;
const NOTICE_FILL_CARDS = 7;
const NOTICE_FILL_TIMEOUT_MS = 30000;

const saveText = await readFile(options.checkpoint, 'utf8');
const abCss = options.abCss === null ? null : await readFile(options.abCss, 'utf8');
const { header, stateHash, params } = checkpointSession(JSON.parse(saveText));
await mkdir(output, { recursive: true });
const metadata = {
  startedAt: new Date().toISOString(),
  checkpoint: resolve(options.checkpoint),
  header,
  viewport,
  deviceScale: DEVICE_SCALE,
  seconds,
  seat: options.seat,
  trace: options.trace,
  profile: options.profile,
  abCss: options.abCss,
  headed: options.headed,
  os: {
    platform: platform(),
    release: release(),
    cpus: cpus().map((c) => ({ model: c.model, speed: c.speed })),
    loadAtStart: loadavg(),
  },
  limitations: [
    'Counts (layouts, style recalcs, DOM mutations, layer paints) are per rendered frame and robust to load; durations are not, so read them only from a locked, idle run.',
    'The trace and the CPU profile run after the counting window, so their frames are other frames of the same scenario; profiled durations include the profiler.',
  ],
  scenarios: [],
  errors: [],
};
const progress = (message) => {
  metadata.lastProgress = { at: new Date().toISOString(), message };
  console.log(`bench:hud ${message}`);
};
const writeReport = async () => {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(metadata, null, 2));
  const load = machineLoad();
  const head = [
    `# bench:hud ${header.mapId} tick ${header.tick}`,
    '',
    `Browser: ${metadata.browser?.version ?? 'not started'}, ${metadata.browser?.cdp ? `over CDP at ${metadata.browser.cdp}` : options.headed ? 'headed' : 'headless'}.`,
    `${viewport.width}x${viewport.height} at device scale ${DEVICE_SCALE}, UI scale ${metadata.hudScale ?? '-'}, x${SCENARIO_SPEED}, seat ${options.seat}; ${seconds} s per scenario; one-minute load per CPU now ${load.available ? load.loadPerCpu.toFixed(1) : 'unavailable'}.`,
    '',
    markdownTable(metadata.scenarios),
    '',
  ];
  await writeFile(resolve(output, 'report.md'), head.join('\n'));
};

/** Count DOM mutations from now on, by kind and by the HUD class they land on. */
function watchMutations(page) {
  return page.evaluate(() => {
    const counts = { records: 0, byKey: {} };
    const label = (node) => {
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      for (let e = element; e !== null; e = e.parentElement) {
        const named = [...e.classList].find((name) => name.startsWith('on-'));
        if (named !== undefined) return named;
      }
      return element?.tagName.toLowerCase() ?? '?';
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        counts.records++;
        const key = `${record.type}${record.attributeName ? `[${record.attributeName}]` : ''} ${label(record.target)}`;
        counts.byKey[key] = (counts.byKey[key] ?? 0) + 1;
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    window.__hudMutations = { counts, observer };
  });
}

/** Start counting rendered frames and hidden time; returns once the counter runs. */
function startFrameCount(page) {
  return page.evaluate(() => {
    const probe = { frames: 0, intervals: [], last: null, hidden: document.hidden, stop: false };
    window.__hudFrames = probe;
    const frame = (now) => {
      if (probe.stop) return;
      window.__measurementGuard.check();
      if (probe.last !== null) probe.intervals.push(now - probe.last);
      probe.last = now;
      probe.frames++;
      probe.hidden ||= document.hidden;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

function stopFrameCount(page) {
  return page.evaluate(() => {
    const probe = window.__hudFrames;
    probe.stop = true;
    const sorted = [...probe.intervals].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? null;
    return {
      frames: probe.frames,
      rafP50: at(0.5),
      rafP95: at(0.95),
      rafP99: at(0.99),
      rafMax: sorted.at(-1) ?? null,
      hidden: probe.hidden || document.hidden,
      drift: window.__measurementGuard.drift,
    };
  });
}

/** The page's composited layers, kept current from `LayerTree.layerTreeDidChange`; `restart` after a
 *  navigation, which leaves the domain reporting the old document. */
async function layerWatch(cdp) {
  const watch = {
    layers: [],
    restart: async () => {
      watch.layers = [];
      await cdp.send('LayerTree.disable');
      await cdp.send('LayerTree.enable');
    },
  };
  cdp.on('LayerTree.layerTreeDidChange', ({ layers }) => {
    if (layers !== undefined) watch.layers = layers;
  });
  await cdp.send('LayerTree.enable');
  return watch;
}

/** Name a layer's DOM owner by its tag and `on-` class, so the report says which panel a layer is. */
async function nameLayers(cdp, layers) {
  const named = [];
  for (const layer of layers) {
    let owner = null;
    if (layer.backendNodeId !== undefined) {
      try {
        const { node } = await cdp.send('DOM.describeNode', { backendNodeId: layer.backendNodeId });
        const classes = (node.attributes ?? [])
          .reduce((found, value, index, list) => (list[index - 1] === 'class' ? value : found), '')
          .split(' ')
          .filter((name) => name.length > 0)
          .slice(0, 2)
          .join('.');
        owner = `${node.localName || node.nodeName}${classes ? `.${classes}` : ''}`;
      } catch {
        owner = 'detached';
      }
    }
    let reasons = [];
    try {
      reasons = (await cdp.send('LayerTree.compositingReasons', { layerId: layer.layerId }))
        .compositingReasonIds;
    } catch {
      reasons = [];
    }
    named.push({ ...layer, owner, reasons });
  }
  return named;
}

/** Rounds of an interleaved A/B, each tracing A and B once, ordered ABBA so drift falls on both sides. */
const AB_ROUNDS = 4;
/** The style change lands and the compositor settles on its new layers within this. */
const AB_SETTLE_MS = 500;
/** Each side's untraced window, read for frame pacing and the app's frame cost. */
const AB_WINDOW_MS = 2000;
const MS_PER_SECOND = 1000;

/**
 * Trace the scenario alternately without (A) and with (B) the stylesheet `css` added to the page, so a
 * pure style change is measured interleaved in one session on the same frames' content.
 */
async function cssAB(page, cdp, browserCdp, css) {
  const sides = { A: [], B: [] };
  for (let round = 0; round < AB_ROUNDS; round++) {
    for (const side of round % 2 === 0 ? ['A', 'B'] : ['B', 'A']) {
      await page.evaluate(
        ({ text, on }) => {
          let style = document.getElementById('bench-hud-ab');
          if (on && style === null) {
            style = document.createElement('style');
            style.id = 'bench-hud-ab';
            style.textContent = text;
            document.head.append(style);
          } else if (!on) style?.remove();
        },
        { text: css, on: side === 'B' },
      );
      await page.waitForTimeout(AB_SETTLE_MS);
      // Untraced first: frame pacing and the app's own frame cost without the tracer's overhead.
      const before = (await cdp.send('Performance.getMetrics')).metrics;
      await page.evaluate(() => window.__opennorthland.resetPerf());
      await startFrameCount(page);
      await page.waitForTimeout(AB_WINDOW_MS);
      const frames = await stopFrameCount(page);
      const after = (await cdp.send('Performance.getMetrics')).metrics;
      const perfWindow = await page.evaluate(async () => (await window.__opennorthland.perf()).window);
      const trace = await captureTrace(browserCdp, page);
      sides[side].push({
        trace: foldTrace(trace.events, trace.frames),
        metrics: {
          ...metricDeltas(before, after, frames.frames),
          fps: frames.frames / (AB_WINDOW_MS / MS_PER_SECOND),
          rafP50: frames.rafP50,
          rafP95: frames.rafP95,
          rafP99: frames.rafP99,
          rafMax: frames.rafMax,
          appCpuMsPerFrame: perfWindow.cpuMsPerFrame,
          appDrawMsPerFrame: perfWindow.drawMsPerFrame,
        },
      });
    }
  }
  await page.evaluate(() => document.getElementById('bench-hud-ab')?.remove());
  return { A: meanOfWindows(sides.A), B: meanOfWindows(sides.B) };
}

async function captureTrace(browserCdp, page) {
  const chunks = [];
  browserCdp.on('Tracing.dataCollected', ({ value }) => chunks.push(...value));
  const done = new Promise((resolveDone) => browserCdp.once('Tracing.tracingComplete', resolveDone));
  await browserCdp.send('Tracing.start', {
    traceConfig: {
      includedCategories: options.invalidations
        ? [...TRACE_CATEGORIES, INVALIDATION_CATEGORY, 'disabled-by-default-devtools.timeline.stack']
        : TRACE_CATEGORIES,
      recordMode: 'recordAsMuchAsPossible',
    },
    transferMode: 'ReportEvents',
  });
  await startFrameCount(page);
  await page.waitForTimeout(TRACE_SECONDS * 1000);
  const frames = await stopFrameCount(page);
  await browserCdp.send('Tracing.end');
  await done;
  browserCdp.removeAllListeners('Tracing.dataCollected');
  return { events: chunks, frames: frames.frames };
}

/** How often the animation census samples: `getAnimations` brings style up to date, so it runs apart
 *  from the counting window and at a low rate. */
const ANIMATION_SAMPLE_MS = 100;
const ANIMATION_SAMPLES = 30;

/** The share of samples each running CSS animation or transition was found playing, by name and target. */
function animationCensus(page) {
  return page.evaluate(
    async ({ sampleMs, samples }) => {
      const seen = {};
      for (let i = 0; i < samples; i++) {
        for (const animation of document.getAnimations()) {
          if (animation.playState !== 'running') continue;
          const target = animation.effect?.target;
          const named = target ? [...target.classList].filter((c) => c.startsWith('on-')).join('.') : '?';
          const kind = animation.animationName ?? `transition ${animation.transitionProperty}`;
          const key = `${kind} ${named}`;
          seen[key] = (seen[key] ?? 0) + 1 / samples;
        }
        await new Promise((done) => setTimeout(done, sampleMs));
      }
      return seen;
    },
    { sampleMs: ANIMATION_SAMPLE_MS, samples: ANIMATION_SAMPLES },
  );
}

async function captureProfile(cdp, page) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: PROFILE_INTERVAL_US });
  await cdp.send('Profiler.start');
  await startFrameCount(page);
  await page.waitForTimeout(seconds * 1000);
  const frames = await stopFrameCount(page);
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable');
  return { profile, frames: frames.frames };
}

async function measure(page, cdp, layers) {
  const loadAtStart = machineLoad();
  const hudNodes = await page.evaluate(
    () => document.querySelector('.on-hud')?.querySelectorAll('*').length ?? 0,
  );
  await watchMutations(page);
  const layersBefore = layers.layers;
  const before = (await cdp.send('Performance.getMetrics')).metrics;
  await page.evaluate(() => window.__opennorthland.resetPerf());
  await startFrameCount(page);
  await page.waitForTimeout(seconds * 1000);
  const frames = await stopFrameCount(page);
  const after = (await cdp.send('Performance.getMetrics')).metrics;
  const layersAfter = layers.layers;
  const inPage = await page.evaluate(async () => {
    const { counts, observer } = window.__hudMutations;
    observer.disconnect();
    const perf = await window.__opennorthland.perf();
    return {
      mutations: counts,
      perfWindow: perf.window,
      insets: window.__frameInputs.insets,
      selection: window.__frameInputs.selection,
      tick: window.__opennorthland.host.tick,
    };
  });
  const loadAtEnd = machineLoad();
  const invalid = [];
  if (overloaded(loadAtStart, loadAtEnd)) invalid.push('load');
  if (frames.hidden) invalid.push('hidden');
  if (frames.drift) invalid.push('camera drift');
  return {
    frames,
    hudNodes,
    metrics: metricDeltas(before, after, frames.frames),
    layers: foldLayers(await nameLayers(cdp, layersAfter), layersBefore, frames.frames),
    ...inPage,
    loadAtStart,
    loadAtEnd,
    invalid,
  };
}

let browser;
let page;
try {
  const previewUrl = new URL(`?${params}`, options.origin);
  progress('verifying development server and content');
  metadata.preview = await verifyDevServer(previewUrl);
  // The full browser's headless mode keeps the GPU; Playwright's default headless shell draws WebGL in
  // software at about one frame a second.
  browser = await openBenchBrowser({
    headless: !options.headed,
    ...(options.headed ? {} : { channel: HEADLESS_CHANNEL }),
  });
  const browserCdp = await browser.newBrowserCDPSession();
  metadata.browser = benchBrowserInfo(browser);
  page = await openBenchPage(browser);
  page.on('pageerror', (e) => metadata.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') metadata.errors.push(m.text());
  });
  await page.goto(options.origin.origin);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('DOM.enable');
  const layers = await layerWatch(cdp);
  let dense = null;
  for (const scenario of options.scenarios) {
    progress(`restoring for ${scenario.id}`);
    const settings = hudSettings(scenario);
    await restoreCheckpoint(page, { saveText, header, stateHash, url: previewUrl.href, settings });
    await layers.restart();
    metadata.audio = (await unlockAudio(page)) ? 'audible' : 'no sound bank';
    await page.evaluate((s) => window.__opennorthland.watchSeat(s), options.seat);
    // The watched seat's own cluster: another seat's lies in its fog, where nothing takes a click.
    if (dense === null) dense = (await densestBuildings(page, options.seat)).point;
    await watchFrameInputs(page);
    const camera = cameraAt(dense, scenario.zoom, viewport);
    await page.evaluate((c) => {
      const d = window.__opennorthland;
      d.cameraCtl.setSuspended(true);
      d.cameraCtl.jumpTo(c);
    }, camera);
    await page.waitForTimeout(SETTLE_MS);
    // The session pins the HUD scale (checkpointSession), read back so the world area and the report
    // follow what the page drew.
    metadata.hudScale = await page.evaluate(() =>
      Number(getComputedStyle(document.querySelector('.on-hud')).getPropertyValue('--hud-scale')),
    );
    const context = { page, dense, viewport, area: worldArea(viewport, metadata.hudScale), camera };
    const setup = await SETUPS[scenario.setup](context);
    const pointer = setup.pointer ?? restingPointer(viewport);
    await page.mouse.move(pointer.x, pointer.y);
    await guardCamera(page, camera);
    await page.evaluate(async (speed) => {
      const d = window.__opennorthland;
      d.setSpeed(speed);
      await d.setPaused(false);
    }, SCENARIO_SPEED);
    await page.waitForTimeout(WARM_MS);
    progress(`measuring ${scenario.id} for ${seconds}s`);
    const run = await measure(page, cdp, layers);
    if (!setup.ready) run.invalid.push(`setup: ${setup.note}`);
    await page.screenshot({ path: resolve(output, `${scenario.id}.png`) });
    if (options.trace) {
      progress(`tracing ${scenario.id} for ${TRACE_SECONDS}s`);
      const trace = await captureTrace(browserCdp, page);
      // The whole trace opens in Perfetto or the DevTools performance panel.
      if (options.keepTraces)
        await writeFile(
          resolve(output, `${scenario.id}.trace.json`),
          JSON.stringify({ traceEvents: trace.events }),
        );
      run.trace = foldTrace(trace.events, trace.frames);
      if (options.invalidations) {
        run.invalidations = foldInvalidations(trace.events, trace.frames);
        run.animations = await animationCensus(page);
      }
    }
    if (abCss !== null) {
      progress(`A/B of ${options.abCss} on ${scenario.id}`);
      run.ab = await cssAB(page, cdp, browserCdp, abCss);
    }
    if (options.profile) {
      progress(`profiling ${scenario.id} for ${seconds}s`);
      const { profile, frames } = await captureProfile(cdp, page);
      await writeFile(resolve(output, `${scenario.id}.cpuprofile`), JSON.stringify(profile));
      run.cpu = foldCpuProfile(profile, frames);
    }
    metadata.scenarios.push({ ...scenario, setupNote: setup.note, ...run });
    progress(
      `${scenario.id}: ${run.metrics.layoutsPerFrame.toFixed(2)} layouts, ${run.metrics.styleRecalcsPerFrame.toFixed(2)} recalcs, ${(run.mutations.records / Math.max(1, run.frames.frames)).toFixed(1)} mutations per frame${run.invalid.length > 0 ? `, void: ${run.invalid}` : ''}`,
    );
    await writeReport();
  }
  if (metadata.errors.length > 0) throw new Error(`${metadata.errors.length} browser errors`);
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
  console.error(`bench:hud ${error.message}`);
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
