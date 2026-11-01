import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { zipSync } from 'fflate';
import type { ElectronApplication, Page } from 'playwright';
import { expect, test } from 'vitest';
import { IR_VERSION } from '../../data/src/schema/content/ir-version.js';
import { encodeC2m } from '../../formats/test/fixtures/c2m.js';
import { plaintextMap } from '../../map-import/test/support/maps.js';
import { installedMapsRoot } from '../src/paths.js';
import { E2E_API_URL, launchShell, MENU } from './launch.js';

test('imports ZIP, C2M and folder through native picks, reloads retained input on request and plays after relaunch', {
  timeout: 240_000,
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'on-desktop-local-e2e-'));
  const folder = join(profile, 'picked-map');
  const files = Object.fromEntries(
    Object.entries(plaintextMap('Desktop local map')).map(([path, data]) => [
      path,
      typeof data === 'string' ? new TextEncoder().encode(data) : data,
    ]),
  );
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), bytes);
  }
  const zip = join(profile, 'picked-map.zip');
  const c2m = join(profile, 'picked-map.c2m');
  const invalid = join(profile, 'invalid.zip');
  await writeFile(zip, zipSync(files));
  await writeFile(c2m, encodeC2m(files));
  await writeFile(invalid, 'not an archive');
  let desktop: ElectronApplication | undefined;
  const errors: string[] = [];
  async function launch(): Promise<Page> {
    desktop = await launchShell(profile, { ON_ORIGINAL_GAME_CHECK: '0' });
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.route(`${E2E_API_URL}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
        headers: { 'access-control-allow-origin': '*' },
      }),
    );
    await page.goto(MENU);
    await page.locator('[data-nav-id="newGame"]').waitFor();
    return page;
  }
  async function catalogue(page: Page): Promise<void> {
    await page.locator('[data-nav-id="newGame"]').click();
    await page.locator('.main-menu__map-select-catalogue').click();
    await page.getByRole('button', { name: 'Load map…', exact: true }).waitFor();
  }
  async function pick(page: Page, path: string | null, kind: 'archive' | 'folder'): Promise<void> {
    assert.ok(desktop);
    await desktop.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({
        canceled: selected === null,
        filePaths: selected === null ? [] : [selected],
      });
    }, path);
    await page.getByRole('button', { name: 'Load map…', exact: true }).click();
    await page
      .getByRole('button', { name: kind === 'folder' ? 'Load folder' : 'Load from file', exact: true })
      .click();
  }
  async function localRecords(page: Page) {
    return page.evaluate(
      async () =>
        ((await window.desktop?.maps?.list()) ?? []).filter(
          (raw) => (raw as { mapId?: string }).mapId !== undefined,
        ) as { mapId: string; revision: string; irVersion: number }[],
    );
  }
  async function start(page: Page, mapId: string): Promise<void> {
    await page.goto(`${MENU}&map=${mapId}&intro=off&player=0`);
    await page.waitForFunction(() => (window.__opennorthland?.host.tick ?? 0) >= 3, null, {
      timeout: 90_000,
    });
  }
  try {
    let page = await launch();
    await catalogue(page);
    let mapId = '';
    for (const [path, kind] of [
      [zip, 'archive'],
      [c2m, 'archive'],
      [folder, 'folder'],
    ] as const) {
      await pick(page, path, kind);
      await page.getByText('Maps added: 1. Find them under Installed.', { exact: true }).waitFor();
      const records = await localRecords(page);
      assert.equal(records.length, 1, 'identical playable content replaces its existing entry');
      mapId = records[0]?.mapId ?? '';
    }
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'native-drop-test';
      document.body.append(input);
    });
    await page.locator('#native-drop-test').setInputFiles(zip);
    assert.equal(
      await page.evaluate(async () => {
        const file = (document.querySelector('#native-drop-test') as HTMLInputElement).files?.[0];
        if (file === undefined) throw new Error('Missing dropped file');
        return (await window.desktop?.maps?.drop(file))?.kind;
      }),
      'picked',
    );
    assert.equal(
      await page.evaluate(async () => {
        try {
          await window.desktop?.maps?.drop(new File(['x'], 'synthetic.zip'));
          return false;
        } catch {
          return true;
        }
      }),
      true,
      'a synthetic File must not grant native filesystem access',
    );
    const previous = await localRecords(page);
    await pick(page, null, 'archive');
    await page.getByText('Import cancelled.', { exact: true }).waitFor();
    assert.deepEqual(await localRecords(page), previous);
    await pick(page, invalid, 'archive');
    await page
      .getByText('Unsupported archive. Choose ZIP, RAR, C2M, a setup EXE or a map folder.', { exact: true })
      .waitFor();
    assert.deepEqual(await localRecords(page), previous);
    await start(page, mapId);
    await desktop?.close();
    desktop = undefined;
    const manifestPath = join(installedMapsRoot(profile), 'installed.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const map of manifest.maps) map.record.irVersion = IR_VERSION - 1;
    await writeFile(manifestPath, JSON.stringify(manifest));
    page = await launch();
    await catalogue(page);
    await page.getByRole('button', { name: /^Installed/ }).click();
    assert.equal((await localRecords(page))[0]?.irVersion, IR_VERSION - 1);
    await page.getByRole('button', { name: 'Load again', exact: true }).click();
    await expect
      .poll(async () => (await localRecords(page))[0]?.irVersion, { timeout: 30_000 })
      .toBe(IR_VERSION);
    const rebuilt = await localRecords(page);
    assert.equal(rebuilt[0]?.mapId, mapId);
    assert.notEqual(rebuilt[0]?.revision, previous[0]?.revision);
    await start(page, mapId);
    assert.deepEqual(errors, []);
  } finally {
    await desktop?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
