import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication } from 'playwright';
import { test } from 'vitest';
import { resolveShellRoots } from '../src/paths.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = resolveShellRoots({
  packaged: false,
  resourcesPath: '',
  repoRoot: resolve(packageRoot, '../..'),
  contentDirOverride: process.env.ON_CONTENT_DIR,
});
const MENU = 'app://game/index.html?lang=eng&sound=off&fullscreen=off';
const SAVE_NAME = 'Desktop relaunch test';

test('boots app://, lists map previews, and restores a save after relaunch', {
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
  let desktop: ElectronApplication | undefined;
  const errors: string[] = [];
  async function launch() {
    desktop = await _electron.launch({ args: [packageRoot, `--user-data-dir=${profile}`], timeout: 30_000 });
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

    await page.goto(`${MENU}&map=magiczny_las&intro=off&uiscale=1`);
    await page.waitForFunction(() => (window.__opennorthland?.sim.tick ?? 0) >= 3, null, { timeout: 90_000 });
    const saved = await page.evaluate(() => {
      const game = window.__opennorthland;
      if (game === undefined) throw new Error('Game did not mount');
      game.setPaused(true);
      return { tick: game.sim.tick, hash: game.sim.hashState() };
    });
    await page.getByRole('button', { name: 'Game menu', exact: true }).click();
    await page.getByRole('button', { name: 'Save game', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(SAVE_NAME);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Game saved.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Return to menu', exact: true }).click();
    await page.getByRole('button', { name: 'Return to menu', exact: true }).last().click();
    await page.locator('[data-nav-id="newGame"]').waitFor();
    assert.equal(await page.evaluate(() => window.__opennorthland === undefined), true);
    assert.deepEqual(errors, []);

    await desktop?.close();
    desktop = undefined;
    page = await launch();
    await page.locator('[data-nav-id="load"]').click();
    await page.getByRole('button').filter({ hasText: SAVE_NAME }).dblclick();
    await page.waitForFunction(() => window.__opennorthland !== undefined, null, { timeout: 90_000 });
    const restored = await page.evaluate(() => {
      const game = window.__opennorthland;
      if (game === undefined) throw new Error('Save did not mount');
      return {
        tick: game.sim.tick,
        hash: game.sim.hashState(),
        paused: game.perf().paused,
        map: new URLSearchParams(location.search).get('map'),
      };
    });
    assert.deepEqual(restored, { ...saved, paused: true, map: 'magiczny_las' });
    assert.deepEqual(errors, []);
  } finally {
    try {
      await desktop?.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
});
