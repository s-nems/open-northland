import { describe, expect, it } from 'vitest';
import { decodeStringListChunk, type MapDatChunk } from '../src/decoders/mapdat/index.js';

describe('decodeStringListChunk', () => {
  /** Builds a raw string-list chunk payload: [u32 count] then per entry [u8 len][bytes][0x00]. */
  const listChunk = (names: string[]): MapDatChunk => {
    const bytes: number[] = [names.length & 0xff, (names.length >>> 8) & 0xff, 0, 0];
    for (const n of names) {
      bytes.push(n.length);
      for (let i = 0; i < n.length; i++) bytes.push(n.charCodeAt(i) & 0xff);
      bytes.push(0);
    }
    const payload = Uint8Array.from(bytes);
    return {
      tag: 'eapd',
      id: 0,
      version: 1,
      length: payload.length,
      depth: 0,
      checksum: 0,
      payloadOffset: 0,
      payload,
    };
  };

  it('decodes the count-prefixed length-prefixed name list', () => {
    expect(decodeStringListChunk(listChunk(['meadow 01', 'block water 00 00 00', '']))).toEqual([
      'meadow 01',
      'block water 00 00 00',
      '',
    ]);
  });

  it('round-trips an empty list', () => {
    expect(decodeStringListChunk(listChunk([]))).toEqual([]);
  });

  it('throws on a count that overruns the payload', () => {
    const chunk = listChunk(['abc']);
    const truncated = { ...chunk, payload: chunk.payload.slice(0, chunk.payload.length - 2) };
    expect(() => decodeStringListChunk(truncated)).toThrow(/overruns|truncated/);
  });

  it('throws on a payload too short for the header', () => {
    const chunk = { ...listChunk([]), payload: Uint8Array.from([1, 0]) };
    expect(() => decodeStringListChunk(chunk)).toThrow(/too short/);
  });
});
