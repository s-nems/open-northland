import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import type { OpenNorthlandDebug } from '../../../src/view/runtime/debug-handle.js';
import { contentDir } from '../../content/helpers.js';
import { type EngineWorkload, hashGrid } from './workloads.js';

/** Boots the app in one JavaScript engine and reads its state hashes on a workload's tick grid. */

/** The part of the app's debug handle this harness drives, read inside the page. */
type SimHandle = Pick<OpenNorthlandDebug, 'sim' | 'setPaused'>;

export type EngineId = 'chromium' | 'electron' | 'firefox' | 'webkit';

export interface EngineTarget {
  readonly id: EngineId;
  /** A gate engine must match Node. The others are measured and reported. */
  readonly gate: boolean;
}

/** Electron and Chromium ship the game; WebKit and Firefox only decide how wide the web client can go. */
export const ENGINE_TARGETS: readonly EngineTarget[] = [
  { id: 'electron', gate: true },
  { id: 'chromium', gate: true },
  { id: 'webkit', gate: false },
  { id: 'firefox', gate: false },
];

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '../../..');
const REPO_CONTENT = resolve(APP_ROOT, '../../content');
const ELECTRON_MAIN = resolve(HERE, 'electron-main.cjs');
const VIEWPORT = { width: 1000, height: 600 };
const BOOT_TIMEOUT_MS = 120_000;

export interface AppServer {
  readonly origin: string;
  readonly close: () => Promise<void>;
}

/** The app's own Vite dev server on a free port, so every engine loads one build with content routes. */
export async function startAppServer(): Promise<AppServer> {
  // The dev server serves the checkout's `content/` alone, while the Node reference honours
  // `ON_CONTENT_DIR`; a differing override would compare two content sets and report it as an engine.
  if (contentDir() !== REPO_CONTENT) {
    throw new Error(`ON_CONTENT_DIR is not supported by test:engines: the app serves ${REPO_CONTENT}`);
  }
  const { createServer } = await import('vite');
  // localhost can resolve to another checkout's IPv4/IPv6 listener on the same port.
  const server = await createServer({
    root: APP_ROOT,
    server: { host: '127.0.0.1', port: 0, open: false },
    logLevel: 'warn',
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('the app dev server reported no TCP port');
  }
  return { origin: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}

export interface EngineSession {
  readonly page: Page;
  /** Page errors and console errors since the page opened, oldest first. */
  readonly errors: readonly string[];
  readonly close: () => Promise<void>;
}

/** Thrown when the engine itself is absent, which is a report line rather than a failure. */
export class EngineUnavailableError extends Error {}

export async function openEngine(engine: EngineId, url: string): Promise<EngineSession> {
  if (engine === 'electron') return openElectron(url);
  const playwright = await import('playwright');
  const browserType = playwright[engine];
  if (!installed(() => browserType.executablePath())) {
    throw new EngineUnavailableError(`${engine} is not installed; run: npx playwright install ${engine}`);
  }
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = watchErrors(page);
  await page.goto(url, { waitUntil: 'load' });
  return { page, errors, close: () => browser.close() };
}

/** `executablePath()` throws for a browser this platform cannot run at all. */
function installed(executablePath: () => string): boolean {
  try {
    return existsSync(executablePath());
  } catch {
    return false;
  }
}

async function openElectron(url: string): Promise<EngineSession> {
  const { _electron } = await import('playwright');
  const profile = await mkdtemp(join(tmpdir(), 'northland-engine-'));
  const removeProfile = () => rm(profile, { recursive: true, force: true });
  const app = await _electron
    .launch({ args: [ELECTRON_MAIN, `--profile=${profile}`] })
    .catch(async (err: unknown) => {
      await removeProfile();
      throw new EngineUnavailableError(`electron did not launch: ${String(err)}`);
    });
  const close = async (): Promise<void> => {
    try {
      await app.close();
    } finally {
      await removeProfile();
    }
  };
  try {
    const page = await app.firstWindow();
    const errors = watchErrors(page);
    await page.goto(url, { waitUntil: 'load' });
    return { page, errors, close };
  } catch (err) {
    await close();
    throw err;
  }
}

function watchErrors(page: Page): readonly string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

export interface HashRun {
  /** The tick the run was pinned at before the first compared tick. */
  readonly startTick: number;
  readonly hashes: ReadonlyMap<number, string>;
}

/**
 * Pause the booted session and read its hash at every grid tick. The frame loop steps on wall-clock
 * time, so only a paused session hashes exactly the tick asked for.
 */
export async function collectEngineHashes(
  session: EngineSession,
  workload: EngineWorkload,
): Promise<HashRun> {
  const { page, errors } = session;
  const startTick = await pauseAt(page, errors);
  const hashes = new Map<number, string>();
  for (const tick of hashGrid(startTick, workload)) {
    hashes.set(tick, await hashAt(page, tick));
  }
  if (errors.length > 0) throw new Error(`the page reported errors:\n  ${errors.join('\n  ')}`);
  return { startTick, hashes };
}

async function pauseAt(page: Page, errors: readonly string[]): Promise<number> {
  try {
    await page.waitForFunction(() => window.__opennorthland !== undefined, undefined, {
      timeout: BOOT_TIMEOUT_MS,
    });
  } catch (err) {
    if (errors.length > 0)
      throw new Error(`the page errored before the game started:\n  ${errors.join('\n  ')}`);
    throw err;
  }
  return page.evaluate(() => {
    const debug: SimHandle | undefined = window.__opennorthland;
    if (debug === undefined) throw new Error('the game view installed no debug handle');
    debug.setPaused(true);
    return debug.sim.tick;
  });
}

async function hashAt(page: Page, tick: number): Promise<string> {
  const result = await page.evaluate((target) => {
    const debug: SimHandle | undefined = window.__opennorthland;
    if (debug === undefined) throw new Error('the game view installed no debug handle');
    debug.sim.run(target - debug.sim.tick);
    return { tick: debug.sim.tick, hash: debug.sim.hashState() };
  }, tick);
  if (result.tick !== tick) {
    throw new Error(`the session ran past tick ${tick} on its own and reached ${result.tick}`);
  }
  return result.hash;
}

/** The Node reference over the same grid, from the world its own builder produces. */
export async function collectNodeHashes(workload: EngineWorkload): Promise<HashRun> {
  const sim = await workload.build();
  const startTick = sim.tick;
  const hashes = new Map<number, string>();
  for (const tick of hashGrid(startTick, workload)) {
    sim.run(tick - sim.tick);
    hashes.set(tick, sim.hashState());
  }
  return { startTick, hashes };
}
