import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { loadRealContent } from '../src/content/real-content.js';

/**
 * `loadRealContent` validates the served `content/ir.json` into a sim `ContentSet`. The loader takes an
 * injectable `fetch` so it can be driven over Node fs here without a dev server; `content/` is gitignored,
 * so assertions that need the real IR skip on a checkout without it (the "must still boot/test without
 * decoded bytes" stance), while the degrade + malformed paths run unconditionally over synthetic responses.
 */

const IR_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../content/ir.json');

/** A `fetch` that serves the real `content/ir.json` off disk for the one URL the loader requests. */
const fsFetch: typeof fetch = (input) => {
  if (String(input) !== '/ir.json') return Promise.resolve(new Response(null, { status: 404 }));
  return Promise.resolve(new Response(readFileSync(IR_PATH, 'utf8')));
};

describe('loadRealContent', () => {
  it.runIf(existsSync(IR_PATH))('parses the full real content set from ir.json', async () => {
    const set = await loadRealContent(fsFetch);
    expect(set).not.toBeNull();
    // Counts verified against the pipeline output on 2026-07-14; a schema skew would drop rows or throw.
    expect(set?.goods).toHaveLength(65);
    expect(set?.buildings).toHaveLength(55);
    expect(set?.jobs).toHaveLength(55);
    expect(set?.tribes).toHaveLength(41);
  });

  it('returns null when content is absent (a bare checkout still boots)', async () => {
    const missing: typeof fetch = () => Promise.resolve(new Response(null, { status: 404 }));
    expect(await loadRealContent(missing)).toBeNull();
  });

  it('throws on a present-but-malformed IR rather than degrading to null', async () => {
    const malformed: typeof fetch = () => Promise.resolve(new Response('{"manifest":{}}'));
    await expect(loadRealContent(malformed)).rejects.toThrow();
  });

  // The no-arg (global-fetch) path is the one the app uses; the injected-fetch tests above bypass its
  // memo, so exercise it directly here: a failed load must not pin null, and success is cached.
  it.runIf(existsSync(IR_PATH))(
    'memoizes the default-fetch path and retries after a failed load',
    async () => {
      let fetches = 0;
      vi.stubGlobal('fetch', () => {
        fetches++;
        return Promise.resolve(new Response(null, { status: 503 }));
      });
      expect(await loadRealContent()).toBeNull();

      const ir = readFileSync(IR_PATH, 'utf8');
      vi.stubGlobal('fetch', () => {
        fetches++;
        return Promise.resolve(new Response(ir));
      });
      const first = await loadRealContent();
      const second = await loadRealContent();
      expect(first).not.toBeNull();
      expect(second).toBe(first); // served from the memo, not re-fetched or re-parsed
      expect(fetches).toBe(2); // the failed load retried once; the third call hit the memo

      vi.unstubAllGlobals();
    },
  );
});
