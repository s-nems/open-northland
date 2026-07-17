import { describe, expect, it } from 'vitest';
import { decodePalette, encodePalette } from '../src/decoders/palette.js';
import { expandToRgba } from '../src/decoders/pcx.js';
import { rampPalette as rampRgb } from './fixtures/palette.js';

/**
 * Standalone `CPalette` (id 0x3F6) decoder tests. No copyrighted fixtures: we synthesize palettes in
 * memory with the faithful `encodePalette`, then assert `decodePalette` recovers the RGB triples and
 * version. A couple of cases hand-build bytes to pin the storable header and the on-disk `[B,G,R,_]`
 * order, and one feeds the result into `expandToRgba` to prove the shape matches the `.pcx` palette.
 */

describe('decodePalette', () => {
  it('round-trips RGB triples and the version word', () => {
    const rgb = rampRgb();
    const decoded = decodePalette(encodePalette({ rgb, version: 3 }));
    expect(decoded.version).toBe(3);
    expect(decoded.rgb).toEqual(rgb);
  });

  it('defaults the version to 0 when encoding', () => {
    const decoded = decodePalette(encodePalette({ rgb: rampRgb() }));
    expect(decoded.version).toBe(0);
  });

  it('reorders the on-disk [B,G,R,_] body into [R,G,B] triples (hand-built bytes)', () => {
    // Header: id 0x3F6, version 0. Entry 0 on disk = B=0x11 G=0x22 R=0x33 pad=0xFF.
    const buf = new Uint8Array(8 + 0x400);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x3f6, true);
    view.setUint32(4, 0, true);
    buf[8] = 0x11; // B
    buf[9] = 0x22; // G
    buf[10] = 0x33; // R
    buf[11] = 0xff; // pad (ignored)
    const decoded = decodePalette(buf);
    expect([...decoded.rgb.subarray(0, 3)]).toEqual([0x33, 0x22, 0x11]); // R,G,B
  });

  it('ignores trailing bytes past the 0x400-byte body', () => {
    const padded = new Uint8Array(8 + 0x400 + 16);
    const view = new DataView(padded.buffer);
    view.setUint32(0, 0x3f6, true);
    expect(() => decodePalette(padded)).not.toThrow();
  });

  it('feeds straight into expandToRgba like the .pcx palette', () => {
    const rgb = rampRgb();
    const palette = decodePalette(encodePalette({ rgb })).rgb;
    const image = { width: 2, height: 1, pixels: Uint8Array.from([0, 5]), palette };
    const { rgba } = expandToRgba(image);
    // index 0 -> (0, 255, 0); index 5 -> (5, 250, 35); both alpha 255
    expect([...rgba]).toEqual([0, 255, 0, 255, 5, 250, 35, 255]);
  });

  it('throws a palette-prefixed error on a buffer too short for header + body', () => {
    expect(() => decodePalette(new Uint8Array(8 + 0x400 - 1))).toThrow(
      /palette: buffer of \d+ bytes is too short/,
    );
  });

  it('throws when the storable id is not 0x3F6', () => {
    const buf = new Uint8Array(8 + 0x400);
    new DataView(buf.buffer).setUint32(0, 0x3e9, true); // CMemory id
    expect(() => decodePalette(buf)).toThrow(/storable id is not CPalette/);
  });
});

describe('encodePalette', () => {
  it('writes the 8-byte storable header then a 0x400-byte body', () => {
    const out = encodePalette({ rgb: rampRgb() });
    expect(out.length).toBe(8 + 0x400);
    expect(new DataView(out.buffer).getUint32(0, true)).toBe(0x3f6);
  });

  it('rejects an rgb buffer that is not 768 bytes', () => {
    expect(() => encodePalette({ rgb: Uint8Array.from([1, 2, 3]) })).toThrow(/rgb must be 768 bytes/);
  });
});
