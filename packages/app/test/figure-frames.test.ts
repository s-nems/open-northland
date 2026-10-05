import type { DrawItem, ResolvedLayer } from '@open-northland/render';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type FigureFrameImage,
  FigureFrames,
  indexedPixels,
  recolourPixels,
  ShelfPacker,
} from '../src/hud/figures/figure-frames.js';

const PAGE = 64;
const GUTTER = 1;

describe('figure frame shelf packer', () => {
  it('places frames left to right with a gutter, then opens a shelf under the tallest one', () => {
    const packer = new ShelfPacker(PAGE, PAGE, GUTTER);
    expect(packer.place(20, 30)).toEqual({ x: 0, y: 0 });
    expect(packer.place(20, 10)).toEqual({ x: 21, y: 0 });
    expect(packer.place(20, 5)).toEqual({ x: 42, y: 0 });
    expect(packer.place(20, 5)).toEqual({ x: 0, y: 31 });
  });

  it('refuses a frame the page cannot take until it is reset', () => {
    const packer = new ShelfPacker(PAGE, PAGE, GUTTER);
    expect(packer.place(PAGE, 40)).toEqual({ x: 0, y: 0 });
    expect(packer.place(10, 30)).toBeNull();
    packer.reset();
    expect(packer.place(10, 30)).toEqual({ x: 0, y: 0 });
  });

  it('refuses a frame larger than an empty page', () => {
    const packer = new ShelfPacker(PAGE, PAGE, GUTTER);
    expect(packer.place(PAGE + 1, 1)).toBeNull();
    expect(packer.place(1, PAGE + 1)).toBeNull();
  });
});

describe('figure frame recolour', () => {
  const COVERED = 255;
  const PALETTE_INDICES = 256;
  const RGB = 3;
  const RED_INDEX = 2;
  /** `RED_INDEX` maps to RGB (10, 20, 30); every other index to black. */
  const colours = new Uint8Array(PALETTE_INDICES * RGB);
  colours.set([10, 20, 30], RED_INDEX * RGB);

  it('keeps each atlas pixel as its palette index and coverage', () => {
    const rgba = new Uint8ClampedArray([RED_INDEX, 9, 9, COVERED, 5, 9, 9, 0]);
    expect([...indexedPixels(rgba)]).toEqual([RED_INDEX, COVERED, 5, 0]);
  });

  it('paints covered pixels through the palette and leaves uncovered ones clear', () => {
    const out = new Uint8ClampedArray(8);
    recolourPixels(new Uint8Array([RED_INDEX, COVERED, RED_INDEX, 0]), colours, out);
    expect([...out]).toEqual([10, 20, 30, COVERED, 0, 0, 0, 0]);
  });
});

describe('figure frame images', () => {
  /** A 2d context that records where the page was written and answers covered pixels on read. */
  class StubContext {
    readonly canvas: StubCanvas;
    constructor(canvas: StubCanvas) {
      this.canvas = canvas;
    }
    drawImage(): void {}
    clearRect(): void {}
    putImageData(): void {}
    getImageData(_x: number, _y: number, width: number, height: number) {
      return { data: new Uint8ClampedArray(width * height * 4).fill(COVERED_PIXEL) };
    }
  }
  class StubCanvas {
    width = 0;
    height = 0;
    getContext() {
      return new StubContext(this);
    }
  }
  class StubImageData {
    readonly data: Uint8ClampedArray;
    constructor(width: number, height: number) {
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  }
  const COVERED_PIXEL = 255;
  /** Wider than half the 1024 px page, so one fills its first shelf. */
  const WIDE = 1000;

  const source = () =>
    new (globalThis as unknown as { OffscreenCanvas: typeof StubCanvas }).OffscreenCanvas();
  const layerOf = (resource: unknown, width: number, height: number) =>
    ({
      source: { resource },
      frame: { x: 0, y: 0, width, height, offsetX: 0, offsetY: 0 },
      scale: 1,
    }) as unknown as ResolvedLayer;

  function framesWithPalette(): FigureFrames {
    vi.stubGlobal('OffscreenCanvas', StubCanvas);
    vi.stubGlobal('ImageData', StubImageData);
    vi.stubGlobal('document', { createElement: () => new StubCanvas() });
    const frames = new FigureFrames(undefined);
    const colours = new Uint8Array(PALETTE_BYTES);
    // Every layer recolours through one palette, as an indexed settler's do.
    (frames as unknown as { palettes: { of: () => object } }).palettes = {
      of: () => ({ body: colours, head: colours }),
    };
    return frames;
  }
  const PALETTE_BYTES = 256 * 3;
  const item = { kind: 'settler', ref: 1 } as DrawItem;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves a figure again when its last layer emptied the page under the first', () => {
    const frames = framesWithPalette();
    const atlas = source();
    const out: (FigureFrameImage | null)[] = [];
    expect(frames.resolve([layerOf(atlas, WIDE, 600)], item, out)).toBe(true);

    // The body fits under the first shelf, the head does not: the page empties and both land on the new one.
    expect(frames.resolve([layerOf(atlas, 300, 300), layerOf(atlas, 300, 500)], item, out)).toBe(true);
    expect(out.map((image) => image?.y)).toEqual([0, 0]);
  });

  it('stops at a recolour due after the deadline, and still answers a cached one', () => {
    const frames = framesWithPalette();
    const layer = layerOf(source(), 4, 4);
    const out: (FigureFrameImage | null)[] = [];
    const past = performance.now() - 1;
    expect(frames.resolve([layer], item, out, past)).toBe(false);
    expect(frames.resolve([layer], item, out)).toBe(true);
    expect(frames.resolve([layer], item, out, past)).toBe(true);
  });
});
