import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from 'playwright';
import { test } from 'vitest';
import { ORIGINAL_GAME_CHECK_ENV } from '../src/original-game/detect.js';
import { faultsRoot } from '../src/paths.js';
import { WINDOW_STATE_FILE, WINDOW_STATE_VERSION } from '../src/window/state.js';
import { launchShell, MENU, START_URL } from './launch.js';

const POLL_MS = 100;
const POLL_LIMIT_MS = 15_000;
/** `ON_BENCH_WINDOW_POSITION=x,y` opens the window there, on a display nobody works on. */
const WINDOW_POSITION = /^(-?\d+),(-?\d+)$/.exec(process.env.ON_BENCH_WINDOW_POSITION ?? '');
const WINDOW_SIZE = { width: 1100, height: 750 };

async function waitFor<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  const deadline = Date.now() + POLL_LIMIT_MS;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`${what} never happened`);
    await new Promise((settle) => setTimeout(settle, POLL_MS));
  }
}

/** Electron's window calls its page hung this long after a close the page has not finished. */
const ELECTRON_CLOSE_HANG_MS = 5000;
const CLOSE_HANG_MARGIN_MS = 1500;

async function openProfile(prefix: string): Promise<string> {
  const profile = await mkdtemp(join(tmpdir(), prefix));
  if (WINDOW_POSITION !== null) {
    const bounds = { x: Number(WINDOW_POSITION[1]), y: Number(WINDOW_POSITION[2]), ...WINDOW_SIZE };
    const state = { version: WINDOW_STATE_VERSION, fullscreen: false, maximized: false, bounds };
    await writeFile(join(profile, WINDOW_STATE_FILE), JSON.stringify(state));
  }
  return profile;
}

test('a player who stays at the leave prompt leaves no hang behind', { timeout: 60_000 }, async () => {
  const profile = await openProfile('northland-desktop-leave-');
  let desktop: ElectronApplication | undefined;
  try {
    desktop = await launchShell(profile, { [ORIGINAL_GAME_CHECK_ENV]: '0' });
    const page = await desktop.firstWindow();
    await page.waitForURL(START_URL);
    await page.goto(MENU);
    await page.locator('[data-nav-id="newGame"]').waitFor({ timeout: 30_000 });
    // A running game holds its page through `beforeunload` the same way; once, so the test can close.
    await page.evaluate(() =>
      addEventListener(
        'beforeunload',
        (event) => {
          event.preventDefault();
          event.returnValue = '';
        },
        { once: true },
      ),
    );
    const shell = desktop;
    // The player answers the shell's prompt with its cancel button, which keeps the game.
    await desktop.evaluate(({ BrowserWindow, dialog }) => {
      dialog.showMessageBoxSync = ((_window: unknown, options: { cancelId: number }) => {
        Object.assign(globalThis, { leavePromptShown: true });
        return options.cancelId;
      }) as typeof dialog.showMessageBoxSync;
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await waitFor(
      () => shell.evaluate(() => (globalThis as { leavePromptShown?: true }).leavePromptShown),
      'the leave prompt',
    );
    await new Promise((settle) => setTimeout(settle, ELECTRON_CLOSE_HANG_MS + CLOSE_HANG_MARGIN_MS));
    assert.equal(page.isClosed(), false);
    assert.deepEqual(await readdir(faultsRoot(profile)).catch(() => []), []);
  } finally {
    try {
      await desktop?.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
});

test('records a renderer crash, reloads the start page and lets that page clear the record', {
  timeout: 60_000,
}, async () => {
  const profile = await openProfile('northland-desktop-crash-');
  const faults = faultsRoot(profile);
  let desktop: ElectronApplication | undefined;
  try {
    desktop = await launchShell(profile, { [ORIGINAL_GAME_CHECK_ENV]: '0' });
    const page = await desktop.firstWindow();
    await page.waitForURL(START_URL);
    await page.locator('[data-nav-id="newGame"]').waitFor({ timeout: 30_000 });

    // The opt-in that lets the shell read a hung page's call stack.
    const policy = await page.evaluate(async () =>
      (await fetch('/index.html')).headers.get('document-policy'),
    );
    assert.equal(policy, 'include-js-call-stacks-in-crash-reports');

    await page.goto(MENU);
    const shell = desktop;
    // Read in a listener after the shell's own, so the reloaded page cannot clear the record first.
    await desktop.evaluate(({ BrowserWindow }, dir) => {
      const fs = process.getBuiltinModule('node:fs');
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      contents?.once('render-process-gone', () => {
        const triggers = fs
          .readdirSync(dir)
          .map((name) => String(JSON.parse(fs.readFileSync(`${dir}/${name}`, 'utf8')).trigger));
        Object.assign(globalThis, { triggersAtCrash: triggers });
      });
      contents?.forcefullyCrashRenderer();
    }, faults);
    const atCrash = await waitFor(
      () => shell.evaluate(() => (globalThis as { triggersAtCrash?: string[] }).triggersAtCrash),
      'the crash',
    );
    assert.deepEqual(atCrash, ['renderer-gone']);
    await waitFor(async () => {
      const url = await shell.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents;
        return contents === undefined || contents.isCrashed() ? null : contents.getURL();
      });
      return url === START_URL ? true : undefined;
    }, 'the reload of the start page');
    await waitFor(
      async () => ((await readdir(faults)).length === 0 ? true : undefined),
      'the reloaded page clearing the record',
    );
  } finally {
    try {
      await desktop?.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
});
