import { describe, expect, it } from 'vitest';
import { createMenuExit } from '../src/view/runtime/menu-exit.js';

const MENU = '?lang=pl';

describe('createMenuExit', () => {
  it('swaps to the menu inside the document, so fullscreen survives the quit', async () => {
    const trace: string[] = [];
    const quit = createMenuExit({
      teardown: () => trace.push('teardown'),
      search: () => MENU,
      swap: async (search, teardown) => {
        trace.push(`swap ${search}`);
        teardown();
      },
      navigate: (search) => trace.push(`navigate ${search}`),
    });

    quit();
    await Promise.resolve();

    expect(trace).toEqual([`swap ${MENU}`, 'teardown']);
  });

  it('starts one handover however many quit paths fire', () => {
    let swaps = 0;
    const quit = createMenuExit({
      teardown: () => undefined,
      search: () => MENU,
      swap: () => {
        swaps += 1;
        return new Promise(() => undefined);
      },
      navigate: () => undefined,
    });

    quit();
    quit();

    expect(swaps).toBe(1);
  });

  it('still reaches the menu by navigating when the handover fails', async () => {
    const navigations: string[] = [];
    const quit = createMenuExit({
      teardown: () => undefined,
      search: () => MENU,
      swap: () => Promise.reject(new Error('menu module failed to load')),
      navigate: (search) => navigations.push(search),
    });

    quit();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(navigations).toEqual([MENU]);
  });
});
