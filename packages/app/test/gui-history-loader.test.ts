import { describe, expect, it, vi } from 'vitest';
import { loadGuiHistory, loadGuiStrings } from '../src/content/gui-gfx.js';
import { diag } from '../src/diag/index.js';

/** The history book loader: `/gui/history/<lang>.json` validated through the data schema, null otherwise. */

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 404, json: async () => body } as unknown as Response;
}

const BOOK = {
  start: 'index',
  pages: {
    index: [{ kind: 'text', style: 'title', text: 'HISTORY', align: 'center' }],
    mythology_00: [{ kind: 'text', style: 'body', text: 'Back', link: 'index' }],
  },
};

describe('loadGuiHistory', () => {
  it('fetches the language book and returns it validated', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return jsonResponse(BOOK);
    }) as unknown as typeof fetch;
    await expect(loadGuiHistory('pol', fetchImpl)).resolves.toEqual(BOOK);
    expect(urls[0]).toContain('/gui/history/pol.json');
  });

  it('degrades to null on a missing file or a malformed book', async () => {
    const missing = vi.fn(async () => jsonResponse(null, false));
    await expect(loadGuiHistory('eng', missing as unknown as typeof fetch)).resolves.toBeNull();
    const warn = vi.spyOn(diag, 'warn').mockImplementation(() => undefined);
    const malformed = vi.fn(async () => jsonResponse({ pages: {} }));
    await expect(loadGuiHistory('eng', malformed as unknown as typeof fetch)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('loadGuiStrings', () => {
  it('asks again after a failed load and keeps a loaded table', async () => {
    const STRINGS = { goods: { '1': 'Wood' } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null, false))
      .mockResolvedValue(jsonResponse(STRINGS));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(loadGuiStrings('retry-lang')).resolves.toBeNull();
      await expect(loadGuiStrings('retry-lang')).resolves.toEqual(STRINGS);
      await expect(loadGuiStrings('retry-lang')).resolves.toEqual(STRINGS);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
