import { gzipSync } from 'node:zlib';
import { mapDocumentsFingerprint } from '@open-northland/data';
import { bytesToBase64 } from '@open-northland/net-client';
import { describe, expect, it } from 'vitest';
import {
  decodeMapTransfer,
  encodeMapTransfer,
  loadVerifiedMapDocuments,
  MAX_MAP_DOCUMENT_BYTES,
  MAX_MAP_TRANSFER_BYTES,
  readVerifiedMapDocuments,
  verifyMapDocuments,
} from '../../../src/content/transfer/index.js';

const MAP = { width: 1, height: 1, typeIds: [0] };
const origin = { kind: 'user' } as const;
const handle = () => verifyMapDocuments('island', MAP, { players: [] });
const expected = () => ({ mapId: 'island', fingerprint: handle().fingerprint, provenance: origin });
const wire = (value: unknown) => bytesToBase64(gzipSync(JSON.stringify(value)));
/** The envelope a room sends for the island map, with `change` applied. */
const envelope = (change: Record<string, unknown> = {}) => ({
  version: 3,
  mapId: 'island',
  map: MAP,
  script: { players: [] },
  strings: null,
  briefing: null,
  meta: null,
  ...change,
});
const WORDS = {
  strings: { pol: { '7': 'Wyspa' } },
  briefing: { texts: { pol: { '0': [{ kind: 'blank', lines: 1 }] } } },
  meta: { name: { pol: 'Wyspa' } },
};
/** A run of text gzip cannot shrink, so its envelope stays as large as the text. */
function incompressibleText(length: number): string {
  const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const LCG_MULTIPLIER = 1_664_525;
  const LCG_INCREMENT = 1_013_904_223;
  const LCG_HIGH_BITS = 24;
  const codes = new Uint8Array(length);
  let state = 1;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    codes[i] = LETTERS.charCodeAt((state >>> LCG_HIGH_BITS) % LETTERS.length);
  }
  return new TextDecoder().decode(codes);
}

describe('verified map documents and bounded transfer', () => {
  it('preserves the exact map/script identity and parsed boot inputs', async () => {
    const source = handle();
    const received = await decodeMapTransfer(await encodeMapTransfer(source, origin), expected());
    expect(received.fingerprint).toBe(mapDocumentsFingerprint({ map: MAP, script: { players: [] } }));
    expect(readVerifiedMapDocuments(received)).toEqual(readVerifiedMapDocuments(source));
    expect(() => readVerifiedMapDocuments(received, 'different')).toThrow();
  });
  it("carries the map's strings, briefing and meta outside its fingerprint", async () => {
    await expect(decodeMapTransfer(wire(envelope()), expected())).resolves.toMatchObject({ mapId: 'island' });
    const source = verifyMapDocuments('island', MAP, { players: [] }, WORDS);
    expect(source.fingerprint).toBe(handle().fingerprint);
    const received = await decodeMapTransfer(await encodeMapTransfer(source, origin), expected());
    expect(readVerifiedMapDocuments(received)).toMatchObject(WORDS);
    expect(readVerifiedMapDocuments(handle())).toMatchObject({ strings: null, briefing: null, meta: null });
  });
  it('owns both source and returned values; forged handles cannot reach boot', () => {
    const map = structuredClone(MAP);
    const source = verifyMapDocuments('island', map, null);
    map.typeIds[0] = 20;
    const first = readVerifiedMapDocuments(source);
    expect(() => {
      first.map.typeIds[0] = 10;
    }).toThrow(TypeError);
    expect(readVerifiedMapDocuments(source).map.typeIds).toEqual([0]);
    expect(readVerifiedMapDocuments(source).script).toBeNull();
    expect(() => readVerifiedMapDocuments({ ...source })).toThrow('Unverified');
  });
  it('travels as a gzip stream far smaller than the documents it carries', async () => {
    const typeIds = Array.from({ length: 10_000 }, () => 0);
    const source = verifyMapDocuments('island', { width: 100, height: 100, typeIds }, null);
    const blob = await encodeMapTransfer(source, origin);
    const compressed = Uint8Array.from(atob(blob), (char) => char.charCodeAt(0));
    expect([compressed[0], compressed[1]]).toEqual([0x1f, 0x8b]);
    expect(blob.length * 10).toBeLessThan(JSON.stringify(typeIds).length);
  });
  it('rejects an unknown origin, a wrong room, corruption, malformed scripts, and extra envelope keys', async () => {
    const blob = await encodeMapTransfer(handle(), origin);
    await expect(encodeMapTransfer(handle(), { kind: 'unknown' })).rejects.toThrow();
    await expect(
      decodeMapTransfer(blob, { ...expected(), provenance: { kind: 'unknown' } }),
    ).rejects.toThrow();
    await expect(decodeMapTransfer(blob, { ...expected(), mapId: 'other' })).rejects.toThrow();
    await expect(decodeMapTransfer(blob, { ...expected(), fingerprint: 'wrong' })).rejects.toThrow();
    for (const value of [
      null,
      envelope({ version: 2 }),
      envelope({ script: { players: 'bad' } }),
      envelope({ extra: true }),
      envelope({ strings: { pol: 'not a table' } }),
      { version: 3, mapId: 'island', map: MAP, script: { players: [] } },
    ]) {
      await expect(decodeMapTransfer(wire(value), expected())).rejects.toThrow();
    }
    const plain = bytesToBase64(new TextEncoder().encode(JSON.stringify(envelope())));
    await expect(decodeMapTransfer(plain, expected())).rejects.toThrow(/not gzip/);
    await expect(decodeMapTransfer('not base64', expected())).rejects.toThrow();
    await expect(decodeMapTransfer(bytesToBase64(new Uint8Array([255])), expected())).rejects.toThrow();
  });
  it('bounds bytes before decoding, inflating or reading a large HTTP body', async () => {
    await expect(
      decodeMapTransfer('A'.repeat(Math.ceil(MAX_MAP_TRANSFER_BYTES / 3) * 4 + 4), expected()),
    ).rejects.toThrow(/oversized/);
    const bomb = bytesToBase64(gzipSync(Buffer.alloc(MAX_MAP_DOCUMENT_BYTES * 2)));
    await expect(decodeMapTransfer(bomb, expected())).rejects.toThrow(/inflates past/);
    const fetchImpl: typeof fetch = async () =>
      new Response('{}', { headers: { 'content-length': String(MAX_MAP_DOCUMENT_BYTES + 1) } });
    await expect(loadVerifiedMapDocuments('island', fetchImpl)).rejects.toThrow(/limit/);
  });
  it('can retain a large local document while refusing its relay envelope', async () => {
    const source = verifyMapDocuments('island', MAP, {
      misc: [
        { key: 'text', values: [incompressibleText(MAX_MAP_TRANSFER_BYTES + MAX_MAP_TRANSFER_BYTES / 2)] },
      ],
    });
    expect(source.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    await expect(encodeMapTransfer(source, origin)).rejects.toThrow(/envelope exceeds/);
  }, 30_000);
  it('only 404 means missing; HTTP failures and malformed present data fail closed', async () => {
    expect(
      await loadVerifiedMapDocuments('island', async () => new Response('', { status: 404 })),
    ).toBeNull();
    await expect(
      loadVerifiedMapDocuments('island', async () => new Response('', { status: 500 })),
    ).rejects.toThrow();
    await expect(loadVerifiedMapDocuments('island', async () => new Response('{broken'))).rejects.toThrow();
  });
  it('plays a local text document that is not its schema as absent', async () => {
    const files: Record<string, unknown> = {
      '/maps/island.json': MAP,
      '/maps/island.script.json': { players: [] },
      '/maps/island.strings.json': { pol: 'not a table' },
      '/maps/island.meta.json': WORDS.meta,
    };
    const local = await loadVerifiedMapDocuments('island', async (path) =>
      Object.hasOwn(files, String(path))
        ? new Response(JSON.stringify(files[String(path)]))
        : new Response('', { status: 404 }),
    );
    if (local === null) throw new Error('no local map');
    expect(readVerifiedMapDocuments(local)).toMatchObject({
      strings: null,
      briefing: null,
      meta: WORDS.meta,
    });
  });
});
