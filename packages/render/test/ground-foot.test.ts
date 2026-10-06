import { type Sprite, Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DrawItem } from '../src/data/scene/index.js';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import * as drawable from '../src/gpu/drawable-resource.js';
import { analyseFoot, type FootAnalysis } from '../src/gpu/ground-foot/foot-analysis.js';
import {
  bakeFootCover,
  bakeGroundShade,
  type FootBake,
  sinkBody,
} from '../src/gpu/ground-foot/foot-bakes.js';
import {
  type FootGround,
  fillGaps,
  footGround,
  type GroundColours,
  groundKinds,
} from '../src/gpu/ground-foot/foot-ground.js';
import { GroundedFootCache } from '../src/gpu/ground-foot/grounded-foot-cache.js';
import { SoftShadowCache } from '../src/gpu/soft-shadow-cache.js';
import { LayerBinder } from '../src/gpu/sprite-pool/bind-layers.js';
import { createPooled } from '../src/gpu/sprite-pool/pooled-entity.js';
import type { ResolvedLayer } from '../src/gpu/sprite-pool/resolved-layer.js';
import { TextureCache } from '../src/gpu/texture-cache.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const W = 40;
const H = 40;
const WALL_BOTTOM = 29;
const GRASS = 0x50731e;
const SNOW = 0xd7e1eb;
const WALL = [200, 180, 160] as const;

type Box = readonly [x0: number, y0: number, x1: number, y1: number, rgb?: readonly number[]];

/** A `W`×`H` straight-alpha RGBA frame with opaque boxes painted on a clear ground. */
function art(...boxes: readonly Box[]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(W * H * 4);
  for (const [x0, y0, x1, y1, rgb = WALL] of boxes) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++)
        pixels.set([rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0, 255], (y * W + x) * 4);
    }
  }
  return pixels;
}

const WALL_BOX: Box = [5, 10, 34, WALL_BOTTOM];

function analysed(pixels: Uint8ClampedArray): FootAnalysis {
  const a = analyseFoot(pixels, W, 0, 0, W, H);
  if (a === null) throw new Error('expected a ground line');
  return a;
}

const FRAME: AtlasFrame = { x: 0, y: 0, width: W, height: H, offsetX: -W / 2, offsetY: -H };

/** One ground colour everywhere, or none. */
const flat = (colour: number | undefined): GroundColours => ({ pointAt: () => colour });

function under(a: FootAnalysis, colour: number): FootGround {
  const ground = footGround(a, FRAME, 1, 0, 0, flat(colour));
  if (ground === null) throw new Error('expected ground');
  return ground;
}

function pixelAt(bake: FootBake, x: number, y: number): readonly number[] {
  const bx = Math.floor((x - bake.left) * bake.resolution);
  const by = Math.floor((y - bake.top) * bake.resolution);
  if (bx < 0 || by < 0 || bx >= bake.width || by >= bake.height) return [0, 0, 0, 0];
  const p = (by * bake.width + bx) * 4;
  return [...bake.pixels.subarray(p, p + 4)];
}

const luma = ([r = 0, g = 0, b = 0]: readonly number[]): number => r * 0.299 + g * 0.587 + b * 0.114;

describe('analyseFoot', () => {
  it('finds the wall foot and sinks it a few pixels into the ground', () => {
    const a = analysed(art(WALL_BOX));
    for (let x = 5; x <= 34; x++) {
      const foot = a.footRow[x] ?? -1;
      expect(foot).toBeLessThan(WALL_BOTTOM);
      expect(foot).toBeGreaterThan(WALL_BOTTOM - 6);
      expect(a.alpha[(WALL_BOTTOM * W + x) * 1]).toBeLessThan(255);
    }
    expect(a.footRow[2]).toBe(-1);
  });

  it('takes a beam between two posts for no ground line', () => {
    const a = analysed(art([5, 10, 12, WALL_BOTTOM], [27, 10, 34, WALL_BOTTOM], [5, 10, 34, 17]));
    for (let x = 14; x <= 25; x++) expect(a.footRow[x]).toBe(-1);
    expect(a.footRow[8]).toBeGreaterThan(17);
    expect(a.footRow[30]).toBeGreaterThan(17);
  });

  it('draws as it is when the art stands on no ground line', () => {
    const post = art([18, 5, 20, WALL_BOTTOM]);
    expect(analyseFoot(post, W, 0, 0, W, H)).toBeNull();
  });

  it('rates each column by the light on the wall above it', () => {
    const a = analysed(art(WALL_BOX, [5, 10, 19, WALL_BOTTOM, [100, 90, 80]]));
    expect(a.wallLight[30]).toBeCloseTo(1, 2);
    expect(a.wallLight[8]).toBeCloseTo(0.5, 2);
  });
});

describe('ground under a foot', () => {
  const kinds = (rgb: readonly number[]) => groundKinds(new Float32Array(rgb), { grass: 0, snow: 0 });

  it('tells grass, snow, shaded snow and sand apart', () => {
    expect(kinds([80, 115, 30])).toEqual({ grass: 1, snow: 0 });
    expect(kinds([215, 225, 235]).snow).toBe(1);
    expect(kinds([120, 128, 140]).snow).toBeGreaterThan(0.5);
    expect(kinds([200, 180, 120])).toEqual({ grass: 0, snow: 0 });
  });

  it('fills an unsampled stretch from its nearest sampled neighbour', () => {
    const colours = new Int32Array([-1, 5, -1, -1, 9, -1]);
    fillGaps(colours);
    expect([...colours]).toEqual([5, 5, 5, 9, 9, 9]);
  });

  it('shares a key between feet on like ground and has none off the coloured map', () => {
    const a = analysed(art(WALL_BOX));
    expect(under(a, GRASS).key).toBe(under(a, GRASS + 0x010101).key);
    expect(under(a, GRASS).key).not.toBe(under(a, SNOW).key);
    expect(footGround(a, FRAME, 1, 0, 0, flat(undefined))).toBeNull();
  });
});

describe('foot bakes', () => {
  it('darkens the wall toward its contact', () => {
    const pixels = art(WALL_BOX);
    const a = analysed(pixels.slice());
    sinkBody(pixels, W, 0, 0, a);
    const x = 20;
    const foot = a.footRow[x] ?? 0;
    const atFoot = luma([...pixels.subarray((foot * W + x) * 4)]);
    const high = luma([...pixels.subarray((12 * W + x) * 4)]);
    expect(atFoot).toBeLessThan(high * 0.6);
    expect(pixels[(WALL_BOTTOM * W + x) * 4 + 3]).toBeLessThan(255);
  });

  it('shades the ground in its own colour, darkest at the wall, within a trimmed box', () => {
    const a = analysed(art(WALL_BOX));
    const shade = bakeGroundShade(a, under(a, GRASS));
    if (shade === null) throw new Error('expected a shade');
    // Half resolution, trimmed to the painted band.
    expect(shade.resolution).toBe(0.5);
    expect(shade.width / shade.resolution).toBeLessThan(W + 24);
    const foot = a.footRow[20] ?? 0;
    const [r, g, b, near = 0] = pixelAt(shade, 20, foot + 1);
    const [, , , far = 0] = pixelAt(shade, 20, foot + 4);
    expect(near).toBeGreaterThan(far);
    expect(g).toBeGreaterThan(r ?? 0);
    expect(g).toBeLessThan(0x73);
    expect(b).toBeLessThan(g ?? 0);
  });

  it('grows tufts over the foot on grass and banks a drift on snow', () => {
    const a = analysed(art(WALL_BOX));
    const foot = a.footRow[20] ?? 0;
    const onGrass = bakeFootCover(a, under(a, GRASS));
    const onSnow = bakeFootCover(a, under(a, SNOW));
    if (onGrass === null || onSnow === null) throw new Error('expected covers');
    // Tufts grow in clumps, so some columns of the foot carry one and others only the stain.
    const tufts = Array.from({ length: 30 }, (_, i) => pixelAt(onGrass, 5 + i, (a.footRow[5 + i] ?? 0) - 1));
    expect(tufts.some(([r = 0, g = 0, , alpha]) => alpha === 255 && g > r)).toBe(true);
    const drift = pixelAt(onSnow, 20, foot - 2);
    expect(luma(drift)).toBeGreaterThan(200);
    // The toe runs onto the ground in front of the wall, under the sunk edge's soft last rows.
    const toe = [2, 3, 4].map((below) => pixelAt(onSnow, 20, WALL_BOTTOM - 3 + below)[3] ?? 0);
    expect(Math.max(...toe)).toBeGreaterThan(0);
  });

  it('dims the drift at the foot of a dark wall face', () => {
    const a = analysed(art(WALL_BOX, [5, 10, 19, WALL_BOTTOM, [100, 90, 80]]));
    const drift = bakeFootCover(a, under(a, SNOW));
    if (drift === null) throw new Error('expected a drift');
    const lit = luma(pixelAt(drift, 30, (a.footRow[30] ?? 0) - 1));
    const dark = luma(pixelAt(drift, 8, (a.footRow[8] ?? 0) - 1));
    expect(dark).toBeLessThan(lit * 0.7);
  });
});

describe('GroundedFootCache', () => {
  const source = new TextureSource({ resource: {} as never, width: W, height: H });

  function mockFrames(pixels: Uint8ClampedArray): void {
    vi.spyOn(drawable, 'isDrawableResource').mockReturnValue(true);
    vi.spyOn(drawable, 'readable2dContext').mockImplementation(
      (width, height) =>
        ({
          canvas: { width, height },
          drawImage: vi.fn(),
          getImageData: () => ({ data: pixels.slice() }),
          putImageData: vi.fn(),
        }) as unknown as CanvasRenderingContext2D,
    );
    vi.stubGlobal(
      'ImageData',
      class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    );
  }

  it('draws every foot as the original until it has ground', () => {
    mockFrames(art(WALL_BOX));
    const cache = new GroundedFootCache();
    expect(cache.overlaysAt(source, FRAME, 1, 0, 0)).toBeNull();
    cache.setGround(flat(GRASS));
    const overlays = cache.overlaysAt(source, FRAME, 1, 0, 0);
    expect(overlays?.shade).not.toBeNull();
    expect(overlays?.cover).not.toBeNull();
    // A second foot on like ground shares the bake.
    expect(cache.overlaysAt(source, FRAME, 1, 100, 50)).toBe(overlays);
    cache.setGround(null);
    expect(cache.overlaysAt(source, FRAME, 1, 0, 0)).toBeNull();
  });

  it('defers a bake past the budget of the drawn frame to a later frame', () => {
    mockFrames(art(WALL_BOX));
    const cache = new GroundedFootCache();
    cache.setGround(flat(GRASS));
    // A frame's first analysis always runs, so the largest frame cannot starve; this one spends it all.
    const big: AtlasFrame = { ...FRAME, width: 256, height: 256 };
    cache.beginFrame(true);
    cache.overlaysAt(source, big, 1, 0, 0);
    expect(cache.overlaysAt(source, FRAME, 1, 0, 0)).toBeNull();
    expect(cache.deferredBakes).toBe(true);
    cache.beginFrame(true);
    expect(cache.overlaysAt(source, FRAME, 1, 0, 0)).not.toBeNull();
    expect(cache.deferredBakes).toBe(false);
  });

  it('bakes past the budget in an unbudgeted frame', () => {
    mockFrames(art(WALL_BOX));
    const cache = new GroundedFootCache();
    cache.setGround(flat(GRASS));
    const big: AtlasFrame = { ...FRAME, width: 256, height: 256 };
    cache.beginFrame(false);
    cache.overlaysAt(source, big, 1, 0, 0);
    expect(cache.overlaysAt(source, FRAME, 1, 0, 0)).not.toBeNull();
    expect(cache.deferredBakes).toBe(false);
  });
});

describe('TextureCache ground switch', () => {
  it('rebinds on a ground change, and its retry consumers after a deferred bake', () => {
    const cache = new TextureCache();
    const page = new TextureSource({ width: W, height: H });
    expect(cache.groundedPart('body', page, FRAME, 1, 0, 0, false)).toBeNull();
    const before = cache.textureRevision;
    cache.setGroundColours(flat(GRASS));
    expect(cache.textureRevision).toBeGreaterThan(before);
    // A turned-away bake leaves the textures as they are for every bind that got its answer; only the
    // all-or-nothing consumers' retry revision moves.
    const deferred = vi.spyOn(GroundedFootCache.prototype, 'deferredBakes', 'get').mockReturnValue(true);
    const settled = cache.textureRevision;
    const retry = cache.retryRevision;
    cache.beginFrame();
    expect(cache.textureRevision).toBe(settled);
    expect(cache.retryRevision).toBe(retry + 1);
    deferred.mockReturnValue(false);
    cache.beginFrame();
    expect(cache.retryRevision).toBe(retry + 1);
  });

  it('opens only its first frame unbudgeted', () => {
    const feet = vi.spyOn(GroundedFootCache.prototype, 'beginFrame');
    const shadows = vi.spyOn(SoftShadowCache.prototype, 'beginFrame');
    const cache = new TextureCache();
    cache.beginFrame();
    cache.beginFrame();
    expect(feet.mock.calls).toEqual([[false], [true]]);
    expect(shadows.mock.calls).toEqual([[false], [true]]);
  });
});

describe('grounded bind', () => {
  const page = new TextureSource({ width: W, height: H });
  const layers: ResolvedLayer[] = [
    { source: page, frame: FRAME, scale: 1, boundsExempt: true, shadow: true, groundFoot: 'shade' },
    { source: page, frame: FRAME, scale: 1, groundFoot: 'body' },
    { source: page, frame: FRAME, scale: 1, boundsExempt: true, groundFoot: 'cover' },
  ];
  const item: DrawItem = { ref: 1, kind: 'building', x: 10, y: 50, depth: 0, lift: 6 };
  const frame = { camera: { offsetX: 0, offsetY: 0 }, screenW: 800, screenH: 600 };

  it('draws the plain body and no overlays where the foot has no grounding', () => {
    const cache = new TextureCache();
    const pe = createPooled('building', undefined);
    new LayerBinder(cache, undefined).bind(pe, item, layers, frame, 1);
    const [shade, body, cover] = pe.container.children as Sprite[];
    expect([shade?.visible, body?.visible, cover?.visible]).toEqual([false, true, false]);
    expect(body?.texture).toBe(cache.get(page, FRAME));
  });

  it('sets the foot at the lifted feet and keeps its overlays out of picking', () => {
    const cache = new TextureCache();
    const parts = { shade: new Texture(), body: new Texture(), cover: new Texture() } as const;
    const grounded = vi.spyOn(cache, 'groundedPart').mockImplementation((part) => parts[part]);
    const pe = createPooled('building', undefined);
    new LayerBinder(cache, undefined).bind(pe, item, layers, frame, 1);
    expect(grounded).toHaveBeenCalledWith('cover', page, FRAME, 1, 10, 44, false);
    const sprites = pe.container.children as Sprite[];
    expect(sprites.map((s) => [s.visible, s.texture])).toEqual([
      [true, parts.shade],
      [true, parts.body],
      [true, parts.cover],
    ]);
    if (pe.paletted) throw new Error('expected a plain entity');
    expect(pe.pickExempt).toEqual([true, false, true]);
  });
});
