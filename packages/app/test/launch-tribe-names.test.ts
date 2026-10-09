import { afterEach, describe, expect, it, vi } from 'vitest';
import * as originalNames from '../src/content/original-names.js';
import { diag } from '../src/diag/index.js';
import { runEntry } from '../src/launch.js';
import * as routes from '../src/routes.js';
import * as cursors from '../src/view/cursors/theme.js';
import * as navigation from '../src/view/navigation-guard.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('runEntry', () => {
  it('boots the entry with the authored tribe names when the original ones fail to load', async () => {
    const ran = vi.fn();
    vi.spyOn(routes, 'routeFor').mockReturnValue({
      id: 'sounds',
      matches: () => true,
      load: async () => ran,
    });
    vi.spyOn(originalNames, 'originalTribeNameOverlay').mockRejectedValue(new Error('chunk failed'));
    vi.spyOn(cursors, 'installCursorTheme').mockReturnValue(() => undefined);
    vi.spyOn(navigation, 'guardEntry').mockImplementation(() => undefined);
    class CanvasStub {}
    vi.stubGlobal('HTMLCanvasElement', CanvasStub);
    vi.stubGlobal('document', { documentElement: {}, getElementById: () => new CanvasStub() });
    const warn = vi.spyOn(diag, 'warn').mockImplementation(() => undefined);

    await runEntry(new URLSearchParams('?sounds&lang=pl'));

    expect(ran).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });
});
