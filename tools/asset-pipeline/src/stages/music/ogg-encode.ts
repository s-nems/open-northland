import { createOggEncoder } from 'wasm-media-encoders';

/** Interleave planar float channels, trim to `frames`, encode to ogg/vorbis bytes. */
export async function encodeOgg(
  channels: readonly Float32Array[],
  frames: number,
  sampleRate: number,
  vbrQuality: number,
): Promise<Uint8Array> {
  const [left, right] = channels;
  if (left === undefined || right === undefined) throw new Error('encode expects stereo channels');
  // A non-positive count would skip the loop and emit a headerless-sounding, zero-audio file that the
  // manifest would still advertise.
  if (!(frames > 0)) throw new Error(`encode expects a positive frame count, got ${frames}`);
  const encoder = await createOggEncoder();
  encoder.configure({ channels: 2, sampleRate, vbrQuality });
  const parts: Uint8Array[] = [];
  // Encode in bounded slices so the wasm side never sees the whole track at once. Each returned
  // chunk aliases the encoder's wasm memory and is only valid until the next encode/finalize call,
  // so it must be copied before being kept.
  const SLICE_FRAMES = 1 << 20;
  for (let start = 0; start < frames; start += SLICE_FRAMES) {
    const end = Math.min(frames, start + SLICE_FRAMES);
    parts.push(encoder.encode([left.subarray(start, end), right.subarray(start, end)]).slice());
  }
  parts.push(encoder.finalize().slice());
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
