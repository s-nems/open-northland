import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from 'playwright';
import { test } from 'vitest';
import { ORIGINAL_GAME_CHECK_ENV, ORIGINAL_GAME_DIR_ENV } from '../src/original-game/detect.js';
import { ORIGINAL_GAME_STATE_FILE } from '../src/original-game/state.js';
import { libraryHead } from '../test/original-game/fixture.js';
import { launchShell, MENU, START_URL, unexpectedConsoleError } from './launch.js';

const STEAM_PAGE = 'https://store.steampowered.com/app/351870/';

const POLL_MS = 100;
const POLL_LIMIT_MS = 10_000;

async function waitUntil(done: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + POLL_LIMIT_MS;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error('the condition never held');
    await new Promise((settle) => setTimeout(settle, POLL_MS));
  }
}

/** Playwright cannot drive the native folder dialog, so the main process answers it with `folder`. */
async function answerFolderDialog(desktop: ElectronApplication, folder: string): Promise<void> {
  await desktop.evaluate(({ dialog }, picked) => {
    Object.assign(dialog, {
      showOpenDialog: async () => ({ canceled: false, filePaths: [picked] }),
    });
  }, folder);
}

test('shows the gate in the window when detection misses, and opens the menu on a recognized pick', {
  timeout: 120_000,
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'northland-desktop-gate-'));
  const empty = join(profile, 'empty');
  const originalGame = join(profile, 'original-game');
  await mkdir(empty);
  await mkdir(join(originalGame, 'DataX', 'Libs'), { recursive: true });
  await writeFile(join(originalGame, 'DataX', 'Libs', 'data0001.lib'), libraryHead());

  let desktop: ElectronApplication | undefined;
  const errors: string[] = [];
  try {
    // Detection looks only in the empty folder, so the window opens on the gate.
    desktop = await launchShell(profile, { [ORIGINAL_GAME_CHECK_ENV]: '1', [ORIGINAL_GAME_DIR_ENV]: empty });
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (unexpectedConsoleError(message)) errors.push(message.text());
    });
    await page.waitForURL(START_URL);
    await page.goto(MENU);
    const pick = page.getByRole('button', { name: 'Pick the game folder', exact: true });
    await pick.waitFor();
    await page.getByRole('button', { name: 'Exit', exact: true }).waitFor();
    assert.equal(await page.locator('[data-nav-id="newGame"]').count(), 0);
    await assert.rejects(access(join(profile, ORIGINAL_GAME_STATE_FILE)));

    // A store link leaves for the system browser and opens no window of the shell's own.
    await desktop.evaluate(({ shell }) => {
      const opened: string[] = [];
      Object.assign(globalThis, { openedExternally: opened });
      Object.assign(shell, {
        openExternal: async (url: string) => {
          opened.push(url);
        },
      });
    });
    await page.getByRole('link', { name: 'Steam', exact: true }).click();
    const shell = desktop;
    const openedLinks = (): Promise<string[]> =>
      shell.evaluate(() => {
        const opened: unknown = Reflect.get(globalThis, 'openedExternally');
        return Array.isArray(opened) ? opened.filter((url) => typeof url === 'string') : [];
      });
    await waitUntil(async () => (await openedLinks()).length > 0);
    assert.deepEqual(await openedLinks(), [STEAM_PAGE]);
    assert.equal(desktop.windows().length, 1);

    await answerFolderDialog(desktop, empty);
    await pick.click();
    await page.getByText('That folder holds no Cultures game data', { exact: true }).waitFor();

    await answerFolderDialog(desktop, originalGame);
    await pick.click();
    await page.locator('[data-nav-id="newGame"]').waitFor();
    await access(join(profile, ORIGINAL_GAME_STATE_FILE));
    assert.deepEqual(errors, []);
  } finally {
    try {
      await desktop?.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
});
