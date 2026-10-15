import { describe, expect, it } from 'vitest';
import { decodeWav, isWav, WavDecodeError, type WavDecodeFailure } from '../src/wav.js';

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const u16 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff];
const u32 = (v: number): number[] => [...u16(v & 0xffff), ...u16(v >>> 16)];
const chunk = (id: string, body: readonly number[]): number[] => [...ascii(id), ...u32(body.length), ...body];

const RATE = 22050;

function wav(
  tag: number,
  channels: number,
  blockAlign: number,
  bits: number,
  data: number[],
  fact?: number,
  rate = RATE,
) {
  const fmt = chunk('fmt ', [
    ...u16(tag),
    ...u16(channels),
    ...u32(rate),
    ...u32(0),
    ...u16(blockAlign),
    ...u16(bits),
  ]);
  return riffWave([...fmt, ...(fact === undefined ? [] : chunk('fact', u32(fact))), ...chunk('data', data)]);
}

function riffWave(chunks: readonly number[]): Uint8Array {
  const body = [...ascii('WAVE'), ...chunks];
  return new Uint8Array([...ascii('RIFF'), ...u32(body.length), ...body]);
}

function failureOf(bytes: Uint8Array): WavDecodeFailure | null {
  try {
    decodeWav(bytes);
    return null;
  } catch (error) {
    if (error instanceof WavDecodeError) return error.failure;
    throw error;
  }
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

  it('centres unsigned 8-bit PCM on 128', () => {
    expect(scaled(decodeWav(wav(PCM, 1, 1, 8, [128, 192, 0])).channels[0])).toEqual([0, 16384, -32768]);
  });

  it('decodes stereo IMA ADPCM from per-channel headers and interleaved words', () => {
    // Two headers (sample 0 and 100, step index 0), then one 4-byte word per channel.
    const block = [...u16(0), 0, 0, ...u16(100), 0, 0, 0x04, 0, 0, 0, 0x0c, 0, 0, 0];
    const pcm = decodeWav(wav(IMA_ADPCM, 2, 16, 4, block));
    expect(scaled(pcm.channels[0])).toEqual([0, 7, 8, 9, 9, 9, 9, 9, 9]);
    expect(scaled(pcm.channels[1])).toEqual([100, 93, 94, 95, 95, 95, 95, 95, 95]);
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
    expect(failureOf(wav(0x55, 1, 1, 0, [0]))).toBe('unsupported');
    expect(failureOf(new Uint8Array(ascii('RIFF0000AVI ')))).toBe('notWav');
    expect(isWav(new Uint8Array(ascii('RIFF0000AVI ')))).toBe(false);
    expect(isWav(wav(PCM, 1, 2, 16, []))).toBe(true);
  });

  it('refuses a short fmt chunk, a rate or channel count no context holds, and truncated data', () => {
    expect(
      failureOf(riffWave([...chunk('fmt ', [...u16(PCM), ...u16(1), ...u32(RATE)]), ...chunk('data', [0])])),
    ).toBe('malformed');
    expect(failureOf(wav(PCM, 1, 2, 16, [0, 0], undefined, 0xffffffff))).toBe('unsupported');
    expect(failureOf(wav(PCM, 1, 2, 16, [0, 0], undefined, 1))).toBe('unsupported');
    expect(failureOf(wav(PCM, 33, 66, 16, [0, 0]))).toBe('unsupported');
    const whole = wav(PCM, 1, 2, 16, [0, 0, 0, 0]);
    expect(failureOf(whole.subarray(0, whole.length - 2))).toBe('malformed');
    const cutData = whole.slice();
    new DataView(cutData.buffer).setUint32(cutData.length - 8, 6, true); // two bytes past the file
    expect(failureOf(cutData)).toBe('malformed');
  });
});
