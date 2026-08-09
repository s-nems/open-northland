import { describe, expect, it } from 'vitest';
import { decodeBankName, decodeRejectedRegions } from '../src/decoders/dls.js';

/**
 * Synthetic-fixture coverage for the DLS slices the music stage reads: the bank-level name and
 * loop-vs-wave validation with the pool-table indirection.
 */

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}

function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function chunk(id: string, body: readonly number[]): number[] {
  const padded = body.length & 1 ? [...body, 0] : [...body];
  return [...ascii(id), ...u32(body.length), ...padded];
}

function list(listId: string, body: readonly number[]): number[] {
  return chunk('LIST', [...ascii(listId), ...body]);
}

function riff(formId: string, body: readonly number[]): Uint8Array {
  return new Uint8Array(chunk('RIFF', [...ascii(formId), ...body]));
}

const BITS_16 = 16;

function fmtChunk(): number[] {
  return chunk('fmt ', [...u16(1), ...u16(1), ...u32(22050), ...u32(44100), ...u16(2), ...u16(BITS_16)]);
}

function wave(frames: number): number[] {
  return list('wave', [...fmtChunk(), ...chunk('data', new Array<number>(frames * 2).fill(0))]);
}

/** `WSMPL` with one `WLOOP`; cbSize 20, loop record {size, type, start, length}. */
function wsmpChunk(loop?: { start: number; length: number }): number[] {
  return chunk('wsmp', [
    ...u32(20),
    ...u16(60), // usUnityNote
    ...u16(0), // sFineTune
    ...u32(0), // lGain
    ...u32(0), // fulOptions
    ...u32(loop === undefined ? 0 : 1),
    ...(loop === undefined ? [] : [...u32(16), ...u32(0), ...u32(loop.start), ...u32(loop.length)]),
  ]);
}

function region(keys: [number, number], cue: number, loop?: { start: number; length: number }): number[] {
  return list('rgn2', [
    ...chunk('rgnh', [...u16(keys[0]), ...u16(keys[1]), ...u16(0), ...u16(127), ...u16(0), ...u16(0)]),
    ...wsmpChunk(loop),
    ...chunk('wlnk', [...u16(0), ...u16(0), ...u32(0), ...u32(cue)]),
  ]);
}

/** `INSH`: region count, then the locale (ulBank with LSB low bits and MSB at bit 8, ulInstrument). */
function instrument(bankLo: number, bankHi: number, patch: number, regions: readonly number[][]): number[] {
  return list('ins ', [
    ...chunk('insh', [...u32(regions.length), ...u32(bankLo | (bankHi << 8)), ...u32(patch)]),
    ...list('lrgn', regions.flat()),
  ]);
}

function dlsFile(instruments: readonly number[][], waves: readonly number[][]): Uint8Array {
  const waveBytes = waves.flat();
  const offsets: number[] = [];
  let at = 0;
  for (const w of waves) {
    offsets.push(at);
    at += w.length;
  }
  return riff('DLS ', [
    ...list('INFO', chunk('INAM', ascii('Test Bank\0'))),
    ...list('lins', instruments.flat()),
    ...chunk('ptbl', [...u32(8), ...u32(offsets.length), ...offsets.flatMap((o) => u32(o))]),
    ...list('wvpl', waveBytes),
  ]);
}

describe('decodeBankName', () => {
  it('reads the collection-level INAM', () => {
    expect(decodeBankName(dlsFile([], []))).toBe('Test Bank');
  });

  it('returns undefined without an INFO list', () => {
    expect(decodeBankName(riff('DLS ', chunk('colh', u32(0))))).toBeUndefined();
  });
});

describe('decodeRejectedRegions', () => {
  it('accepts a loop that ends exactly at the wave end and rejects one past it', () => {
    const bytes = dlsFile(
      [
        instrument(1, 0, 72, [
          region([36, 68], 0, { start: 50, length: 50 }),
          region([69, 96], 0, { start: 50, length: 51 }),
        ]),
      ],
      [wave(100)],
    );
    expect(decodeRejectedRegions(bytes)).toEqual([
      { bankLo: 1, bankHi: 0, patch: 72, ranges: [{ lo: 69, hi: 96 }] },
    ]);
  });

  it('treats loopless regions as valid', () => {
    const bytes = dlsFile([instrument(0, 0, 0, [region([0, 127], 0)])], [wave(10)]);
    expect(decodeRejectedRegions(bytes)).toEqual([]);
  });

  it('scopes rejection to the broken instrument, not the whole bank', () => {
    // Two instruments share the wave; only the second authors a loop past it.
    const bytes = dlsFile(
      [
        instrument(0, 0, 10, [region([0, 127], 0, { start: 0, length: 100 })]),
        instrument(0, 0, 20, [region([0, 127], 0, { start: 0, length: 101 })]),
      ],
      [wave(100)],
    );
    expect(decodeRejectedRegions(bytes)).toEqual([
      { bankLo: 0, bankHi: 0, patch: 20, ranges: [{ lo: 0, hi: 127 }] },
    ]);
  });

  it('resolves waves through the pool table, not file order assumptions', () => {
    // Two waves; the region's cue 1 points at the second (short) wave.
    const bytes = dlsFile(
      [instrument(0, 0, 0, [region([60, 72], 1, { start: 0, length: 150 })])],
      [wave(200), wave(100)],
    );
    expect(decodeRejectedRegions(bytes)).toEqual([
      { bankLo: 0, bankHi: 0, patch: 0, ranges: [{ lo: 60, hi: 72 }] },
    ]);
  });
});
