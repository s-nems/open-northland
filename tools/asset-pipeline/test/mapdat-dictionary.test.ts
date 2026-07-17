import { describe, expect, it } from 'vitest';
import { decodeStringListChunk, type MapDatChunk } from '../src/decoders/mapdat/index.js';
import { encodeStringList } from './fixtures/mapdat.js';

describe('decodeStringListChunk', () => {
  /** Wraps an {@link encodeStringList} payload in the chunk envelope the decoder takes. */
  const listChunk = (names: string[]): MapDatChunk => {
    const payload = encodeStringList(names);
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
