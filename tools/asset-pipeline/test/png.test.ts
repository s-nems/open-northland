import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng } from '../src/decoders/png.js';

/**
 * PNG container tests. No fixtures are committed: we synthesize RGBA in memory, encode it, and assert
 * `decodePng` recovers dimensions and pixels byte-for-byte. A handful of cases hand-build PNG bytes (with
 * an independent CRC-32, so the decoder is checked against a separate implementation) to exercise the
 * signature/CRC guards and the not-yet-supported row filters.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A `width*height` RGBA gradient: R=x, G=y, B=x+y, A ramps so every channel varies. */
const gradient = (width: number, height: number): Uint8Array => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = x & 0xff;
      rgba[o + 1] = y & 0xff;
      rgba[o + 2] = (x + y) & 0xff;
      rgba[o + 3] = (o * 3) & 0xff;
    }
  }
  return rgba;
};

// Independent CRC-32 + chunk assembler for the hand-built cases (deliberately NOT the module's).
const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
};

const makeChunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
};

/** Builds a colour-type-6 PNG whose every scanline uses `filter`, to probe decode's filter support. */
const makePngWithFilter = (width: number, height: number, rgba: Uint8Array, filter: number): Uint8Array => {
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter;
    raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width, false);
  hv.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [
    Uint8Array.from(SIGNATURE),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', new Uint8Array(deflateSync(raw))),
    makeChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
};

describe('encodePng / decodePng', () => {
  it('round-trips dimensions and RGBA pixels', () => {
    const width = 7;
    const height = 5;
    const rgba = gradient(width, height);
    const decoded = decodePng(encodePng({ width, height, rgba }));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(decoded.rgba).toEqual(rgba);
  });

  it('round-trips a 1x1 image and emits the PNG signature', () => {
    const png = encodePng({ width: 1, height: 1, rgba: Uint8Array.from([10, 20, 30, 40]) });
    expect([...png.subarray(0, 8)]).toEqual(SIGNATURE);
    expect(decodePng(png).rgba).toEqual(Uint8Array.from([10, 20, 30, 40]));
  });

  it('decodes a hand-built filter-0 PNG (independent CRC) identically', () => {
    const rgba = gradient(4, 3);
    const decoded = decodePng(makePngWithFilter(4, 3, rgba, 0));
    expect(decoded).toEqual({ width: 4, height: 3, rgba });
  });
});

describe('encodePng guards', () => {
  it('rejects an rgba buffer whose length disagrees with the dimensions', () => {
    expect(() => encodePng({ width: 2, height: 2, rgba: new Uint8Array(8) })).toThrow(/does not match 2x2x4/);
  });

  it('rejects non-positive dimensions', () => {
    expect(() => encodePng({ width: 0, height: 4, rgba: new Uint8Array(0) })).toThrow(
      /invalid dimensions 0x4/,
    );
  });
});

describe('decodePng guards', () => {
  it('throws on a buffer without the PNG signature', () => {
    expect(() => decodePng(new Uint8Array(8))).toThrow(/bad signature/);
  });

  it('throws a CRC mismatch when a chunk byte is corrupted', () => {
    const png = encodePng({ width: 2, height: 2, rgba: gradient(2, 2) });
    png[41] = (png[41] ?? 0) ^ 0xff; // first IDAT data byte: signature(8) + IHDR chunk(25) + len(4) + type(4)
    expect(() => decodePng(png)).toThrow(/CRC mismatch in IDAT/);
  });

  it('rejects a non-None row filter until those are implemented', () => {
    const png = makePngWithFilter(3, 2, gradient(3, 2), 1); // filter 1 = Sub
    expect(() => decodePng(png)).toThrow(/unsupported row filter 1/);
  });
});
