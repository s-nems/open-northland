import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  benchBrowserInfo,
  cameraAt,
  checkpointSession,
  densestBuildings,
  nearestCoast,
  openBenchBrowser,
  openBenchPage,
  restoreCheckpoint,
  VIEWPORT,
  verifyDevServer,
} from '../../browser/session.mjs';
import {
  markdownTable,
  parseSettingsBenchArgs,
  rowId,
  sessionSettings,
  summarizeCycles,
} from './gpu-settings-plan.mjs';

/**
 * Each graphics setting's GPU milliseconds per frame, on against off in a paused, GPU-bound redraw loop
 * of one restored `bench:map` checkpoint. See docs/PERFORMANCE.md#per-setting-gpu-cost.
 */

const options = parseSettingsBenchArgs(process.argv.slice(2), process.env);
/** Bakes, caches and the shore waves' lift map settle while the view runs this long at x3. */
const WARM_RUN_MS = 10000;
const WARM_SPEED = 3;
const PAUSE_SETTLE_MS = 1500;
/** Real frames between a state change and its timing, so bakes and uploads the change asks for land. */
const SETTLE_FRAMES = 30;
/** Redraws before a state's timing starts, unmeasured. */
const PRIMING_FRAMES = 15;
/** Redraws per timed state; the span over them is the state's milliseconds per frame. */
const TIMED_FRAMES = 60;
/** A paused water clock still steps the shore waves at the base tick rate: 12 a second, every fifth
 *  frame at the default 60 fps cap, so the loop redraws their lift map as often. */
const WAVE_STEP_FRAMES = 5;
/** A prescaled art filter redraws the pages in view over the following frames; its state waits this long. */
const PRESCALE_SETTLE_MS = 60000;
const PRESCALE_POLL_MS = 100;

const saveText = await readFile(options.checkpoint, 'utf8');
const { header, stateHash, params } = checkpointSession(JSON.parse(saveText));
await mkdir(options.output, { recursive: true });
const metadata = {
  startedAt: new Date().toISOString(),
  checkpoint: resolve(options.checkpoint),
  header,
  viewport: VIEWPORT,
  cycles: options.cycles,
  rows: [],
  errors: [],
};
const progress = (message) => console.log(`bench:gpu-settings ${message}`);
const writeReport = async () => {
  await writeFile(resolve(options.output, 'report.json'), JSON.stringify(metadata, null, 2));
  const head = [
    `# bench:gpu-settings ${header.mapId} tick ${header.tick}`,
    '',
    `Adapter: ${metadata.adapter ?? 'unknown'}.`,
    `Browser: ${metadata.browser?.version ?? 'not started'}${metadata.browser?.cdp ? ` over CDP at ${metadata.browser.cdp}` : ''}.`,
    `${VIEWPORT.width}x${VIEWPORT.height}, ${options.cycles} cycles of ${TIMED_FRAMES} redraws per state. Cost is on minus off per cycle; on and off are the medians of each state.`,
    '',
    markdownTable(metadata.rows),
    '',
    ...(metadata.coast === undefined
      ? []
      : [`The coast view holds ${metadata.coast.inView} of the map's ${metadata.coast.waves} shore waves.`]),
  ];
  await writeFile(resolve(options.output, 'report.md'), head.join('\n'));
};

/**
 * Install the loop in the page. A redraw replays what the world renderer's frame draws on the GPU after
 * its CPU work: the scene light's light map, the shore waves' lift map every {@link WAVE_STEP_FRAMES},
 * the world into its texture while it composites, then the stage. The light and waves replay the
 * arguments of the last real frame, so a state set before the settle frames is the one redrawn.
 */
function installLoop(page) {
  return page.evaluate((waveStepFrames) => {
    // Private renderer fields, reached for this measurement only.
    const renderer = window.__opennorthland.renderer;
    const { sceneLight, groundWaves, offscreen, chrome } = renderer;
    const gl = renderer.app.renderer.gl;
    const realLight = sceneLight.update.bind(sceneLight);
    const realWaves = groundWaves.update.bind(groundWaves);
    let lightFrame = null;
    let waveArgs = null;
    sceneLight.update = (frame) => {
      lightFrame = frame;
      realLight(frame);
    };
    groundWaves.update = (...args) => {
      waveArgs = args;
      realWaves(...args);
    };
    const pixel = new Uint8Array(4);
    const drain = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const redraw = (index) => {
      if (lightFrame !== null) realLight(lightFrame);
      if (waveArgs !== null && index % waveStepFrames === 0) {
        groundWaves.drawnFrom = null;
        realWaves(...waveArgs);
      }
      offscreen.render(sceneLight.composite());
      gl.flush();
    };
    const base = { ...renderer.enhancements };
    const apply = (kind, value) => {
      if (kind === 'enhancements') renderer.setGraphicsEnhancements({ ...base, ...value });
      else if (kind === 'weather') renderer.setWeatherEnabled(value);
      else if (kind === 'vignette') chrome.vignette.visible = value;
    };
    // An uploaded page keeps the sampling of its first upload until its style changes, so a flip the
    // last frame made reaches GL here.
    const syncSampling = () => {
      for (const source of renderer.textureCache.pageSources()) source.style.update();
    };
    const frames = (count) =>
      new Promise((done) => {
        let left = count;
        const step = () => (--left <= 0 ? done() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      });
    window.__settingsBench = {
      apply,
      reset: () => {
        renderer.setGraphicsEnhancements(base);
        renderer.setWeatherEnabled(true);
        if (chrome.vignette !== null) chrome.vignette.visible = true;
      },
      syncSampling,
      frames,
      time: (priming, timed) => {
        for (let i = 0; i < priming; i++) redraw(i);
        drain();
        const started = performance.now();
        for (let i = 0; i < timed; i++) redraw(i);
        const submitted = performance.now();
        drain();
        return { ms: (performance.now() - started) / timed, submitMs: (submitted - started) / timed };
      },
    };
    return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
  }, WAVE_STEP_FRAMES);
}

/** Wait until two consecutive frames found no page waiting for its prescaled twin. */
async function settlePrescale(page) {
  const started = Date.now();
  for (;;) {
    const quiet = await page.evaluate(async () => {
      const renderer = window.__opennorthland.renderer;
      const first = renderer.prescaleStats();
      await window.__settingsBench.frames(1);
      const second = renderer.prescaleStats();
      return first.pending - first.overBudget === 0 && second.pending - second.overBudget === 0;
    });
    if (quiet) return;
    if (Date.now() - started > PRESCALE_SETTLE_MS) throw new Error('Prescaled twins did not settle');
    await page.waitForTimeout(PRESCALE_POLL_MS);
  }
}

async function timeState(page, entry, on) {
  await page.evaluate(
    async ({ kind, value, settle }) => {
      const bench = window.__settingsBench;
      bench.apply(kind, value);
      await bench.frames(settle);
      bench.syncSampling();
      await bench.frames(1);
    },
    { kind: entry.kind, value: on ? entry.on : entry.off, settle: SETTLE_FRAMES },
  );
  if (entry.prescaled && on) await settlePrescale(page);
  return page.evaluate(({ priming, timed }) => window.__settingsBench.time(priming, timed), {
    priming: PRIMING_FRAMES,
    timed: TIMED_FRAMES,
  });
}

/** One uncounted cycle compiles and bakes what the row's states need; counted cycles alternate which
 *  state goes first. */
async function measureRow(page, entry) {
  await timeState(page, entry, true);
  await timeState(page, entry, false);
  const cycles = [];
  for (let cycle = 0; cycle < options.cycles; cycle++) {
    const onFirst = cycle % 2 === 0;
    const first = await timeState(page, entry, onFirst);
    const second = await timeState(page, entry, !onFirst);
    const [on, off] = onFirst ? [first, second] : [second, first];
    cycles.push({ on: on.ms, off: off.ms, onSubmit: on.submitMs, offSubmit: off.submitMs });
  }
  await page.evaluate(() => {
    window.__settingsBench.reset();
    return window.__settingsBench.frames(1);
  });
  return cycles;
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
  let town = null;
  for (const session of options.sessions) {
    progress(`restoring for ${session.id}`);
    const url = new URL(previewUrl);
    for (const [key, value] of Object.entries(session.params)) url.searchParams.set(key, value);
    await restoreCheckpoint(page, {
      saveText,
      header,
      stateHash,
      url: url.href,
      settings: sessionSettings(session),
    });
    town ??= (await densestBuildings(page)).point;
    metadata.adapter = await installLoop(page);
    for (const view of session.views) {
      let point = town;
      if (view.id === 'coast') {
        const coast = await nearestCoast(page, town, view.zoom);
        if (coast === null) throw new Error('The map has no shore waves for the coast view');
        point = coast.point;
        metadata.coast = coast;
      }
      await page.evaluate(
        async ({ camera, speed }) => {
          const d = window.__opennorthland;
          d.cameraCtl.setSuspended(true);
          d.cameraCtl.jumpTo(camera);
          d.setSpeed(speed);
          await d.setPaused(false);
        },
        { camera: cameraAt(point, view.zoom), speed: WARM_SPEED },
      );
      await page.waitForTimeout(WARM_RUN_MS);
      await page.evaluate(() => window.__opennorthland.setPaused(true));
      await page.waitForTimeout(PAUSE_SETTLE_MS);
      const shot = `${session.id}-${view.id}-z${view.zoom}.png`;
      await page.screenshot({ path: resolve(options.output, shot) });
      for (const entry of view.rows) {
        const id = rowId(session, view, entry);
        progress(`measuring ${id}`);
        const cycles = await measureRow(page, entry);
        const summary = summarizeCycles(cycles);
        metadata.rows.push({
          id,
          session: session.id,
          view: view.id,
          zoom: view.zoom,
          toggle: entry.toggle,
          summary,
          cycles,
        });
        progress(
          `${id}: ${summary.costMs.toFixed(2)} ms (${summary.minMs.toFixed(2)} to ${summary.maxMs.toFixed(2)})`,
        );
        await writeReport();
      }
    }
  }
  if (metadata.errors.length > 0) throw new Error(`${metadata.errors.length} browser errors`);
  metadata.completed = true;
} catch (error) {
  metadata.failure = { message: error.message, stack: error.stack };
  console.error(`bench:gpu-settings ${error.message}`);
  process.exitCode = 1;
} finally {
  metadata.finishedAt = new Date().toISOString();
  try {
    await writeReport();
  } finally {
    await browser?.close();
  }
}
