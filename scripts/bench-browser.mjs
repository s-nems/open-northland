import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { loadConfigFromFile } from 'vite';
import { verifyPreview } from '../packages/app/scripts/dev-verify.mjs';
import {
  busyShare,
  countGlCalls,
  guardCamera,
  machineLoad,
  profileBrowser,
  simWorkerChannel,
  throttleCpu,
} from './bench-browser-profile.mjs';
import { repoRoot } from './content-dir.mjs';

const [checkpoint, origin, output = 'bench-out/browser', secondsText = '15'] = process.argv.slice(2);
if (!checkpoint || !origin || process.argv.length > 6)
  throw new Error('usage: npm run bench:browser -- checkpoint origin [output-dir] [window-seconds]');
const seconds = Number(secondsText);
const mode = process.env.ON_BENCH_BROWSER_MODE ?? 'all';
if (!['all', 'baseline', 'profile'].includes(mode))
  throw new Error('ON_BENCH_BROWSER_MODE must be all, baseline or profile');
if (!Number.isFinite(seconds) || seconds < 1) throw new Error('window seconds must be positive');
const throttle = Number(process.env.ON_BENCH_BROWSER_CPU_THROTTLE ?? '1');
if (!Number.isFinite(throttle) || throttle < 1) throw new Error('ON_BENCH_BROWSER_CPU_THROTTLE must be >= 1');
const CAMERA_NAMES = ['dense', 'zoom07', 'zoom05', 'wide', 'empty'];
/** `camera:speed` pairs, e.g. `dense:3,wide:0`; unset runs the full baseline matrix. */
const windowSpec = process.env.ON_BENCH_BROWSER_WINDOWS?.split(',').map((pair) => {
  const [cameraName, speedText] = pair.split(':');
  const speed = Number(speedText);
  if (!CAMERA_NAMES.includes(cameraName) || !Number.isInteger(speed) || speed < 0)
    throw new Error(`ON_BENCH_BROWSER_WINDOWS entry ${pair} is not camera:speed (${CAMERA_NAMES})`);
  return { cameraName, speed };
});
/** A seat the spectator watches, which draws through that seat's fog and fills its HUD figures; unset
 *  watches the whole map. */
const watchedSeat =
  process.env.ON_BENCH_BROWSER_SEAT === undefined ? null : Number(process.env.ON_BENCH_BROWSER_SEAT);
if (watchedSeat !== null && !Number.isInteger(watchedSeat))
  throw new Error('ON_BENCH_BROWSER_SEAT must be a seat');
const profileViews = (process.env.ON_BENCH_BROWSER_PROFILE_VIEWS ?? 'dense,wide').split(',');
/** CPU-profile the sim worker through each baseline window and read its heap after a forced collection. */
const workerProfile = process.env.ON_BENCH_BROWSER_WORKER_PROFILE === '1';
if (!profileViews.every((name) => CAMERA_NAMES.includes(name)))
  throw new Error(`ON_BENCH_BROWSER_PROFILE_VIEWS takes ${CAMERA_NAMES}`);
const saveText = await readFile(checkpoint, 'utf8');
const save = JSON.parse(saveText);
const { header } = save;
const stamp = header?.session;
if (
  !header?.mapId ||
  !Number.isInteger(header.tick) ||
  !Number.isInteger(header.seed) ||
  !Array.isArray(stamp?.aiSeats) ||
  !stamp.aiSeats.every((seat) => Number.isInteger(seat) && seat >= 0 && seat < 16) ||
  typeof stamp.stateHash !== 'string'
)
  throw new Error('Input must be a bench:map checkpoint carrying map, seed, AI seats and stateHash');
const ai =
  stamp.aiSeats.length === 0
    ? ''
    : stamp.aiSeats.length === 1
      ? `${stamp.aiSeats[0]},`
      : stamp.aiSeats.join(',');
const params = new URLSearchParams({
  map: header.mapId,
  player: 'observer',
  ai,
  seed: String(header.seed),
  fog: 'classic',
  zoom: '1',
  uiscale: '1',
  fullscreen: 'off',
});
if (typeof stamp.tribes === 'string' && stamp.tribes !== '') params.set('tribes', stamp.tribes);
for (const key of ['progression', 'needs'])
  if (typeof stamp[key] === 'boolean') params.set(key, stamp[key] ? 'on' : 'off');
const url = new URL(origin);
if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Origin must be an HTTP development server');
const search = `?${params}`;
const previewUrl = new URL(search, url);
await mkdir(output, { recursive: true });
const metadata = {
  startedAt: new Date().toISOString(),
  checkpoint: resolve(checkpoint),
  header,
  scenarioSearch: search,
  viewport: { width: 1440, height: 900 },
  seconds,
  mode,
  watchedSeat,
  cpuThrottle: throttle === 1 ? null : { rate: throttle, page: null, workers: {} },
  os: {
    platform: platform(),
    release: release(),
    cpus: cpus().map((c) => ({ model: c.model, speed: c.speed })),
    loadAtStart: loadavg(),
  },
  limitations: [
    'No CPU calibration or idle-machine certification; compare OS load and repeat condition before interpreting timing.',
    'perf.frame CPU/draw fields are recent EMAs; RAF quantiles cover each whole measurement window.',
    'perf.frame.gpuMs is RAF interval minus app CPU, including idle/vsync/compositor; it is not measured GPU execution.',
    'GPU diagnostic measures the main Pixi stage including world, HUD and weather with CPU sampling active; excludes later inset draws and compositor.',
  ],
  reports: [],
  errors: [],
};
let browser;
let page;
const progress = (message) => {
  metadata.lastProgress = { at: new Date().toISOString(), message };
  console.log(`bench:browser ${message}`);
};
try {
  progress('verifying development server and content');
  const checkout = await realpath(repoRoot);
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    undefined,
    resolve(repoRoot, 'packages/app'),
  );
  if (!loaded) throw new Error('Cannot load this checkout Vite config');
  metadata.preview = await verifyPreview(previewUrl, {
    checkout,
    clientBuild: JSON.parse(loaded.config.define.__CLIENT_BUILD__),
  });
  browser = await chromium.launch({ headless: false, args: ['--mute-audio'] });
  const browserSession = await browser.newBrowserCDPSession();
  const system = await browserSession.send('SystemInfo.getInfo');
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = metadata.errors;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url.origin);
  if (metadata.cpuThrottle !== null) await throttleCpu(page, metadata.cpuThrottle);
  const simWorker = workerProfile ? await simWorkerChannel(page) : null;
  async function restore() {
    progress(`staging checkpoint at tick ${header.tick}`);
    await page.evaluate(async (text) => {
      const { storePendingLoad } = await import('/src/view/runtime/save-load/pending-store.ts');
      await storePendingLoad(new TextEncoder().encode(text), false);
    }, saveText);
    await page.goto(previewUrl.href);
    progress('waiting for restored world and renderer');
    await page.waitForFunction((tick) => window.__opennorthland?.host.tick === tick, save.header.tick, {
      timeout: 180000,
    });
    await page.evaluate(async () => {
      await window.__opennorthland.setPaused(true);
      if (document.fullscreenElement) await document.exitFullscreen();
    });
    const restored = await page.evaluate(() => window.__opennorthland.host.hashState());
    if (restored.tick !== header.tick || restored.hash !== stamp.stateHash)
      throw new Error(`Checkpoint restore mismatch: tick ${restored.tick}, hash ${restored.hash}`);
    progress(`restored tick ${restored.tick}, state hash verified`);
    if (watchedSeat !== null)
      await page.evaluate((seat) => {
        const watch = window.__opennorthland.watchSeat;
        if (watch === null) throw new Error('The session has no seat picker to watch a seat with');
        watch(seat);
      }, watchedSeat);
  }
  await restore();
  metadata.settings = await page.evaluate(async () => {
    const { readStoredSettings } = await import('/src/view/settings-store.ts');
    return readStoredSettings();
  });
  metadata.restoredRules = await page.evaluate(() => {
    const host = window.__opennorthland.host;
    const rules = host
      .snapshot()
      .entities.flatMap((e) =>
        Object.entries(e.components).filter(([name]) =>
          ['WorldRules', 'FogRules', 'ProgressionRules'].includes(name),
        ),
      );
    return { fogMode: host.fogMode(), components: Object.fromEntries(rules) };
  });
  const cameras = await page.evaluate(
    async (modules) => {
      const { ONE } = await import(modules.fixed);
      const { tileToScreen } = await import(modules.projection);
      const entities = window.__opennorthland.host.snapshot().entities;
      const points = entities
        .filter(
          (e) =>
            e.components.Building &&
            e.components.Position &&
            (modules.seat === null || e.components.Owner?.player === modules.seat),
        )
        .map((e) => {
          const p = e.components.Position;
          return tileToScreen(p.x / ONE, p.y / ONE);
        });
      let dense = points[0] ?? { x: 0, y: 0 },
        best = -1;
      for (const p of points) {
        const n = points.filter((q) => Math.abs(q.x - p.x) < 650 && Math.abs(q.y - p.y) < 380).length;
        if (n > best) {
          best = n;
          dense = p;
        }
      }
      const camera = (p, scale) => ({ scale, offsetX: 720 - p.x * scale, offsetY: 450 - p.y * scale });
      return {
        dense: camera(dense, 1),
        zoom07: camera(dense, 0.7),
        zoom05: camera(dense, 0.5),
        wide: camera(dense, 0.35),
        empty: { scale: 1, offsetX: 100000, offsetY: 100000 },
        selectedBuildings: best,
      };
    },
    {
      fixed: `/@fs${resolve(repoRoot, 'packages/sim/src/core/fixed.ts')}`,
      projection: `/@fs${resolve(repoRoot, 'packages/render/src/data/projection/iso.ts')}`,
      seat: watchedSeat,
    },
  );
  const hardware = await page.evaluate(() => {
    const gl = window.__opennorthland.renderer.app.renderer.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
      gpuTimerAvailable: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    };
  });
  metadata.system = system;
  metadata.hardware = hardware;
  metadata.cameras = cameras;
  const reports = metadata.reports;
  async function windowRun(cameraName, speed, suffix = '') {
    progress(`condition ${cameraName} x${speed}${suffix}`);
    await restore();
    await guardCamera(page, cameras[cameraName]);
    await page.evaluate(
      async ({ camera, speed }) => {
        const d = window.__opennorthland;
        d.cameraCtl.jumpTo(camera);
        d.setSpeed(speed || 1);
        await d.setPaused(speed === 0);
      },
      { camera: cameras[cameraName], speed },
    );
    await page.waitForTimeout(5000);
    progress(`measuring ${cameraName} x${speed}${suffix} for ${seconds}s`);
    const loadAtStart = machineLoad();
    await countGlCalls(page);
    await page.evaluate(() => {
      window.__opennorthland.resetPerf();
      window.__rafProbe = {
        samples: [],
        stop: false,
        last: null,
        hidden: document.hidden,
        startMs: performance.now(),
        startTick: window.__opennorthland.host.tick,
      };
      const visibility = () => {
        if (document.hidden) window.__rafProbe.hidden = true;
      };
      document.addEventListener('visibilitychange', visibility);
      window.__rafProbe.cleanup = () => document.removeEventListener('visibilitychange', visibility);
      const tick = (now) => {
        const p = window.__rafProbe;
        if (p.stop) return;
        p.hidden ||= document.hidden;
        window.__measurementGuard.check();
        if (p.last !== null) p.samples.push(now - p.last);
        p.last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (simWorker !== null) {
      await simWorker.send('Profiler.enable');
      await simWorker.send('Profiler.setSamplingInterval', { interval: 200 });
      await simWorker.send('Profiler.start');
    }
    await page.waitForTimeout(seconds * 1000);
    const workerProfiled = simWorker === null ? null : (await simWorker.send('Profiler.stop')).profile;
    const result = await page.evaluate(async () => {
      window.__rafProbe.stop = true;
      window.__rafProbe.cleanup();
      const samples = window.__rafProbe.samples.sort((a, b) => a - b);
      const at = (q) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))];
      return {
        valid:
          !window.__rafProbe.hidden &&
          !document.hidden &&
          samples.length > 0 &&
          !window.__measurementGuard.drift,
        guard: { ...window.__measurementGuard, check: undefined },
        elapsedMs: performance.now() - window.__rafProbe.startMs,
        startTick: window.__rafProbe.startTick,
        endTick: window.__opennorthland.host.tick,
        perf: await window.__opennorthland.perf(),
        gl: window.__glCalls.report(),
        raf: {
          frames: samples.length,
          p50: at(0.5),
          p95: at(0.95),
          p99: at(0.99),
          max: samples.at(-1),
          over30: samples.filter((x) => x > 30).length,
        },
        camera: window.__opennorthland.cameraCtl.camera(),
        fullscreen: !!document.fullscreenElement,
        hidden: document.hidden,
        canvas: {
          width: window.__opennorthland.renderer.app.canvas.width,
          height: window.__opennorthland.renderer.app.canvas.height,
        },
      };
    });
    if (simWorker !== null && workerProfiled !== null) {
      const name = `${cameraName}-x${speed}${suffix}-worker.cpuprofile`;
      await writeFile(resolve(output, name), JSON.stringify(workerProfiled));
      await simWorker.send('HeapProfiler.enable');
      await simWorker.send('HeapProfiler.collectGarbage');
      const heap = await simWorker.send('Runtime.getHeapUsage');
      result.worker = { profile: name, ...busyShare(workerProfiled), heapUsedMb: heap.usedSize / 2 ** 20 };
    }
    const loadAtEnd = machineLoad();
    const invalidSystemLoad = [loadAtStart, loadAtEnd].some(
      (load) => load.available && load.loadPerCpu > 1.5,
    );
    result.valid &&= !invalidSystemLoad;
    reports.push({ cameraName, speed, suffix, loadAtStart, loadAtEnd, invalidSystemLoad, ...result });
    progress(
      `completed ${cameraName} x${speed}${suffix}: valid=${result.valid}, RAF p95=${result.raf.p95?.toFixed(2) ?? 'unavailable'}ms`,
    );
    console.log(
      JSON.stringify({
        cameraName,
        speed,
        suffix,
        valid: result.valid,
        tick: result.perf.tick,
        drawn: result.perf.drawn,
        raf: result.raf,
        delivered: result.perf.throughput.deliveredSpeed,
        simMsPerTick: result.perf.window.simMsPerTick,
        worker: result.worker,
      }),
    );
    await page.screenshot({ path: resolve(output, `${cameraName}-x${speed}${suffix}.png`) });
    await writeFile(resolve(output, 'report.json'), JSON.stringify(metadata, null, 2));
  }
  if (mode !== 'profile' && windowSpec !== undefined) {
    for (const { cameraName, speed } of windowSpec) await windowRun(cameraName, speed);
  } else if (mode !== 'profile') {
    for (const speed of [0, 1, 3, 10]) await windowRun('dense', speed);
    for (const speed of [0, 3, 10]) await windowRun('wide', speed);
    for (const cameraName of ['zoom07', 'zoom05']) await windowRun(cameraName, 3);
    await windowRun('empty', 3);
    await windowRun('dense', 3, '-repeat');
  }
  if (mode !== 'baseline') {
    metadata.diagnostics = {};
    for (const cameraName of profileViews) {
      progress(`starting separate ${cameraName} CPU/GPU and allocation diagnostics`);
      const diagnostic = {};
      metadata.diagnostics[cameraName] = diagnostic;
      await profileBrowser({ page, cameras, restore, seconds, output, metadata: diagnostic, cameraName });
    }
  }
  const invalid =
    metadata.reports.some((report) => !report.valid) ||
    Object.values(metadata.diagnostics ?? {}).some(
      (diagnostic) =>
        !diagnostic.cpuDiagnostic.valid ||
        !diagnostic.allocationDiagnostic.valid ||
        !diagnostic.gpuDiagnostic.valid,
    );
  if (metadata.errors.length || invalid)
    throw new Error(
      `Invalid browser measurement: ${metadata.errors.length} browser errors; invalid window=${invalid}`,
    );
  metadata.completed = true;
} catch (error) {
  metadata.failure = { message: error.message, stack: error.stack };
  if (page && !page.isClosed()) {
    metadata.failure.url = page.url();
    try {
      metadata.failure.browser = await page.evaluate(() => ({
        hidden: document.hidden,
        tick: window.__opennorthland?.host.tick,
        text: document.body.innerText.slice(-4000),
      }));
      await page.screenshot({ path: resolve(output, 'failure.png'), timeout: 10000 });
    } catch (captureError) {
      metadata.failure.captureError = captureError.message;
    }
  }
  process.exitCode = 1;
} finally {
  if (metadata.errors.length) {
    metadata.completed = false;
    process.exitCode = 1;
  }
  metadata.finishedAt = new Date().toISOString();
  metadata.os.loadAtEnd = loadavg();
  try {
    await writeFile(resolve(output, 'report.json'), JSON.stringify(metadata, null, 2));
  } finally {
    await browser?.close();
  }
}
