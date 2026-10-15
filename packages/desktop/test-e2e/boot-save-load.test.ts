import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { test } from 'vitest';
import { ORIGINAL_GAME_CHECK_ENV, ORIGINAL_GAME_DIR_ENV } from '../src/original-game/detect.js';
import { ORIGINAL_GAME_STATE_FILE } from '../src/original-game/state.js';
import { resolveShellRoots } from '../src/paths.js';
import { FIRST_RUN_WINDOW_STATE, WINDOW_STATE_FILE } from '../src/window-state.js';
import { libraryHead } from '../test/original-game/fixture.js';
import { installedMapFixture } from './installed-map.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = resolveShellRoots({
  packaged: false,
  resourcesPath: '',
  repoRoot: resolve(packageRoot, '../..'),
  contentDirOverride: process.env.ON_CONTENT_DIR,
});
const MENU = 'app://game/index.html?lang=eng&sound=off&fullscreen=off';
const SAVE_NAME = 'Desktop relaunch test';
const testFullscreen = process.env.ON_DESKTOP_RESTORE_WINDOW === '1';

test('boots app://, lists map previews, and restores a save and the window mode after relaunch', {
  timeout: 240_000,
}, async () => {
  for (const file of ['ir.json', 'maps-index.json', 'maps/magiczny_las.json', 'bobs']) {
    await access(join(roots.contentRoot, file)).catch(() => {
      throw new Error(`Missing ${file} under ${roots.contentRoot}; run npm run build:content first`);
    });
  }
  await access(join(roots.appRoot, 'index.html'));
  const bob = (await readdir(join(roots.contentRoot, 'bobs'))).find((name) => name.endsWith('.png'));
  assert.ok(bob, 'converted content must include a sprite PNG');

  const profile = await mkdtemp(join(tmpdir(), 'northland-desktop-'));
  // A synthetic install beside the profile: the shell opens no window before it recognizes one.
  const originalGame = join(profile, 'original-game');
  await mkdir(join(originalGame, 'DataX', 'Libs'), { recursive: true });
  await writeFile(join(originalGame, 'DataX', 'Libs', 'data0001.lib'), libraryHead());
  const launchEnv: Record<string, string> = {
    [ORIGINAL_GAME_CHECK_ENV]: '1',
    [ORIGINAL_GAME_DIR_ENV]: originalGame,
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && launchEnv[key] === undefined) launchEnv[key] = value;
  }
  let desktop: ElectronApplication | undefined;
  const errors: string[] = [];
  async function windowFullscreen(): Promise<boolean> {
    const shell = desktop;
    if (shell === undefined) throw new Error('Desktop is not running');
    return shell.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false);
  }
  /** The window and the app's mirror of it agree once a transition has landed. */
  async function waitForFullscreen(page: Page, expected: boolean): Promise<void> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const shown = await windowFullscreen();
      const mirrored = await page.evaluate(() => window.desktop?.fullscreen.isActive() ?? null);
      if (shown === expected && mirrored === expected) return;
      if (Date.now() > deadline) {
        throw new Error(`Window fullscreen ${shown}, app reads ${mirrored}; expected ${expected}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  /** Synthetic page keys skip the shell's input hook; an input event sent to the window takes it. */
  async function pressAltEnter(): Promise<void> {
    await desktop?.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      contents?.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['alt'] });
      contents?.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['alt'] });
    });
  }
  async function relaunch() {
    await desktop?.close();
    desktop = undefined;
    return launch();
  }
  async function launch() {
    desktop = await _electron.launch({
      args: [packageRoot, `--user-data-dir=${profile}`, '--mute-audio'],
      env: launchEnv,
      timeout: 30_000,
    });
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    // Assert the shell's own initial route before pinning language and display preferences.
    await page.waitForURL('app://game/index.html');
    await page.locator('[data-nav-id="newGame"]').waitFor();
    await page.goto(MENU);
    return page;
  }

  try {
    let page = await launch();
    const installed = await installedMapFixture(roots.contentRoot);
    await page.evaluate(async ({ record, originalId }) => {
      const maps = window.desktop?.maps;
      if (maps === undefined) throw new Error('Installed-map bridge unavailable');
      const files = await Promise.all(
        record.suffixes.map(async (suffix): Promise<[string, Uint8Array]> => {
          const response = await fetch(`/maps/${originalId}${suffix}`);
          if (!response.ok) throw new Error('Missing installed-map sidecar');
          return [suffix, new Uint8Array(await response.arrayBuffer())];
        }),
      );
      await maps.commit([], [{ record, files }]);
    }, installed);
    await access(join(profile, ORIGINAL_GAME_STATE_FILE));
    await waitForFullscreen(page, testFullscreen);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Graphics', exact: true }).click();
    await page.emulateMedia({ forcedColors: 'active' });
    const menuRange = page.locator('.main-menu__settings-range').first();
    assert.equal(await menuRange.evaluate((input) => getComputedStyle(input).borderTopStyle), 'solid');
    await page.emulateMedia({ forcedColors: 'none' });
    await page.locator('.main-menu__back').click();
    await page.locator('[data-nav-id="newGame"]').click();
    await page.locator('.main-menu__map-row').first().waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll<HTMLImageElement>('.main-menu__map-thumb img')].some(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );

    const routes = await page.evaluate(async (name) => {
      const read = async (url: string) => {
        const response = await fetch(url);
        return {
          status: response.status,
          type: response.headers.get('content-type'),
          bytes: [...new Uint8Array(await response.arrayBuffer())],
        };
      };
      return Promise.all([read(`app://game/bobs/${name}`), read(`app://bobs/${name}`)]);
    }, bob);
    assert.equal(routes[0]?.status, 200);
    assert.equal(routes[0]?.type, 'image/png');
    assert.equal(routes[1]?.status, 200, 'the folded app://bobs route must serve sprites');
    assert.deepEqual(routes[1], routes[0], 'both app:// spellings must serve the same sprite');
    assert.deepEqual(routes[0]?.bytes.slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
    const RANGE_BYTES = 100;
    const ranged = await page.evaluate(async (url) => {
      const response = await fetch(url, { headers: { range: 'bytes=0-99' } });
      return {
        status: response.status,
        acceptRanges: response.headers.get('accept-ranges'),
        length: (await response.arrayBuffer()).byteLength,
      };
    }, `app://game/bobs/${bob}`);
    assert.deepEqual(
      ranged,
      { status: 206, acceptRanges: 'bytes', length: RANGE_BYTES },
      'app:// must serve byte ranges',
    );

    await page.goto(`${MENU}&map=${installed.record.mapId}&intro=off&uiscale=1`);
    await page.waitForFunction(() => (window.__opennorthland?.host.tick ?? 0) >= 3, null, {
      timeout: 90_000,
    });
    const saved = await page.evaluate(async () => {
      const game = window.__opennorthland;
      if (game === undefined) throw new Error('Game did not mount');
      await game.setPaused(true);
      return game.host.hashState();
    });
    await page.getByRole('button', { name: 'Game menu', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Graphics', exact: true }).click();
    const range = page.locator('.on-system-settings .main-menu__settings-range').first();
    await range.waitFor();
    assert.match(
      await range.evaluate((input) => getComputedStyle(input).backgroundImage),
      /^linear-gradient\(/,
    );
    await page.emulateMedia({ forcedColors: 'active' });
    assert.equal(await range.evaluate((input) => getComputedStyle(input).borderTopStyle), 'solid');
    await page.emulateMedia({ forcedColors: 'none' });
    await page.getByRole('button', { name: 'Window', exact: true }).click();
    await waitForFullscreen(page, false);
    if (testFullscreen) {
      await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
      await waitForFullscreen(page, true);
    }
    // Escape belongs to the game's menus and never leaves the window's fullscreen.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save game', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    // Longer than a native leave transition, which would read fullscreen until it lands.
    const escapeWatchEnds = Date.now() + 2_000;
    while (Date.now() < escapeWatchEnds) {
      assert.equal(await windowFullscreen(), testFullscreen, 'Escape changed the window mode');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await page.getByRole('button', { name: 'Game menu', exact: true }).click();
    await page.getByRole('button', { name: 'Save game', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(SAVE_NAME);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(`Saved "${SAVE_NAME}".`, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    // The game menu's quit asks once more under the same label.
    await page.getByRole('button', { name: 'Leave game', exact: true }).click();
    await page.getByRole('button', { name: 'Leave game', exact: true }).last().click();
    await page.locator('[data-nav-id="newGame"]').waitFor();
    assert.equal(await page.evaluate(() => window.__opennorthland === undefined), true);
    assert.deepEqual(errors, []);
    if (testFullscreen) await pressAltEnter();
    await waitForFullscreen(page, false);

    page = await relaunch();
    const persisted = await page.evaluate(async () => window.desktop?.maps?.list());
    assert.deepEqual(persisted, [installed.record]);
    // The window reopens in the mode it closed in.
    await waitForFullscreen(page, false);
    await page.locator('[data-nav-id="load"]').click();
    await page.getByRole('button').filter({ hasText: SAVE_NAME }).dblclick();
    await page.waitForFunction(() => window.__opennorthland !== undefined, null, { timeout: 90_000 });
    const restored = await page.evaluate(async () => {
      const game = window.__opennorthland;
      if (game === undefined) throw new Error('Save did not mount');
      return {
        ...(await game.host.hashState()),
        paused: (await game.perf()).paused,
        map: new URLSearchParams(location.search).get('map'),
      };
    });
    assert.deepEqual(restored, { ...saved, paused: true, map: installed.record.mapId });
    assert.deepEqual(errors, []);

    if (testFullscreen) {
      await pressAltEnter();
      await waitForFullscreen(page, true);
    } else {
      // A previously saved fullscreen mode must not steal the desktop on a development launch.
      await desktop?.close();
      desktop = undefined;
      await writeFile(join(profile, WINDOW_STATE_FILE), JSON.stringify(FIRST_RUN_WINDOW_STATE));
    }
    page = await relaunch();
    await waitForFullscreen(page, testFullscreen);
    assert.deepEqual(errors, []);
  } finally {
    try {
      await desktop?.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
});
