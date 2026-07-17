import { describe, expect, it } from 'vitest';
import {
  ATLAS_GUTTER,
  type AtlasFrame,
  expandBobFrame,
  expandBobFrameIndexed,
  packBobAtlas,
  packIndexedBobAtlas,
  packShadowBobAtlas,
  SHADOW_ALPHA,
} from '../src/decoders/atlas.js';
import {
  type Bmd,
  BOB_TYPE_1BIT,
  BOB_TYPE_8BIT,
  BOB_TYPE_DOUBLE8BIT,
  BOB_TYPE_EMPTY,
  type BobFrame,
} from '../src/decoders/bmd/index.js';
import { packLineControl } from './fixtures/bmd.js';

/**
 * Bob-atlas packer tests. No copyrighted fixtures: we synthesize tiny in-memory `.bmd` bob sets (the
 * same packed-line codec `decodeBobFrame` reads) and a synthetic palette, pack them, and assert the
 * atlas pixels + the JSON manifest's rects/metadata. `expandBobFrame` is tested in isolation against a
 * known palette + mask, then `packBobAtlas` is checked for placement, gutter, opaque flags, and that
 * empty bobs still get an id-addressable (0×0) entry.
 */

/** A 256-entry RGB palette where index `i` maps to `(i, i+1, i+2)` mod 256 — distinct, easy to assert.
 *  Deliberately not the shared `rampPalette` fixture: this formula makes the expected triples readable. */
const sequentialPalette = (): Uint8Array => {
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
 * Each bob's `lines[y]` is the line-control entry for its LOCAL row `y`: a number = packed offset
 * (xMin 0), an object = explicit `{ offset, xMin }` (xMin is the local first column), or `'empty'` = a
 * fully transparent row. Bobs share one packed-line stream by carrying their own offsets — like the real
 * container. The line-control array stacks each bob's scanlines contiguously, so each bob gets a `misc`
 * base = the sum of prior bobs' heights (its first-line index), exactly as the real format lays it out;
 * `areaX`/`areaY` are independent DRAW offsets (they do NOT shift pixels into the frame here).
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
  // Line-control stacks every bob's scanlines contiguously: bob i's first-line index (`misc`) is the
  // sum of prior bobs' heights, and the array length is the total height (matches the real container,
  // where lineControlCount == Σ height).
  const miscs: number[] = [];
  let lineBase = 0;
  for (const s of specs) {
    miscs.push(lineBase);
    lineBase += Math.max(0, s.height);
  }
  const lineControl = new Uint32Array(lineBase);
  lineControl.fill(0xffffffff);
  specs.forEach((s, i) => {
    const base = bases[i] ?? 0;
    const misc = miscs[i] ?? 0;
    s.lines.forEach((l, y) => {
      if (l === 'empty') return; // stays 0xFFFFFFFF
      const ctrl = typeof l === 'number' ? base + l : packLineControl(l.xMin, base + l.offset);
      lineControl[misc + y] = ctrl;
    });
  });

  return {
    version: 0,
    firstBobId,
    bobCount: specs.length,
    generatedNonEmptyLines: 0,
    generatedEmptyLines: 0,
    generatedPackedLines: 0,
    bobs: specs.map((s, i) => ({
      type: s.type,
      area: { x: s.areaX ?? 0, y: s.areaY ?? 0, width: s.width, height: s.height },
      misc: miscs[i] ?? 0,
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
      mask: Uint8Array.from([255, 0]),
    };
    const rgba = expandBobFrame(frame, sequentialPalette()).rgba;
    // Pixel 0 (index 5) -> (5,6,7,255); pixel 1 masked off -> (0,0,0,0).
    expect([...rgba]).toEqual([5, 6, 7, 255, 0, 0, 0, 0]);
  });

  it('carries a graded mask value (a Double8Bit alpha byte) into the pixel alpha', () => {
    const frame: BobFrame = {
      width: 1,
      height: 1,
      pixels: Uint8Array.from([5]),
      mask: Uint8Array.from([0x80]),
    };
    expect([...expandBobFrame(frame, sequentialPalette()).rgba]).toEqual([5, 6, 7, 0x80]);
  });

  it('treats index 0 as a real colour when its mask is set', () => {
    const frame: BobFrame = {
      width: 1,
      height: 1,
      pixels: Uint8Array.from([0]),
      mask: Uint8Array.from([255]),
    };
    const rgba = expandBobFrame(frame, sequentialPalette()).rgba;
    expect([...rgba]).toEqual([0, 1, 2, 255]);
  });

  it('throws on a palette that is not 768 bytes', () => {
    const frame: BobFrame = { width: 1, height: 1, pixels: Uint8Array.of(0), mask: Uint8Array.of(255) };
    expect(() => expandBobFrame(frame, new Uint8Array(767))).toThrow(/768 bytes/);
  });
});

describe('packBobAtlas', () => {
  it('packs a single bob at the gutter origin and records its rect + offset', () => {
    // One 8-bit bob, draw offset (3,4) size 2×1, raw run of 2 -> indices [7,8]. The run starts at LOCAL
    // column xMin=0, so the two pixels land at frame columns 0,1 (area.x/area.y are the draw offset, NOT
    // applied to the local pixel grid — they surface only as the frame's offsetX/offsetY).
    const bmd = makeBmd([
      {
        type: BOB_TYPE_8BIT,
        width: 2,
        height: 1,
        packed: [0x02, 7, 8, 0x00],
        lines: [{ offset: 0, xMin: 0 }],
        areaX: 3,
        areaY: 4,
      },
    ]);
    const { image, manifest } = packBobAtlas(bmd, sequentialPalette());

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
    const { manifest } = packBobAtlas(bmd, sequentialPalette(), { maxWidth: 5 });

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
    const { manifest } = packBobAtlas(bmd, sequentialPalette());
    expect(manifest.frames).toHaveLength(2);
    const empty = frameOf(manifest, 11);
    expect(empty.rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(empty.opaque).toBe(false);
    expect(empty.type).toBe(BOB_TYPE_EMPTY);
  });

  it('flags an all-transparent (skip-only) bob as not opaque', () => {
    // A bob whose only run is a skip of 2 (high bit set): no pixels written -> opaque false, 0x0 atlas rect.
    const bmd = makeBmd([{ type: BOB_TYPE_8BIT, width: 2, height: 1, packed: [0x82, 0x00], lines: [0] }]);
    const { manifest } = packBobAtlas(bmd, sequentialPalette());
    const f = frameOf(manifest, 10);
    expect(f.opaque).toBe(false);
  });

  it('produces a valid 1x1 atlas when no bob has pixels', () => {
    const bmd = makeBmd([{ type: BOB_TYPE_EMPTY, width: 0, height: 0, lines: [] }]);
    const { image, manifest } = packBobAtlas(bmd, sequentialPalette());
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
    const { image, manifest } = packBobAtlas(bmd, sequentialPalette());
    expect(manifest.width).toBe(image.width);
    expect(manifest.height).toBe(image.height);
  });
});

describe('expandBobFrameIndexed', () => {
  it('writes the palette index to red + mask to alpha, leaving unmasked pixels transparent', () => {
    const frame: BobFrame = {
      width: 3,
      height: 1,
      pixels: Uint8Array.from([5, 200, 9]),
      mask: Uint8Array.from([255, 128, 0]),
    };
    const rgba = expandBobFrameIndexed(frame).rgba;
    // idx 5 -> (5,0,0,255); idx 200 with graded coverage -> (200,0,0,128); masked-off -> (0,0,0,0).
    expect([...rgba]).toEqual([5, 0, 0, 255, 200, 0, 0, 128, 0, 0, 0, 0]);
  });

  it('keeps index 0 as a real (opaque) index when its mask is set', () => {
    const frame: BobFrame = { width: 1, height: 1, pixels: Uint8Array.of(0), mask: Uint8Array.of(255) };
    expect([...expandBobFrameIndexed(frame).rgba]).toEqual([0, 0, 0, 255]);
  });
});

describe('packIndexedBobAtlas', () => {
  it('keeps Double8Bit coverage graded (the LUT shader modulates by alpha)', () => {
    // One type-4 bob, raw run of 2 [index, alpha] pairs with a graded alpha byte 0x40.
    const bmd = makeBmd([
      {
        type: BOB_TYPE_DOUBLE8BIT,
        width: 2,
        height: 1,
        packed: [0x02, 7, 0x40, 8, 0xff, 0x00],
        lines: [{ offset: 0, xMin: 0 }],
      },
    ]);
    const indexed = packIndexedBobAtlas(bmd);
    const px = (x: number): number[] => {
      const o = (ATLAS_GUTTER * indexed.image.width + ATLAS_GUTTER + x) * 4;
      return [...indexed.image.rgba.subarray(o, o + 4)];
    };
    // Same graded bake as the RGB path: the authored 0x40 coverage rides into the sheet's alpha.
    expect(px(0)).toEqual([7, 0, 0, 0x40]);
    expect(px(1)).toEqual([8, 0, 0, 255]);
  });

  it('shares placement/manifest with the RGB atlas but stores indices, not colours', () => {
    const bmd = makeBmd([
      {
        type: BOB_TYPE_8BIT,
        width: 2,
        height: 1,
        packed: [0x02, 7, 8, 0x00],
        lines: [{ offset: 0, xMin: 0 }],
        areaX: 3,
        areaY: 4,
      },
    ]);
    const rgb = packBobAtlas(bmd, sequentialPalette());
    const indexed = packIndexedBobAtlas(bmd);
    // Same shelf packing → identical manifest geometry.
    expect(indexed.manifest).toEqual(rgb.manifest);

    const px = (img: typeof indexed.image, x: number, y: number): number[] => {
      const o = (y * img.width + x) * 4;
      return [...img.rgba.subarray(o, o + 4)];
    };
    // Indexed atlas carries the raw index in red (7, 8), alpha opaque — not the palette colour.
    expect(px(indexed.image, ATLAS_GUTTER, ATLAS_GUTTER)).toEqual([7, 0, 0, 255]);
    expect(px(indexed.image, ATLAS_GUTTER + 1, ATLAS_GUTTER)).toEqual([8, 0, 0, 255]);
  });
});

describe('packShadowBobAtlas', () => {
  it('bakes 1-bit mask pixels black at SHADOW_ALPHA and leaves unset pixels transparent', () => {
    // One 1-bit mask bob (the shadow `.bmd` type), 3×1: draw 1, skip 1, draw 1 — a mask raw run
    // carries no pixel bytes (see decodeBobFrame's mask branch).
    const bmd = makeBmd([
      {
        type: BOB_TYPE_1BIT,
        width: 3,
        height: 1,
        packed: [0x01, 0x81, 0x01, 0x00],
        lines: [{ offset: 0, xMin: 0 }],
        areaX: -2,
        areaY: -1,
      },
    ]);
    const { image, manifest } = packShadowBobAtlas(bmd);
    const px = (x: number, y: number): number[] => {
      const o = (y * image.width + x) * 4;
      return [...image.rgba.subarray(o, o + 4)];
    };
    expect(px(ATLAS_GUTTER, ATLAS_GUTTER)).toEqual([0, 0, 0, SHADOW_ALPHA]);
    expect(px(ATLAS_GUTTER + 1, ATLAS_GUTTER)).toEqual([0, 0, 0, 0]);
    expect(px(ATLAS_GUTTER + 2, ATLAS_GUTTER)).toEqual([0, 0, 0, SHADOW_ALPHA]);
    // The manifest keeps the bob's draw offset — the renderer anchors the shadow like any frame.
    const frame = frameOf(manifest, 10);
    expect(frame.offsetX).toBe(-2);
    expect(frame.offsetY).toBe(-1);
    expect(frame.opaque).toBe(true);
  });
});
