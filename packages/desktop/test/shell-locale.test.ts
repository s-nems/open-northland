import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { patchConfig, buildAppMenu } = vi.hoisted(() => ({
  patchConfig: vi.fn(),
  buildAppMenu: vi.fn(),
}));

vi.mock('../src/config.js', () => ({ patchConfig }));
vi.mock('../src/window.js', () => ({ buildAppMenu }));

import { currentLocale, setActiveLocale } from '../src/i18n/index.js';
import { watchGameLocale } from '../src/shell-locale.js';
import type { ShellPaths } from '../src/shell-state.js';

const PATHS: ShellPaths = {
  dataRoot: { path: '/data', portable: false },
  contentDir: '/data/content',
  configFile: '/data/config.json',
  modsDir: '/data/mods',
};

type Navigation = 'did-navigate-in-page' | 'did-finish-load';

/** One macrotask boundary, which drains the handler's promise chain however deep it is. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface FakeWindow {
  readonly win: BrowserWindow;
  /** Fire a navigation listener with the page URL and the `lang` the page would then report. */
  go: (event: Navigation, url: string, pageTag: string) => Promise<void>;
}

function fakeWindow(): FakeWindow {
  const listeners = new Map<string, (event: unknown, url: string) => void>();
  let tag = '';
  let url = '';
  const win = {
    webContents: {
      on(event: string, listener: (event: unknown, url: string) => void) {
        listeners.set(event, listener);
      },
      getURL: () => url,
      executeJavaScript: async () => tag,
    },
  };
  return {
    win: win as unknown as BrowserWindow,
    async go(event, pageUrl, pageTag) {
      url = pageUrl;
      tag = pageTag;
      listeners.get(event)?.({}, pageUrl);
      await settle(); // the handler reads the page asynchronously
    },
  };
}

beforeEach(() => {
  patchConfig.mockClear();
  buildAppMenu.mockClear();
});

describe('watchGameLocale', () => {
  it('adopts the language the game page reports and persists it', async () => {
    setActiveLocale('eng');
    const { win, go } = fakeWindow();
    watchGameLocale(win, PATHS);

    await go('did-navigate-in-page', 'app://game/index.html?lang=pol&sound=off', 'pl');

    expect(currentLocale()).toBe('pol');
    expect(patchConfig).toHaveBeenCalledWith('/data/config.json', { locale: 'pol' });
    expect(buildAppMenu).toHaveBeenCalledOnce();
  });

  it('reads the page rather than the URL, so a dropped `lang` still reports a language', async () => {
    setActiveLocale('eng');
    const { win, go } = fakeWindow();
    watchGameLocale(win, PATHS);

    await go('did-navigate-in-page', 'app://game/index.html', 'pl');

    expect(currentLocale()).toBe('pol');
    expect(patchConfig).toHaveBeenCalledWith('/data/config.json', { locale: 'pol' });
  });

  it('follows a full load into a world, not only an in-page rewrite', async () => {
    setActiveLocale('eng');
    const { win, go } = fakeWindow();
    watchGameLocale(win, PATHS);

    await go('did-finish-load', 'app://game/index.html?map=campaign01', 'pl');

    expect(currentLocale()).toBe('pol');
  });

  it('leaves the shell language alone on the setup page and on a locale it already holds', async () => {
    setActiveLocale('eng');
    const { win, go } = fakeWindow();
    watchGameLocale(win, PATHS);

    await go('did-finish-load', 'app://setup/setup.html', 'pl');
    await go('did-navigate-in-page', 'app://game/index.html', 'en');

    expect(currentLocale()).toBe('eng');
    expect(patchConfig).not.toHaveBeenCalled();
    expect(buildAppMenu).not.toHaveBeenCalled();
  });

  it('ignores a page that reports no shipped language, such as one that failed to boot', async () => {
    setActiveLocale('eng');
    const { win, go } = fakeWindow();
    watchGameLocale(win, PATHS);

    await go('did-finish-load', 'app://game/index.html', '');

    expect(currentLocale()).toBe('eng');
    expect(patchConfig).not.toHaveBeenCalled();
  });
});
