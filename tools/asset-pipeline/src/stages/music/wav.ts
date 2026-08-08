/**
 * Minimal RIFF WAVE reader for dmrender's output: 16-bit PCM only, the one format the tool writes.
 */
import { viewOf } from '../../decoders/byte-cursor.js';

export interface WavAudio {
  readonly sampleRate: number;
  /** One Float32Array (-1..1) per channel, equal lengths. */
  readonly channels: readonly Float32Array[];
}

const WAVE_FORMAT_PCM = 1;
const BITS_PER_SAMPLE = 16;
const PCM16_SCALE = 32768;

/** Decode a PCM16 wav; throws on any other codec or a malformed container. */
export function decodePcm16Wav(bytes: Uint8Array): WavAudio {
  const view = viewOf(bytes);
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF') {
    throw new Error('wav: not a RIFF container');
  }
  let fmt: { channels: number; sampleRate: number } | undefined;
  let data: Uint8Array | undefined;
  let off = 12; // past RIFF size + WAVE form id
  while (off + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(off, off + 4));
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (body + size > bytes.length) break;
    if (id === 'fmt ') {
      const codec = view.getUint16(body, true);
      const bits = view.getUint16(body + 14, true);
      if (codec !== WAVE_FORMAT_PCM || bits !== BITS_PER_SAMPLE) {
        throw new Error(`wav: unsupported codec ${codec}/${bits}-bit (PCM16 only)`);
      }
      fmt = { channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true) };
    } else if (id === 'data') {
      data = bytes.subarray(body, body + size);
    }
    off = body + size + (size & 1);
  }
  if (fmt === undefined || data === undefined) throw new Error('wav: missing fmt or data chunk');
  const dataView = viewOf(data);
  const frames = Math.floor(data.length / (2 * fmt.channels));
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (const [c, channel] of channels.entries()) {
    for (let i = 0; i < frames; i++) {
      channel[i] = dataView.getInt16((i * fmt.channels + c) * 2, true) / PCM16_SCALE;
    }
  }
  return { sampleRate: fmt.sampleRate, channels };
}
