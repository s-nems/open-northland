import { afterEach, describe, expect, it, vi } from 'vitest';
import { swapToEntry } from '../src/launch.js';

afterEach(() => vi.unstubAllGlobals());

interface WindowProbe {
  readonly trace: string[];
  /** The handler `swapToEntry` armed for the back button. */
  popstate: (() => void) | null;
}

/** Traces what a handover does to the window; assigning `location.search` would be a real navigation. */
function stubWindow(): WindowProbe {
  const probe: WindowProbe = { trace: [], popstate: null };
  vi.stubGlobal('window', {
    history: {
      pushState: (_state: unknown, _title: string, url: string) => probe.trace.push(`push ${url}`),
    },
    addEventListener: (type: string, handler: () => void) => {
      probe.trace.push(`listen ${type}`);
      if (type === 'popstate') probe.popstate = handler;
    },
    location: {
      reload: () => probe.trace.push('reload'),
      set search(_value: string) {
        probe.trace.push('navigate');
      },
    },
  });
  return probe;
}

describe('swapToEntry', () => {
  it('hands over inside the document, since a navigation would end the fullscreen grant', async () => {
    const probe = stubWindow();

    await swapToEntry(
      '?map=fjord&fog=reveal',
      () => probe.trace.push('teardown'),
      (params, onLoaded) => {
        probe.trace.push(`load ${params.get('map')}`);
        onLoaded();
        probe.trace.push('draw');
        return Promise.resolve();
      },
    );

    // The menu holds the frame until the entry's module is in, and the URL turns over with it.
    expect(probe.trace).toEqual([
      'load fjord',
      'push ?map=fjord&fog=reveal',
      'listen popstate',
      'teardown',
      'draw',
    ]);
  });

  it('leaves the URL and the screen it replaces alone when the entry never loads', async () => {
    const probe = stubWindow();

    await expect(
      swapToEntry(
        '?map=fjord',
        () => probe.trace.push('teardown'),
        () => Promise.reject(new Error('offline')),
      ),
    ).rejects.toThrow('offline');
    expect(probe.trace).toEqual([]);
  });

  it('reloads on the back button, so the menu boots from its own URL', async () => {
    const probe = stubWindow();

    await swapToEntry(
      '?map=fjord',
      () => undefined,
      (_params, onLoaded) => {
        onLoaded();
        return Promise.resolve();
      },
    );
    probe.popstate?.();

    expect(probe.trace.at(-1)).toBe('reload');
  });
});
