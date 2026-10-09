import { afterEach, describe, expect, it, vi } from 'vitest';

const ran = vi.fn();

vi.mock('../src/routes.js', () => ({
  routeFor: () => ({ id: 'sounds', matches: () => true, load: async () => ran }),
}));
vi.mock('../src/content/original-names.js', () => ({
  originalTribeNameOverlay: () => Promise.reject(new Error('chunk failed')),
}));
vi.mock('../src/view/cursors/theme.js', () => ({ installCursorTheme: () => () => undefined }));
vi.mock('../src/view/navigation-guard.js', () => ({
  guardEntry: () => undefined,
  pushEntryUrl: () => undefined,
  releaseDocument: () => undefined,
}));

// The app tests share a module registry; load the dispatcher fresh so it sees the substitutes above.
vi.resetModules();
const { runEntry } = await import('../src/launch.js');
const { diag } = await import('../src/diag/index.js');

afterEach(() => vi.unstubAllGlobals());

describe('runEntry', () => {
  it('boots the entry with the authored tribe names when the original ones fail to load', async () => {
    class CanvasStub {}
    vi.stubGlobal('HTMLCanvasElement', CanvasStub);
    vi.stubGlobal('document', { documentElement: {}, getElementById: () => new CanvasStub() });
    const warn = vi.spyOn(diag, 'warn').mockImplementation(() => undefined);

    await runEntry(new URLSearchParams('?sounds&lang=pl'));

    expect(ran).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
