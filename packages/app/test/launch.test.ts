import { afterEach, describe, expect, it, vi } from 'vitest';
import { swapToEntry } from '../src/launch.js';

afterEach(() => vi.unstubAllGlobals());

interface WindowProbe {
  readonly trace: string[];
}

/** Traces what a handover does to the window; assigning `location.search` would be a real navigation. */
function stubWindow(): WindowProbe {
  const probe: WindowProbe = { trace: [] };
  vi.stubGlobal('window', {
    history: {
      pushState: (_state: unknown, _title: string, url: string) => probe.trace.push(`push ${url}`),
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
      '?map=fjord&fog=classic',
      () => probe.trace.push('teardown'),
      (params, onLoaded) => {
        probe.trace.push(`load ${params.get('map')}`);
        onLoaded();
        probe.trace.push('draw');
        return Promise.resolve();
      },
    );

    // The menu holds the frame until the entry's module is in, and the URL turns over with it.
    expect(probe.trace).toEqual(['load fjord', 'push ?map=fjord&fog=classic', 'teardown', 'draw']);
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
});
