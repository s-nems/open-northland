import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { loadRealContent } from '../src/content/real-content.js';

/**
 * `loadRealContent` validates the served `content/ir.json` into a sim `ContentSet`. The degrade +
 * malformed paths run here unconditionally over synthetic responses (the "must still boot/test
 * without decoded bytes" stance); the full-parse and memoization assertions over the real IR live
 * in the real-content suite (`test/content/real-content-loader.test.ts`).
 */

/** An empty IR document carrying every lane, as the pipeline writes it. */
function generatedIr(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { mod: 'test' } },
    goods: [],
    jobs: [],
    buildings: [],
  });
}

/** Serves the generated document under `version`. */
function irFetchStamped(version: number): typeof fetch {
  const generated = generatedIr();
  const body = JSON.stringify({ ...generated, manifest: { ...generated.manifest, version } });
  return () => Promise.resolve(new Response(body));
}

describe('loadRealContent', () => {
  it('returns null when content is absent (a bare checkout still boots)', async () => {
    const missing: typeof fetch = () => Promise.resolve(new Response(null, { status: 404 }));
    expect(await loadRealContent(missing)).toBeNull();
  });

  it('throws on a present-but-malformed IR rather than degrading to null', async () => {
    const malformed: typeof fetch = () => Promise.resolve(new Response('{"manifest":{}}'));
    await expect(loadRealContent(malformed)).rejects.toThrow();
  });

  it('parses an IR stamped with the current version', async () => {
    expect((await loadRealContent(irFetchStamped(IR_VERSION)))?.goods).toEqual([]);
  });

  it('rejects that same document under another stamp instead of degrading to null', async () => {
    await expect(loadRealContent(irFetchStamped(IR_VERSION + 1))).rejects.toThrow('IR version mismatch');
  });

  it('rejects a document another build generated without a lane instead of defaulting it', async () => {
    const { tribes: _tribes, ...older } = generatedIr();
    const fetchOlder: typeof fetch = () => Promise.resolve(new Response(JSON.stringify(older)));
    await expect(loadRealContent(fetchOlder)).rejects.toThrow('generated content lacks tribes');
  });
});
