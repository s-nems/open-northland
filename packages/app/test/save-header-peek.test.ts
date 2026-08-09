import { describe, expect, it } from 'vitest';
import { compressSaveText } from '../src/view/runtime/save-load/codec.js';
import { peekSaveHeader } from '../src/view/runtime/save-load/header-peek.js';

/** A save-shaped document whose sections make the compressed file big enough to truncate. */
function saveText(header: Record<string, unknown>): string {
  const noise = Array.from({ length: 30000 }, (_, i) => (i * 7919) % 1000);
  return JSON.stringify({ header, sections: [{ id: 'entities', alive: noise }] });
}

const V2_HEADER = {
  kind: 'open-northland-save',
  formatVersion: 2,
  irVersion: 3,
  contentRevision: 0,
  mapId: 'twierdza',
  mapFingerprint: 'aa11',
  entry: '?map=twierdza&player=2',
  seed: 7,
  tick: 360,
};

describe('peekSaveHeader', () => {
  it('reads the header from complete gzip bytes and from a truncated prefix', async () => {
    const bytes = await compressSaveText(saveText(V2_HEADER));
    const expected = { mapId: 'twierdza', tick: 360, entry: '?map=twierdza&player=2' };
    await expect(peekSaveHeader(bytes)).resolves.toEqual(expected);
    expect(bytes.byteLength).toBeGreaterThan(2048);
    await expect(peekSaveHeader(bytes.slice(0, 2048))).resolves.toEqual(expected);
  });

  it('reads a plain-JSON prefix, defaulting the entry a v1 header predates', async () => {
    const { entry: _none, ...v1Header } = { ...V2_HEADER, formatVersion: 1 };
    const text = saveText(v1Header);
    const prefix = new TextEncoder().encode(text.slice(0, 512));
    await expect(peekSaveHeader(prefix)).resolves.toEqual({
      mapId: 'twierdza',
      tick: 360,
      entry: null,
    });
  });

  it('returns null for foreign files', async () => {
    await expect(peekSaveHeader(new TextEncoder().encode('not json at all'))).resolves.toBeNull();
    await expect(
      peekSaveHeader(new TextEncoder().encode('{"header":{"kind":"zip"},"sections":[]}')),
    ).resolves.toBeNull();
    const noHeader = new TextEncoder().encode('{"sections":[]}');
    await expect(peekSaveHeader(noHeader)).resolves.toBeNull();
    // A gzip magic with garbage behind it decodes to nothing peekable.
    await expect(peekSaveHeader(new Uint8Array([0x1f, 0x8b, 0x00, 0x01, 0x02]))).resolves.toBeNull();
  });
});
