import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DeviceEnv, deviceNoticeCleared, deviceNoticeNeeded } from '../src/view/device-notice.js';

afterEach(() => vi.unstubAllGlobals());

/** A phone opening a shared link to the menu for the first time. */
const PHONE: DeviceEnv = {
  servedByBrowser: true,
  playerRoute: true,
  dismissed: false,
  coarsePointer: true,
  finePointer: false,
};

describe('deviceNoticeNeeded', () => {
  it('holds a device with only a finger to point with at the notice', () => {
    expect(deviceNoticeNeeded(PHONE)).toBe(true);
  });

  it('lets a touch laptop or a tablet with a mouse through, since its trackpad or mouse can play', () => {
    expect(deviceNoticeNeeded({ ...PHONE, finePointer: true })).toBe(false);
  });

  it('lets a browser that reports no pointer at all through, as a remote desktop may', () => {
    expect(deviceNoticeNeeded({ ...PHONE, coarsePointer: false })).toBe(false);
  });

  it('stays away once the player chose to start anyway', () => {
    expect(deviceNoticeNeeded({ ...PHONE, dismissed: true })).toBe(false);
  });

  it('never shows in the desktop shell or in developer modes', () => {
    expect(deviceNoticeNeeded({ ...PHONE, servedByBrowser: false })).toBe(false);
    expect(deviceNoticeNeeded({ ...PHONE, playerRoute: false })).toBe(false);
  });
});

/** Enough of a document to draw the notice; `click` presses its start-anyway button. */
function stubNoticeDocument(): { readonly drawn: () => number; readonly click: () => void } {
  let drawn = 0;
  let onClick = (): void => undefined;
  vi.stubGlobal('document', {
    body: { append: () => undefined },
    createElement: () => {
      drawn += 1;
      return {
        append: () => undefined,
        remove: () => undefined,
        addEventListener: (type: string, handler: () => void) => {
          if (type === 'click') onClick = handler;
        },
      };
    },
  });
  return { drawn: () => drawn, click: () => onClick() };
}

describe('deviceNoticeCleared', () => {
  it('holds the boot until the player starts anyway, then skips the notice on later visits', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { protocol: 'https:' },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      matchMedia: (query: string) => ({ matches: query === '(any-pointer: coarse)' }),
    });
    const notice = stubNoticeDocument();
    let booted = false;
    const firstVisit = deviceNoticeCleared(new URLSearchParams()).then(() => {
      booted = true;
    });

    await Promise.resolve();
    expect(booted).toBe(false);
    notice.click();
    await firstVisit;
    expect(booted).toBe(true);

    const drawnOnFirstVisit = notice.drawn();
    await deviceNoticeCleared(new URLSearchParams());
    expect(notice.drawn()).toBe(drawnOnFirstVisit);
  });

  it('boots the game when the device cannot be read', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:' },
      localStorage: { getItem: () => null },
      matchMedia: () => {
        throw new Error('matchMedia unavailable');
      },
    });

    await expect(deviceNoticeCleared(new URLSearchParams())).resolves.toBeUndefined();
  });

  it('boots the game when the notice cannot be drawn', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:' },
      localStorage: { getItem: () => null },
      matchMedia: (query: string) => ({ matches: query === '(any-pointer: coarse)' }),
    });
    vi.stubGlobal('document', {
      createElement: () => {
        throw new Error('no DOM');
      },
    });

    await expect(deviceNoticeCleared(new URLSearchParams())).resolves.toBeUndefined();
  });
});
