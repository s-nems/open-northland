import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DeviceEnv, deviceNotice, deviceNoticeCleared } from '../src/view/device-notice.js';

afterEach(() => vi.unstubAllGlobals());

/** A phone opening a shared link to the menu for the first time. */
const PHONE: DeviceEnv = {
  servedByBrowser: true,
  playerRoute: true,
  dismissed: new Set(),
  coarsePointer: true,
  finePointer: false,
  webgl: true,
  canvasReadback: 'exact',
  brave: false,
};

/** A desktop browser that can play. */
const DESKTOP: DeviceEnv = { ...PHONE, coarsePointer: false, finePointer: true };

describe('deviceNotice', () => {
  it('holds a device with only a finger to point with at the notice', () => {
    expect(deviceNotice(PHONE)).toBe('touch');
  });

  it('lets a touch laptop or a tablet with a mouse through, since its trackpad or mouse can play', () => {
    expect(deviceNotice({ ...PHONE, finePointer: true })).toBeNull();
  });

  it('lets a browser that reports no pointer at all through, as a remote desktop may', () => {
    expect(deviceNotice({ ...PHONE, coarsePointer: false })).toBeNull();
  });

  it('stays away once the player chose to start anyway', () => {
    expect(deviceNotice({ ...PHONE, dismissed: new Set(['touch']) })).toBeNull();
  });

  it('never shows in the desktop shell or in developer modes', () => {
    expect(deviceNotice({ ...PHONE, servedByBrowser: false })).toBeNull();
    expect(deviceNotice({ ...PHONE, playerRoute: false })).toBeNull();
    expect(deviceNotice({ ...DESKTOP, webgl: false, servedByBrowser: false })).toBeNull();
  });

  it('warns a browser without WebGL first, since the game cannot draw a frame there', () => {
    expect(deviceNotice({ ...DESKTOP, webgl: false })).toBe('webgl');
    expect(deviceNotice({ ...PHONE, webgl: false, canvasReadback: 'replaced' })).toBe('webgl');
  });

  it('warns a browser whose privacy setting replaces canvas reads, even after the touch notice was dismissed', () => {
    expect(deviceNotice({ ...DESKTOP, canvasReadback: 'replaced' })).toBe('canvasReadback');
    expect(deviceNotice({ ...PHONE, dismissed: new Set(['touch']), canvasReadback: 'replaced' })).toBe(
      'canvasReadback',
    );
  });

  it('asks Brave to lower its Shields while they shift canvas reads, until the player starts anyway', () => {
    const shielded: DeviceEnv = { ...DESKTOP, brave: true, canvasReadback: 'shifted' };
    expect(deviceNotice(shielded)).toBe('braveShields');
    expect(deviceNotice({ ...shielded, canvasReadback: 'exact' })).toBeNull();
    expect(deviceNotice({ ...shielded, dismissed: new Set(['braveShields']) })).toBeNull();
    expect(deviceNotice({ ...shielded, brave: false })).toBeNull();
  });

  it('lets a browser that can play straight through', () => {
    expect(deviceNotice(DESKTOP)).toBeNull();
  });
});

/** Enough of a document to draw the notice; `click` presses its start-anyway button. */
function stubNoticeDocument(): { readonly drawn: () => number; readonly click: () => void } {
  let drawn = 0;
  let onClick = (): void => undefined;
  vi.stubGlobal('document', {
    body: { append: () => undefined },
    createElement: (tag: string) => {
      if (tag === 'main') drawn += 1;
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
