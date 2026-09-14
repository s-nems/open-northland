import { jsonFingerprint } from '@open-northland/data';
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
} from '../../src/content/transfer/index.js';

const MAP = { width: 1, height: 1, typeIds: [0] };
const origin = { kind: 'user' } as const;
const handle = () => verifyMapDocuments('island', MAP, { players: [] });
const expected = () => ({ mapId: 'island', fingerprint: handle().fingerprint, provenance: origin });
const wire = (value: unknown) => bytesToBase64(new TextEncoder().encode(JSON.stringify(value)));

describe('verified map documents and bounded transfer', () => {
  it('preserves the exact map/script identity and parsed boot inputs', () => {
    const source = handle();
    const received = decodeMapTransfer(encodeMapTransfer(source, origin), expected());
    expect(received.fingerprint).toBe(jsonFingerprint({ map: MAP, script: { players: [] } }));
    expect(readVerifiedMapDocuments(received)).toEqual(readVerifiedMapDocuments(source));
    expect(() => readVerifiedMapDocuments(received, 'different')).toThrow();
  });
  it('owns both source and returned values; forged handles cannot reach boot', () => {
    const map = structuredClone(MAP);
    const source = verifyMapDocuments('island', map, null);
    map.typeIds[0] = 20;
    const first = readVerifiedMapDocuments(source);
    first.map.typeIds[0] = 10;
    expect(readVerifiedMapDocuments(source).map.typeIds).toEqual([0]);
    expect(readVerifiedMapDocuments(source).script).toBeNull();
    expect(() => readVerifiedMapDocuments({ ...source })).toThrow('Unverified');
  });
  it('rejects an unknown origin, a wrong room, corruption, malformed scripts, and extra envelope keys', () => {
    const blob = encodeMapTransfer(handle(), origin);
    expect(() => encodeMapTransfer(handle(), { kind: 'unknown' })).toThrow();
    expect(() => decodeMapTransfer(blob, { ...expected(), provenance: { kind: 'unknown' } })).toThrow();
    expect(() => decodeMapTransfer(blob, { ...expected(), mapId: 'other' })).toThrow();
    expect(() => decodeMapTransfer(blob, { ...expected(), fingerprint: 'wrong' })).toThrow();
    for (const value of [
      null,
      { version: 2, mapId: 'island', map: MAP, script: null },
      { version: 1, mapId: 'island', map: MAP, script: { players: 'bad' } },
      { version: 1, mapId: 'island', map: MAP, script: null, extra: true },
    ]) {
      expect(() => decodeMapTransfer(wire(value), expected())).toThrow();
    }
    expect(() => decodeMapTransfer('not base64', expected())).toThrow();
    expect(() => decodeMapTransfer(bytesToBase64(new Uint8Array([255])), expected())).toThrow();
  });
  it('bounds bytes before decoding or reading a large HTTP body', async () => {
    expect(() =>
      decodeMapTransfer('A'.repeat(Math.ceil(MAX_MAP_TRANSFER_BYTES / 3) * 4 + 4), expected()),
    ).toThrow(/oversized/);
    const fetchImpl: typeof fetch = async () =>
      new Response('{}', { headers: { 'content-length': String(MAX_MAP_DOCUMENT_BYTES + 1) } });
    await expect(loadVerifiedMapDocuments('island', fetchImpl)).rejects.toThrow(/limit/);
  });
  it('can retain a large local document while refusing its relay envelope', () => {
    const source = verifyMapDocuments('island', MAP, {
      misc: [{ key: 'text', values: ['x'.repeat(MAX_MAP_TRANSFER_BYTES)] }],
    });
    expect(source.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(() => encodeMapTransfer(source, origin)).toThrow(/envelope exceeds/);
  });
  it('only 404 means missing; HTTP failures and malformed present data fail closed', async () => {
    expect(
      await loadVerifiedMapDocuments('island', async () => new Response('', { status: 404 })),
    ).toBeNull();
    await expect(
      loadVerifiedMapDocuments('island', async () => new Response('', { status: 500 })),
    ).rejects.toThrow();
    await expect(loadVerifiedMapDocuments('island', async () => new Response('{broken'))).rejects.toThrow();
  });
});
