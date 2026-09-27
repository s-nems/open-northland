import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissCrashBanner, showCrashBanner } from '../src/diag/crash.js';

afterEach(() => vi.unstubAllGlobals());

const STALL = 'sim-stall';

interface StubElement {
  readonly tag: string;
  textContent: string;
  removed: boolean;
  readonly clicks: (() => void)[];
}

/** Enough of a browser to draw the banner, with every element it created. */
function stubBannerDocument(): StubElement[] {
  const created: StubElement[] = [];
  vi.stubGlobal('window', { location: { protocol: 'https:' } });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('document', {
    body: { append: () => undefined },
    createElement: (tag: string) => {
      const element = {
        tag,
        textContent: '',
        removed: false,
        clicks: [] as (() => void)[],
        style: {},
        setAttribute: () => undefined,
        append: () => undefined,
        remove: () => {
          element.removed = true;
        },
        addEventListener: (_type: string, handler: () => void) => element.clicks.push(handler),
      };
      created.push(element);
      return element;
    },
  });
  return created;
}

describe('crash banner', () => {
  it('keeps a crash on screen through a stall raised and recovered after it', () => {
    const created = stubBannerDocument();
    showCrashBanner('stalled', STALL);
    showCrashBanner('boom');
    showCrashBanner('stalled again', STALL);
    dismissCrashBanner(STALL);

    const [root, , message] = created;
    const dismiss = created.filter((element) => element.tag === 'button').at(-1);
    if (root === undefined || message === undefined || dismiss === undefined) {
      throw new Error('the banner drew no root, message or dismiss button');
    }
    expect(root.removed).toBe(false);
    expect(message.textContent).toBe('boom');
    // The player's dismissal takes it down, which also leaves no banner to the next test.
    for (const click of dismiss.clicks) click();
    expect(root.removed).toBe(true);
  });
});
