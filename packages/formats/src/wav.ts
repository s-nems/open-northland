import { viewOf } from './byte-cursor.js';
import { fourCc, riffChildren } from './riff.js';

/** A decoded wav: one float channel per speaker, each sample in -1..1. */
export interface WavPcm {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

/** `WAVE_FORMAT_PCM` and `WAVE_FORMAT_IMA_ADPCM`, the two codecs this decoder reads. */
const FORMAT_PCM = 0x0001;
const FORMAT_IMA_ADPCM = 0x0011;
const PCM_8_BIT = 8;
const PCM_16_BIT = 16;
const IMA_ADPCM_BITS = 4;
/** An unsigned 8-bit PCM sample's silence. */
const PCM_8_MIDPOINT = 128;
const INT16_SCALE = 32768;
/** A wav names a decoded length far past any spoken line only when it is corrupt. */
const MAX_WAV_FRAMES = 1 << 26;
/** The rates and channel counts every Web Audio context must hold in a buffer (W3C Web Audio API,
 *  `createBuffer`); a wav outside them could not play anyway. */
export const MIN_WAV_SAMPLE_RATE = 3000;
export const MAX_WAV_SAMPLE_RATE = 768000;
export const MAX_WAV_CHANNELS = 32;
/** `fmt `'s common fields, through `wBitsPerSample`. */
const FMT_MIN_BYTES = 16;
const FACT_BYTES = 4;

/** Why a file did not decode: no RIFF WAVE, a malformed or truncated header or chunk, or a format
 *  this decoder does not read. */
export type WavDecodeFailure = 'notWav' | 'malformed' | 'unsupported';

export class WavDecodeError extends Error {
  constructor(
    readonly failure: WavDecodeFailure,
    message: string,
  ) {
    super(`wav: ${message}`);
    this.name = 'WavDecodeError';
  }
}

/** IMA ADPCM's step sizes and index moves: the Interactive Multimedia Association's published
 *  "Recommended Practices for Enhancing Digital Audio Compatibility in Multimedia Systems" (1992). */
const IMA_STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97,
  107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724,
  796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026,
  4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500,
  20350, 22385, 24623, 27086, 29794, 32767,
] as const;
const IMA_INDEX_MOVES = [-1, -1, -1, -1, 2, 4, 6, 8] as const;
const IMA_MAX_INDEX = IMA_STEPS.length - 1;
/** Each channel's block header: the first sample (int16), the step index, a reserved byte. */
const IMA_HEADER_BYTES = 4;
/** Channels interleave their nibbles in 4-byte words, 8 samples each. */
const IMA_WORD_BYTES = 4;
const IMA_SAMPLES_PER_WORD = 8;
const NIBBLE_SIGN = 8;
const NIBBLE_MAGNITUDE = 7;

interface WavFormat {
  readonly tag: number;
  readonly channelCount: number;
  readonly sampleRate: number;
  readonly blockAlign: number;
  readonly bits: number;
}

/**
 * Decodes a RIFF WAVE file in 8/16-bit PCM or IMA ADPCM (Microsoft's `0x0011` layout). Throws a
 * {@link WavDecodeError} on a file that is no wav, is malformed or truncated, or uses another codec,
 * rate or channel count; the browser decoders do not all read IMA ADPCM.
 */
export function decodeWav(bytes: Uint8Array): WavPcm {
  if (!isWav(bytes)) throw new WavDecodeError('notWav', 'not a RIFF WAVE file');
  const [riff] = riffChildren(bytes, 0, bytes.length);
  if (riff?.id !== 'RIFF' || riff.form !== 'WAVE')
    throw new WavDecodeError('malformed', 'truncated RIFF body');
  const chunks = riffChildren(bytes, riff.bodyStart, riff.bodyEnd);
  const fmt = chunks.find((chunk) => chunk.id === 'fmt ');
  const data = chunks.find((chunk) => chunk.id === 'data');
  if (fmt === undefined || data === undefined)
    throw new WavDecodeError('malformed', 'missing or truncated fmt or data chunk');
  if (fmt.bodyEnd - fmt.bodyStart < FMT_MIN_BYTES)
    throw new WavDecodeError('malformed', `fmt chunk of ${fmt.bodyEnd - fmt.bodyStart} bytes`);
  const view = viewOf(bytes);
  const format: WavFormat = {
    tag: view.getUint16(fmt.bodyStart, true),
    channelCount: view.getUint16(fmt.bodyStart + 2, true),
    sampleRate: view.getUint32(fmt.bodyStart + 4, true),
    blockAlign: view.getUint16(fmt.bodyStart + 12, true),
    bits: view.getUint16(fmt.bodyStart + 14, true),
  };
  if (format.channelCount === 0 || format.channelCount > MAX_WAV_CHANNELS)
    throw new WavDecodeError('unsupported', `${format.channelCount} channels`);
  if (format.sampleRate < MIN_WAV_SAMPLE_RATE || format.sampleRate > MAX_WAV_SAMPLE_RATE)
    throw new WavDecodeError('unsupported', `sample rate ${format.sampleRate}`);
  const body = bytes.subarray(data.bodyStart, data.bodyEnd);
  const fact = chunks.find((chunk) => chunk.id === 'fact');
  const declared =
    fact === undefined || fact.bodyEnd - fact.bodyStart < FACT_BYTES
      ? undefined
      : view.getUint32(fact.bodyStart, true);
  if (format.tag === FORMAT_PCM && (format.bits === PCM_8_BIT || format.bits === PCM_16_BIT))
    return { sampleRate: format.sampleRate, channels: decodePcm(body, format) };
  if (format.tag === FORMAT_IMA_ADPCM && format.bits === IMA_ADPCM_BITS)
    return { sampleRate: format.sampleRate, channels: decodeImaAdpcm(body, format, declared) };
  throw new WavDecodeError('unsupported', `codec ${format.tag} at ${format.bits} bits`);
}

/** Whether `bytes` starts like a RIFF WAVE file. */
export function isWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && fourCc(bytes, 0) === 'RIFF' && fourCc(bytes, 8) === 'WAVE';
}

function channelsOf(count: number, frames: number): Float32Array[] {
  if (frames > MAX_WAV_FRAMES)
    throw new WavDecodeError('unsupported', `${frames} frames is past the decode limit`);
  return Array.from({ length: count }, () => new Float32Array(frames));
}

function decodePcm(body: Uint8Array, { channelCount, bits }: WavFormat): Float32Array[] {
  const bytesPerSample = bits / PCM_8_BIT;
  const frames = Math.floor(body.length / (bytesPerSample * channelCount));
  const channels = channelsOf(channelCount, frames);
  const view = viewOf(body);
  for (let frame = 0; frame < frames; frame++) {
    for (let c = 0; c < channelCount; c++) {
      const at = (frame * channelCount + c) * bytesPerSample;
      const sample =
        bits === PCM_8_BIT
          ? ((body[at] ?? PCM_8_MIDPOINT) - PCM_8_MIDPOINT) / PCM_8_MIDPOINT
          : view.getInt16(at, true) / INT16_SCALE;
      (channels[c] as Float32Array)[frame] = sample;
    }
  }
  return channels;
}

function decodeImaAdpcm(
  body: Uint8Array,
  { channelCount, blockAlign }: WavFormat,
  declaredFrames: number | undefined,
): Float32Array[] {
  const headerBytes = IMA_HEADER_BYTES * channelCount;
  const wordGroup = IMA_WORD_BYTES * channelCount;
  if (blockAlign <= headerBytes || (blockAlign - headerBytes) % wordGroup !== 0)
    throw new WavDecodeError(
      'malformed',
      `IMA ADPCM block of ${blockAlign} bytes for ${channelCount} channels`,
    );
  const perBlock = 1 + ((blockAlign - headerBytes) / wordGroup) * IMA_SAMPLES_PER_WORD;
  const blocks = Math.floor(body.length / blockAlign);
  const frames = Math.min(blocks * perBlock, declaredFrames ?? Number.POSITIVE_INFINITY);
  const channels = channelsOf(channelCount, frames);
  const view = viewOf(body);
  for (let block = 0; block < blocks; block++) {
    const start = block * blockAlign;
    const first = block * perBlock;
    for (let c = 0; c < channelCount; c++) {
      const out = channels[c] as Float32Array;
      const header = start + c * IMA_HEADER_BYTES;
      let predictor = view.getInt16(header, true);
      let index = Math.min(body[header + 2] ?? 0, IMA_MAX_INDEX);
      if (first < frames) out[first] = predictor / INT16_SCALE;
      for (let s = 0; s < perBlock - 1; s++) {
        const word = Math.floor(s / IMA_SAMPLES_PER_WORD);
        const inWord = s % IMA_SAMPLES_PER_WORD;
        const byte = body[start + headerBytes + word * wordGroup + c * IMA_WORD_BYTES + (inWord >> 1)] ?? 0;
        const nibble = inWord & 1 ? byte >> 4 : byte & 0x0f;
        const step = IMA_STEPS[index] ?? 0;
        let diff = step >> 3;
        if (nibble & 1) diff += step >> 2;
        if (nibble & 2) diff += step >> 1;
        if (nibble & 4) diff += step;
        predictor = Math.max(
          -INT16_SCALE,
          Math.min(INT16_SCALE - 1, predictor + (nibble & NIBBLE_SIGN ? -diff : diff)),
        );
        index = Math.max(
          0,
          Math.min(IMA_MAX_INDEX, index + (IMA_INDEX_MOVES[nibble & NIBBLE_MAGNITUDE] ?? 0)),
        );
        const at = first + 1 + s;
        if (at < frames) out[at] = predictor / INT16_SCALE;
      }
    }
  }
  return channels;
}
