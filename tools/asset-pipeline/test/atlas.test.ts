import { describe, expect, it } from 'vitest';
import { ATLAS_GUTTER, type AtlasFrame, expandBobFrame, packBobAtlas } from '../src/decoders/atlas.js';
import {
  BOB_TYPE_8BIT,
  BOB_TYPE_EMPTY,
  type Bmd,
  type BobFrame,
  PACKED_X_SHIFT,
} from '../src/decoders/bmd.js';

/**
 * Bob-atlas packer tests. No copyrighted fixtures: we synthesize tiny in-memory `.bmd` bob sets (the
 * same packed-line codec `decodeBobFrame` reads) and a synthetic palette, pack them, and assert the
 * atlas pixels + the JSON manifest's rects/metadata. `expandBobFrame` is tested in isolation against a
 * known palette + mask, then `packBobAtlas` is checked for placement, gutter, opaque flags, and that
 * empty bobs still get an id-addressable (0×0) entry.
 */

/** A 256-entry RGB palette where index `i` maps to `(i, i+1, i+2)` mod 256 — distinct, easy to assert. */
const rampPalette = (): Uint8Array => {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = i & 0xff;
    p[i * 3 + 1] = (i + 1) & 0xff;
    p[i * 3 + 2] = (i + 2) & 0xff;
  }
  return p;
};

/**
 * Builds a `Bmd` whose bobs are described as `{ type, width, height, packed, lines, areaX, areaY }`.
 * Each bob's `lines[y]` is the line-control entry for absolute row (areaY + y): a number = packed
 * offset (xMin 0), an object = explicit `{ offset, xMin }`, or `'empty'` = a fully transparent row.
 * Bobs share one packed-line stream by carrying their own offsets — like the real container.
 */
interface BobSpec {
  type: number;
  width: number;
  height: number;
  packed?: number[];
  lines: (number | { offset: number; xMin: number } | 'empty')[];
  areaX?: number;
  areaY?: number;
}

const makeBmd = (specs: BobSpec[], firstBobId = 10): Bmd => {
  // Concatenate each bob's packed bytes, tracking the base offset so per-bob `lines` stay bob-local.
  const packed: number[] = [];
  const bases: number[] = [];
  for (const s of specs) {
    bases.push(packed.length);
    packed.push(...(s.packed ?? []));
  }
  // Line-control is indexed by absolute Y; size it to cover the tallest bob's rows.
  let maxRow = 0;
  for (const s of specs) maxRow = Math.max(maxRow, (s.areaY ?? 0) + s.height);
  const lineControl = new Uint32Array(maxRow);
  lineControl.fill(0xffffffff);
  specs.forEach((s, i) => {
    const base = bases[i] ?? 0;
    const areaY = s.areaY ?? 0;
    s.lines.forEach((l, y) => {
      if (l === 'empty') return; // stays 0xFFFFFFFF
      const ctrl = typeof l === 'number' ? base + l : ((l.xMin << PACKED_X_SHIFT) | (base + l.offset)) >>> 0;
      lineControl[areaY + y] = ctrl;
    });
  });

  return {
    version: 0,
    firstBobId,
    bobCount: specs.length,
    generatedNonEmptyLines: 0,
    generatedEmptyLines: 0,
    generatedPackedLines: 0,
    bobs: specs.map((s) => ({
      type: s.type,
      area: { x: s.areaX ?? 0, y: s.areaY ?? 0, width: s.width, height: s.height },
      misc: 0,
    })),
    packedLineData: Uint8Array.from(packed),
    lineControl,
  };
};

const frameOf = (m: { frames: readonly AtlasFrame[] }, bobId: number): AtlasFrame => {
  const f = m.frames.find((x) => x.bobId === bobId);
  if (f === undefined) throw new Error(`no frame for bobId ${bobId}`);
  return f;
};

describe('expandBobFrame', () => {
  it('colours masked pixels from the palette and leaves unmasked pixels fully transparent', () => {
    const frame: BobFrame = {
      width: 2,
      height: 1,
      pixels: Uint8Array.from([5, 9]),
      mask: Uint8Array.from([1, 0]),
    };
    const rgba = expandBobFrame(frame, rampPalette()).rgba;
    // Pixel 0 (index 5) -> (5,6,7,255); pixel 1 masked off -> (0,0,0,0).
    expect([...rgba]).toEqual([5, 6, 7, 255, 0, 0, 0, 0]);
  });

  it('treats index 0 as a real colour when its mask bit is set', () => {
    const frame: BobFrame = {
      width: 1,
      height: 1,
      pixels: Uint8Array.from([0]),
      mask: Uint8Array.from([1]),
    };
    const rgba = expandBobFrame(frame, rampPalette()).rgba;
    expect([...rgba]).toEqual([0, 1, 2, 255]);
  });

  it('throws on a palette that is not 768 bytes', () => {
    const frame: BobFrame = { width: 1, height: 1, pixels: Uint8Array.of(0), mask: Uint8Array.of(1) };
    expect(() => expandBobFrame(frame, new Uint8Array(767))).toThrow(/768 bytes/);
  });
});

describe('packBobAtlas', () => {
  it('packs a single bob at the gutter origin and records its rect + offset', () => {
    // One 8-bit bob, draw anchor (3,4) size 2×1, raw run of 2 -> indices [7,8]. The run starts at
    // absolute column xMin=3 (= area.x), so the two pixels land at frame columns 0,1. The bob lives
    // at absolute row areaY=4, so its line-control entry sits at index 4 (makeBmd handles the sizing).
    const bmd = makeBmd([
      {
        type: BOB_TYPE_8BIT,
        width: 2,
        height: 1,
        packed: [0x02, 7, 8, 0x00],
        lines: [{ offset: 0, xMin: 3 }],
        areaX: 3,
        areaY: 4,
      },
    ]);
    const { image, manifest } = packBobAtlas(bmd, rampPalette());

    const f = frameOf(manifest, 10);
    expect(f.rect).toEqual({ x: ATLAS_GUTTER, y: ATLAS_GUTTER, width: 2, height: 1 });
    expect(f.offsetX).toBe(3);
    expect(f.offsetY).toBe(4);
    expect(f.opaque).toBe(true);
    expect(f.type).toBe(BOB_TYPE_8BIT);

    // The two pixels land at (gutter, gutter) and (gutter+1, gutter) in the atlas.
    const px = (x: number, y: number): number[] => {
      const o = (y * image.width + x) * 4;
      return [...image.rgba.subarray(o, o + 4)];
    };
    expect(px(ATLAS_GUTTER, ATLAS_GUTTER)).toEqual([7, 8, 9, 255]); // index 7 -> (7,8,9)
    expect(px(ATLAS_GUTTER + 1, ATLAS_GUTTER)).toEqual([8, 9, 10, 255]); // index 8 -> (8,9,10)
  });

  it('wraps to a new shelf row when a frame overflows maxWidth', () => {
    // Two 8-bit bobs, each width 3 height 1. maxWidth small enough to force a wrap before the second.
    const a = { type: BOB_TYPE_8BIT, width: 3, height: 1, packed: [0x03, 1, 2, 3, 0x00], lines: [0] };
    const b = { type: BOB_TYPE_8BIT, width: 3, height: 1, packed: [0x03, 4, 5, 6, 0x00], lines: [0] };
    const bmd = makeBmd([a, b]);
    // maxWidth = 5: first frame at x=1 spans cols 1..3 (next cursor 5); second (+gutter+3) overflows -> wraps.
    const { manifest } = packBobAtlas(bmd, rampPalette(), 5);

    const f0 = frameOf(manifest, 10);
    const f1 = frameOf(manifest, 11);
    expect(f0.rect.y).toBe(ATLAS_GUTTER);
    expect(f1.rect.y).toBeGreaterThan(f0.rect.y); // wrapped onto a lower shelf
    expect(f1.rect.x).toBe(ATLAS_GUTTER); // back at the left gutter
  });

  it('gives empty / zero-size bobs a 0x0 rect but keeps them addressable by id', () => {
    const bmd = makeBmd([
      { type: BOB_TYPE_8BIT, width: 1, height: 1, packed: [0x01, 42, 0x00], lines: [0] },
      { type: BOB_TYPE_EMPTY, width: 0, height: 0, lines: [] },
    ]);
    const { manifest } = packBobAtlas(bmd, rampPalette());
    expect(manifest.frames).toHaveLength(2);
    const empty = frameOf(manifest, 11);
    expect(empty.rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(empty.opaque).toBe(false);
    expect(empty.type).toBe(BOB_TYPE_EMPTY);
  });

  it('flags an all-transparent (skip-only) bob as not opaque', () => {
    // A bob whose only run is a skip of 2 (high bit set): no pixels written -> opaque false, 0x0 atlas rect.
    const bmd = makeBmd([{ type: BOB_TYPE_8BIT, width: 2, height: 1, packed: [0x82, 0x00], lines: [0] }]);
    const { manifest } = packBobAtlas(bmd, rampPalette());
    const f = frameOf(manifest, 10);
    expect(f.opaque).toBe(false);
  });

  it('produces a valid 1x1 atlas when no bob has pixels', () => {
    const bmd = makeBmd([{ type: BOB_TYPE_EMPTY, width: 0, height: 0, lines: [] }]);
    const { image, manifest } = packBobAtlas(bmd, rampPalette());
    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
    expect(manifest.frames).toHaveLength(1);
  });

  it('manifest atlas dimensions match the emitted image', () => {
    const bmd = makeBmd([
      {
        type: BOB_TYPE_8BIT,
        width: 4,
        height: 2,
        packed: [0x04, 1, 2, 3, 4, 0x00, 0x04, 5, 6, 7, 8, 0x00],
        lines: [0, 6],
      },
    ]);
    const { image, manifest } = packBobAtlas(bmd, rampPalette());
    expect(manifest.width).toBe(image.width);
    expect(manifest.height).toBe(image.height);
  });
});
