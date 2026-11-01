import { Inflate } from 'fflate';
import { MapImportError } from '../errors.js';

/** A small compressed chunk bounds inflation overshoot before `onChunk` checks actual output.
 * DEFLATE's maximum expansion is bounded by its 258-byte length codes; 512 input bytes cannot
 * allocate an entire forged multi-megabyte entry before this check runs. */
const INFLATE_CHUNK_BYTES = 512;
/** Resource policy, not a DEFLATE validity rule. Stored blocks can wait for 65535 input bytes before
 * producing output. Twice that allowance bounds decoder retention after an early final block or
 * a long sequence of empty blocks; unusual valid streams without progress may exceed this budget. */
const MAX_INFLATE_NO_OUTPUT_BYTES = 128 * 1024;

/** Inflates one raw-deflate stream in small pushes; a throwing `onChunk` stops it mid-stream. */
export function inflateBounded(
  compressed: Uint8Array,
  name: string,
  onChunk: (chunk: Uint8Array) => void,
): void {
  let produced = 0;
  const inflater = new Inflate((chunk) => {
    produced += chunk.length;
    onChunk(chunk);
  });
  let noOutputBytes = 0;
  for (let at = 0; at < compressed.length; at += INFLATE_CHUNK_BYTES) {
    const end = Math.min(at + INFLATE_CHUNK_BYTES, compressed.length);
    if (noOutputBytes + end - at > MAX_INFLATE_NO_OUTPUT_BYTES)
      throw new MapImportError('too-large', `${name}: compressed stream exceeds the no-output budget`);
    const before = produced;
    inflater.push(compressed.subarray(at, end), end === compressed.length);
    noOutputBytes = produced === before ? noOutputBytes + end - at : 0;
  }
  if (compressed.length === 0) inflater.push(compressed, true);
}
