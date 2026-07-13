import { describe, expect, it } from 'vitest';
import { decodePcx, encodePcx, expandToRgba } from '../src/decoders/pcx.js';
import { rampPalette } from './fixtures/palette.js';

/**
 * `.pcx` decoder tests. No copyrighted fixtures are committed: we synthesize pictures in memory with
 * the faithful `encodePcx`, then assert `decodePcx` recovers dimensions, indexed pixels, and palette.
 * A few cases hand-build bytes to exercise the raw RLE grammar and the trailing-palette marker.
 */

const bytesOf = (...vals: number[]): Uint8Array => Uint8Array.from(vals);

describe('decodePcx', () => {
  it('round-trips dimensions, indexed pixels, and palette', () => {
    const width = 5;
    const height = 3;
    // Mix runs and isolated values, including a value >= 0xC0 that must be RLE-escaped.
    const pixels = bytesOf(
      1,
      1,
      1,
      1,
      2, // row 0: a run then a singleton
      0xc5,
      0xc5,
      7,
      7,
      7, // row 1: 0xC5 forces escaping (it's a control byte)
      9,
      8,
      9,
      8,
      9, // row 2: alternating singletons
    );
    const palette = rampPalette();

    const decoded = decodePcx(encodePcx({ width, height, pixels, palette }));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(decoded.pixels).toEqual(pixels);
    expect(decoded.palette).toEqual(palette);
  });

  it('round-trips an odd width (the even-aligned pad byte is dropped on decode)', () => {
    const width = 3; // alignedRowBytes = 4, so each row carries one pad byte
    const height = 2;
    const pixels = bytesOf(10, 20, 30, 40, 50, 60);
    const decoded = decodePcx(encodePcx({ width, height, pixels, palette: rampPalette() }));
    expect(decoded.width).toBe(3);
    expect(decoded.pixels).toEqual(pixels);
  });

  it('round-trips a long run that fills an entire wide row (count capped at 0x3F)', () => {
    const width = 100; // > 0x3F, so a single-colour row needs multiple RLE packets
    const height = 1;
    const pixels = new Uint8Array(100).fill(42);
    const decoded = decodePcx(encodePcx({ width, height, pixels, palette: rampPalette() }));
    expect(decoded.pixels).toEqual(pixels);
  });

  it('decodes pixels with no palette when the 0x0C marker is absent', () => {
    const width = 4;
    const height = 1;
    const pixels = bytesOf(3, 3, 3, 3);
    const decoded = decodePcx(encodePcx({ width, height, pixels })); // no palette arg
    expect(decoded.pixels).toEqual(pixels);
    expect(decoded.palette).toBeUndefined();
  });

  it('reads xMin/yMin offsets when computing width/height (hand-built header)', () => {
    // xMin=10 xMax=12 -> width 3; yMin=5 yMax=5 -> height 1. One row: literal 1,2 then pad.
    const header = new Uint8Array(128);
    const hv = new DataView(header.buffer);
    hv.setUint16(4, 10, true); // xMin
    hv.setUint16(6, 5, true); // yMin
    hv.setUint16(8, 12, true); // xMax
    hv.setUint16(10, 5, true); // yMax
    // alignedRowBytes = (3+1)&~1 = 4; literals 1,2,3,4
    const decoded = decodePcx(bytesOf(...header, 1, 2, 3, 4));
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(1);
    expect(decoded.pixels).toEqual(bytesOf(1, 2, 3)); // first `width` of the row
  });

  it('decodes a raw RLE run packet (byte >= 0xC0 = repeat next byte)', () => {
    // width 4, height 1: 0xC4 0x09 -> count = (0xC4 & 0x3F) = 4 copies of 0x09.
    const header = new Uint8Array(128);
    const hv = new DataView(header.buffer);
    hv.setUint16(8, 3, true); // xMax -> width 4
    hv.setUint16(10, 0, true); // yMax -> height 1
    const decoded = decodePcx(bytesOf(...header, 0xc4, 0x09));
    expect(decoded.pixels).toEqual(bytesOf(9, 9, 9, 9));
  });

  it('handles a count-0 run packet (0xC0) as a no-op (matches the RLE grammar)', () => {
    // width 2, height 1: 0xC0 0x09 -> count = (0xC0 & 0x3F) = 0, writes nothing; then literals 1,2.
    const header = new Uint8Array(128);
    const hv = new DataView(header.buffer);
    hv.setUint16(8, 1, true); // xMax -> width 2
    hv.setUint16(10, 0, true); // yMax -> height 1
    const decoded = decodePcx(bytesOf(...header, 0xc0, 0x09, 1, 2));
    expect(decoded.pixels).toEqual(bytesOf(1, 2));
  });

  it('tolerates truncated pixel data, leaking the prior row (matches the original)', () => {
    // width 2, height 2 (alignedRowBytes = 2). Row 0 = literals 5,6 (full); row 1 = literal 7 then
    // the buffer ends, so the reused scanline keeps row 0's second byte -> row 1 decodes to [7, 6].
    const header = new Uint8Array(128);
    const hv = new DataView(header.buffer);
    hv.setUint16(8, 1, true); // xMax -> width 2
    hv.setUint16(10, 1, true); // yMax -> height 2
    const decoded = decodePcx(bytesOf(...header, 5, 6, 7));
    expect(decoded.pixels).toEqual(bytesOf(5, 6, 7, 6));
  });

  it('throws a pcx-prefixed error on a buffer too short for the header', () => {
    expect(() => decodePcx(new Uint8Array(127))).toThrow(/pcx: buffer of 127 bytes is too short/);
  });

  it('throws on non-positive dimensions (xMax < xMin)', () => {
    const header = new Uint8Array(128);
    const hv = new DataView(header.buffer);
    hv.setUint16(4, 10, true); // xMin
    hv.setUint16(8, 5, true); // xMax < xMin -> width -4
    expect(() => decodePcx(header)).toThrow(/pcx: invalid dimensions/);
  });
});

describe('expandToRgba', () => {
  it('applies the palette and forces opaque alpha', () => {
    const palette = rampPalette();
    const image = { width: 2, height: 1, pixels: bytesOf(0, 5), palette };
    const { width, height, rgba } = expandToRgba(image);
    expect(width).toBe(2);
    expect(height).toBe(1);
    // index 0 -> (0, 255, 0); index 5 -> (5, 250, 35); both alpha 255
    expect([...rgba]).toEqual([0, 255, 0, 255, 5, 250, 35, 255]);
  });

  it('throws when the image has no palette', () => {
    const image = { width: 1, height: 1, pixels: bytesOf(0), palette: undefined };
    expect(() => expandToRgba(image)).toThrow(/pcx: cannot expand to RGBA/);
  });

  it('throws a pcx-prefixed error on a palette that is not 768 bytes', () => {
    const image = { width: 1, height: 1, pixels: bytesOf(0), palette: bytesOf(1, 2, 3) };
    expect(() => expandToRgba(image)).toThrow(/palette must be 768 bytes/);
  });
});

describe('encodePcx', () => {
  it('rejects a pixel buffer whose length disagrees with the dimensions', () => {
    expect(() => encodePcx({ width: 2, height: 2, pixels: bytesOf(1, 2, 3) })).toThrow(/does not match 2x2/);
  });

  it('rejects a palette that is not 768 bytes', () => {
    expect(() => encodePcx({ width: 1, height: 1, pixels: bytesOf(0), palette: bytesOf(1, 2, 3) })).toThrow(
      /palette must be 768 bytes/,
    );
  });
});
