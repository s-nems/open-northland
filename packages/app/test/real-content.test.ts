import { describe, expect, it } from 'vitest';
import { loadRealContent } from '../src/content/real-content.js';

/**
 * `loadRealContent` validates the served `content/ir.json` into a sim `ContentSet`. The degrade +
 * malformed paths run here unconditionally over synthetic responses (the "must still boot/test
 * without decoded bytes" stance); the full-parse and memoization assertions over the real IR live
 * in the real-content suite (`test/content/real-content-loader.test.ts`).
 */

describe('loadRealContent', () => {
  it('returns null when content is absent (a bare checkout still boots)', async () => {
    const missing: typeof fetch = () => Promise.resolve(new Response(null, { status: 404 }));
    expect(await loadRealContent(missing)).toBeNull();
  });

  it('throws on a present-but-malformed IR rather than degrading to null', async () => {
    const malformed: typeof fetch = () => Promise.resolve(new Response('{"manifest":{}}'));
    await expect(loadRealContent(malformed)).rejects.toThrow();
  });
});
