// One boot of the production `?map=` entry in its own Chromium process, measured from navigation to
// drawn frames. Readiness is the app's own signal: `startGameView` installs `window.__opennorthland`
// and `boot.finish()` then removes the `.boot-card` loading overlay; a `.boot-notice` on the same
// backdrop is a boot the app gave up on.

const VIEWPORT = { width: 1280, height: 720 };
const POLL_MS = 250;
/** Frames the world must draw after the loading screen is gone. */
const MIN_FRAMES_AFTER_BOOT = 3;
const LAUNCH_TIMEOUT_MS = 60_000;
/** Covers the renderer probe, the pixel probe, the failure screenshot and closing the page. */
const PAGE_CALL_TIMEOUT_MS = 15_000;
/** A centred square of the world, clear of the HUD bars at the screen edges. */
const PIXEL_PROBE_PX = 256;
/** Every few pixels of the probe square are sampled; a drawn world shows far more colours than this. */
const PIXEL_PROBE_STRIDE = 4;
const MIN_DISTINCT_COLOURS = 8;
const BOOT_PHASE_LINE = /^\[boot\] phase \{phase: (\w+)\}/;

export function bootQuery(mapId, seed) {
  // `intro=off` keeps the briefing window off the pixel probe; `fullscreen=off` stores nothing.
  return `map=${mapId}&player=0&seed=${seed}&sound=off&intro=off&fullscreen=off`;
}

class DeadlineError extends Error {}

/** Playwright's own timeouts stop firing once a busy GPU process blocks the renderer, so every wait on
 *  the page is raced against a timer here. */
function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(`${what} did not answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The unmasked WebGL renderer of a fresh context, which uses the browser's one ANGLE backend. */
function readRenderer(page) {
  return withTimeout(
    page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (gl === null) return 'no WebGL2 context';
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return String(renderer);
    }),
    PAGE_CALL_TIMEOUT_MS,
    'the renderer probe',
  );
}

function readFrames(page, timeoutMs) {
  return withTimeout(
    page.evaluate(async () => {
      const handle = window.__opennorthland;
      if (handle === undefined) return null;
      const report = await handle.perf();
      return { frames: report.window.frames, drawn: report.drawn };
    }),
    timeoutMs,
    'the perf report',
  );
}

async function distinctColours(page) {
  const clip = {
    x: (VIEWPORT.width - PIXEL_PROBE_PX) / 2,
    y: (VIEWPORT.height - PIXEL_PROBE_PX) / 2,
    width: PIXEL_PROBE_PX,
    height: PIXEL_PROBE_PX,
  };
  const png = await withTimeout(
    page.screenshot({ clip }),
    PAGE_CALL_TIMEOUT_MS,
    'the pixel probe screenshot',
  );
  return withTimeout(
    page.evaluate(
      async ({ base64, stride }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, image.width, image.height);
        const seen = new Set();
        for (let i = 0; i < data.length; i += 4 * stride)
          seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
        return seen.size;
      },
      { base64: png.toString('base64'), stride: PIXEL_PROBE_STRIDE },
    ),
    PAGE_CALL_TIMEOUT_MS,
    'the pixel probe',
  );
}

/** Navigates and waits for the drawn game, filling `result` as it goes; throws on a stall. */
async function bootPage(page, result, { origin, mapId, seed, timeoutMs, matchesBackend, since }) {
  const remaining = () => timeoutMs - since();
  await page.goto(`${origin}/?${bootQuery(mapId, seed)}`, { waitUntil: 'commit' });
  await page.waitForFunction(
    () =>
      document.querySelector('.boot-notice') !== null ||
      (window.__opennorthland !== undefined && document.querySelector('.boot-card') === null),
    undefined,
    { polling: POLL_MS, timeout: 0 },
  );
  const notice = await page
    .locator('.boot-notice')
    .first()
    .textContent({ timeout: POLL_MS })
    .catch(() => null);
  if (notice !== null) throw new Error(`the app stopped on its boot notice: ${notice.trim()}`);
  result.readyMs = since();

  const atReady = await readFrames(page, remaining());
  if (atReady === null) throw new Error('the debug handle vanished after boot');
  let latest = atReady;
  // Kept on the result as it goes, so a boot that stalls here still reports what it drew.
  const record = (frames) => {
    result.frames = frames.frames;
    result.drawn = frames.drawn;
  };
  record(atReady);
  while (latest.frames - atReady.frames < MIN_FRAMES_AFTER_BOOT) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    latest = (await readFrames(page, remaining())) ?? latest;
    record(latest);
  }
  result.renderer = await readRenderer(page);
  result.colours = await distinctColours(page);

  if (!matchesBackend(result.renderer)) return 'the game ran on another renderer than the one requested';
  if (latest.drawn === 0) return 'the world renderer drew no sprite';
  if (result.colours < MIN_DISTINCT_COLOURS)
    return `the screen centre shows ${result.colours} colours, a blank canvas`;
  return null;
}

/**
 * Launches Chromium with `args`, boots `mapId` and reports what happened; `failure` is null for a
 * counted run. A fresh browser per boot keeps a wedged GPU process from deciding the next map, and
 * runs every boot with cold shader caches, as on a player's first start.
 */
export async function bootMap({
  chromium,
  launch,
  origin,
  mapId,
  seed,
  timeoutMs,
  matchesBackend,
  screenshotPath,
}) {
  const result = {
    mapId,
    launchedRenderer: null,
    renderer: null,
    phases: [],
    readyMs: null,
    frames: null,
    drawn: null,
    colours: null,
    errors: [],
    failure: null,
    screenshot: null,
  };
  const server = await chromium.launchServer({ ...launch, timeout: LAUNCH_TIMEOUT_MS });
  try {
    const browser = await chromium.connect(server.wsEndpoint());
    let page;
    try {
      const blank = await browser.newPage();
      result.launchedRenderer = await readRenderer(blank);
      await withTimeout(blank.close(), PAGE_CALL_TIMEOUT_MS, 'closing the probe page');
      if (!matchesBackend(result.launchedRenderer)) {
        result.failure = 'Chromium did not start this backend; not counted';
        return result;
      }
      page = await withTimeout(
        browser.newContext({ viewport: VIEWPORT }).then((context) => context.newPage()),
        PAGE_CALL_TIMEOUT_MS,
        'opening the game page',
      );
    } catch (error) {
      // Before the game page exists there is no boot to report on, only a browser that did not answer.
      result.failure = error instanceof Error ? error.message.split('\n')[0] : String(error);
      return result;
    }
    const start = Date.now();
    const since = () => Date.now() - start;
    page.on('console', (message) => {
      const phase = BOOT_PHASE_LINE.exec(message.text());
      if (phase !== null) result.phases.push({ phase: phase[1], ms: since() });
      else if (message.type() === 'error') result.errors.push(message.text());
    });
    page.on('pageerror', (error) => result.errors.push(String(error)));
    page.on('crash', () => result.errors.push('the page crashed'));
    try {
      const failure = await withTimeout(
        bootPage(page, result, { origin, mapId, seed, timeoutMs, matchesBackend, since }),
        timeoutMs,
        'the boot',
      );
      result.failure =
        failure ?? (result.errors.length > 0 ? `${result.errors.length} page or console errors` : null);
    } catch (error) {
      const lastPhase = result.phases.at(-1)?.phase ?? 'none';
      const reason =
        error instanceof DeadlineError
          ? result.readyMs === null
            ? `still loading after ${timeoutMs} ms`
            : `fewer than ${MIN_FRAMES_AFTER_BOOT} frames after the loading screen closed`
          : error instanceof Error
            ? error.message.split('\n')[0]
            : String(error);
      result.failure = `${reason} (last phase: ${lastPhase})`;
    }
    if (result.failure !== null) {
      // A wedged GPU process cannot composite either; then there is no screenshot to take.
      result.screenshot = await withTimeout(
        page.screenshot({ path: screenshotPath }).then(() => screenshotPath),
        PAGE_CALL_TIMEOUT_MS,
        'the failure screenshot',
      ).catch(() => null);
    }
  } finally {
    await server.kill();
  }
  return result;
}
