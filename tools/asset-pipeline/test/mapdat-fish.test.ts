import { describe, expect, it } from 'vitest';
import { decodeFishSwarms, decodeMapDat, encodeMapDat } from '../src/decoders/mapdat/index.js';

const CAPACITY = 500;
const RECORD_SIZE = 12;

function lafm(
  rows: readonly { slot: number; x: number; y: number; count: number; continent: number }[],
  slots = CAPACITY,
): Uint8Array {
  const payload = new Uint8Array(CAPACITY * RECORD_SIZE + 4);
  const view = new DataView(payload.buffer);
  for (const row of rows) {
    const offset = row.slot * RECORD_SIZE;
    view.setUint16(offset, row.x, true);
    view.setUint16(offset + 2, row.y, true);
    view.setUint32(offset + 4, row.count, true);
    view.setUint32(offset + 8, row.continent, true);
  }
  view.setUint32(CAPACITY * RECORD_SIZE, slots, true);
  return payload;
}

function chunk(payload: Uint8Array) {
  const map = decodeMapDat(encodeMapDat([{ tag: 'lafm', version: 2, payload }]));
  return map.chunks[0] as ReturnType<typeof decodeMapDat>['chunks'][number];
}

describe('decodeFishSwarms', () => {
  it('keeps populated slots in authored order and skips empty fixed-table entries', () => {
    const decoded = decodeFishSwarms(
      chunk(
        lafm([
          { slot: 1, x: 44, y: 17, count: 12, continent: 3 },
          { slot: 7, x: 9, y: 81, count: 30, continent: 6 },
        ]),
      ),
    );
    expect(decoded).toEqual([
      { hx: 44, hy: 17, count: 12, continent: 3 },
      { hx: 9, hy: 81, count: 30, continent: 6 },
    ]);
  });

  it('emits no placeholder rows for an empty table', () => {
    expect(decodeFishSwarms(chunk(lafm([])))).toEqual([]);
  });

  it('rejects an over-capacity table and a count above the source cap', () => {
    expect(() => decodeFishSwarms(chunk(lafm([], CAPACITY + 1)))).toThrow(/capacity is 500/);
    expect(() => decodeFishSwarms(chunk(lafm([{ slot: 0, x: 1, y: 2, count: 31, continent: 1 }])))).toThrow(
      /maximum is 30/,
    );
  });
});
