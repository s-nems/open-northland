import { describe, expect, it } from 'vitest';
import { encodeOgg } from '../src/stages/music/ogg-encode.js';

/**
 * Structural validation of the encoded ogg container. The encoder returns chunks that alias its
 * wasm memory; keeping them uncopied assembles a file whose pages are overwritten garbage, which
 * this page walk catches (out-of-order sequence numbers, broken capture patterns).
 */

const SAMPLE_RATE = 44100;
const VBR_QUALITY = 3;
const OGG_EOS_FLAG = 0x04;

interface OggPage {
  readonly sequence: number;
  readonly headerType: number;
}

/** Walk every ogg page; throws when a page boundary lacks the `OggS` capture pattern. */
function walkOggPages(bytes: Uint8Array): OggPage[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pages: OggPage[] = [];
  let at = 0;
  while (at < bytes.length) {
    const capture = String.fromCharCode(...bytes.subarray(at, at + 4));
    if (capture !== 'OggS') throw new Error(`no OggS capture pattern at byte ${at}`);
    const headerType = view.getUint8(at + 5);
    const sequence = view.getUint32(at + 18, true);
    const segmentCount = view.getUint8(at + 26);
    let bodyLength = 0;
    for (let i = 0; i < segmentCount; i++) bodyLength += view.getUint8(at + 27 + i);
    pages.push({ sequence, headerType });
    at += 27 + segmentCount + bodyLength;
  }
  if (at !== bytes.length) throw new Error(`page walk overran the file: ${at} > ${bytes.length}`);
  return pages;
}

function stereoSine(seconds: number): [Float32Array, Float32Array] {
  const frames = seconds * SAMPLE_RATE;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) * 0.5;
    right[i] = Math.sin((2 * Math.PI * 660 * i) / SAMPLE_RATE) * 0.5;
  }
  return [left, right];
}

describe('encodeOgg', () => {
  it('emits a well-formed ogg stream: contiguous page sequence from 0, EOS on the last page', async () => {
    const [left, right] = stereoSine(2);
    const bytes = await encodeOgg([left, right], left.length, SAMPLE_RATE, VBR_QUALITY);
    const pages = walkOggPages(bytes);
    // At minimum the id header page, the comment/setup page, and one audio page.
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.map((p) => p.sequence)).toEqual(pages.map((_, i) => i));
    expect((pages.at(-1)?.headerType ?? 0) & OGG_EOS_FLAG).toBe(OGG_EOS_FLAG);
  });

  it('rejects non-stereo input', async () => {
    await expect(encodeOgg([new Float32Array(8)], 8, SAMPLE_RATE, VBR_QUALITY)).rejects.toThrow('stereo');
  });
});
