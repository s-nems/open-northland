import { describe, expect, it } from 'vitest';
import { decodeWav, isWav } from '../src/wav.js';

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const u16 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff];
const u32 = (v: number): number[] => [...u16(v & 0xffff), ...u16(v >>> 16)];
const chunk = (id: string, body: readonly number[]): number[] => [...ascii(id), ...u32(body.length), ...body];

function wav(tag: number, channels: number, blockAlign: number, bits: number, data: number[], fact?: number) {
  const fmt = chunk('fmt ', [
    ...u16(tag),
    ...u16(channels),
    ...u32(22050),
    ...u32(0),
    ...u16(blockAlign),
    ...u16(bits),
  ]);
  const body = [
    ...ascii('WAVE'),
    ...fmt,
    ...(fact === undefined ? [] : chunk('fact', u32(fact))),
    ...chunk('data', data),
  ];
  return new Uint8Array([...ascii('RIFF'), ...u32(body.length), ...body]);
}

const PCM = 1;
const IMA_ADPCM = 0x11;
const scaled = (channel: Float32Array | undefined): number[] => [...(channel ?? [])].map((s) => s * 32768);

describe('decodeWav', () => {
  it('splits interleaved 16-bit PCM into channels', () => {
    const pcm = decodeWav(wav(PCM, 2, 4, 16, [...u16(1000), ...u16(-2000 & 0xffff), ...u16(3), ...u16(4)]));
    expect(pcm.sampleRate).toBe(22050);
    expect(scaled(pcm.channels[0])).toEqual([1000, 3]);
    expect(scaled(pcm.channels[1])).toEqual([-2000, 4]);
  });

  it('decodes an IMA ADPCM block from its header sample and nibbles, cut to the fact length', () => {
    // Header: first sample 0, step index 0; one 4-byte word of nibbles 4,0,0,0,0,0,0,0.
    const block = [...u16(0), 0, 0, 0x04, 0, 0, 0];
    expect(scaled(decodeWav(wav(IMA_ADPCM, 1, 8, 4, block)).channels[0])).toEqual([
      0, 7, 8, 9, 9, 9, 9, 9, 9,
    ]);
    expect(scaled(decodeWav(wav(IMA_ADPCM, 1, 8, 4, block, 5)).channels[0])).toEqual([0, 7, 8, 9, 9]);
  });

  it('refuses another codec and a file that is no wav', () => {
    expect(() => decodeWav(wav(0x55, 1, 1, 0, [0]))).toThrow(/unsupported codec/);
    expect(isWav(new Uint8Array(ascii('RIFF0000AVI ')))).toBe(false);
    expect(isWav(wav(PCM, 1, 2, 16, []))).toBe(true);
  });
});
