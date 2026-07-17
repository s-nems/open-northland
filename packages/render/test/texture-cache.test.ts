import { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { AtlasFrame, BuildTimeSheet } from '../src/data/sprites/index.js';
import { TextureCache } from '../src/gpu/texture-cache.js';

/**
 * {@link TextureCache} memoizes one {@link Texture} per atlas frame, and — for the bottom-up construction
 * reveal — per (frame, hiddenTop) crop. These pin the crop rectangle math (bottom rows only, top cropped
 * off) and the caching so the per-frame reveal path allocates nothing in the steady state. Texture/Rectangle
 * creation needs no GL context (the upload is lazy), so this runs headless.
 */

const SOURCE = new TextureSource({ width: 64, height: 64 });
const FRAME: AtlasFrame = { x: 10, y: 20, width: 30, height: 40, offsetX: 0, offsetY: 0 };

describe('TextureCache.cropped', () => {
  it('keeps only the bottom rows — crops hiddenTop pixels off the TOP of the frame', () => {
    const cache = new TextureCache();
    const tex = cache.cropped(SOURCE, FRAME, 12);
    // The visible region is the bottom (height − hiddenTop) rows, starting hiddenTop px below the frame top.
    expect(tex.frame.x).toBe(FRAME.x);
    expect(tex.frame.y).toBe(FRAME.y + 12);
    expect(tex.frame.width).toBe(FRAME.width);
    expect(tex.frame.height).toBe(FRAME.height - 12);
  });

  it('clamps hiddenTop into the frame and rounds to whole pixels', () => {
    const cache = new TextureCache();
    // Beyond the frame height → the whole frame is hidden (zero-height bottom slice), never negative.
    const over = cache.cropped(SOURCE, FRAME, FRAME.height + 5);
    expect(over.frame.y).toBe(FRAME.y + FRAME.height);
    expect(over.frame.height).toBe(0);
    // Fractional hiddenTop rounds (12.6 → 13).
    expect(cache.cropped(SOURCE, FRAME, 12.6).frame.y).toBe(FRAME.y + 13);
  });

  it('reuses the texture per (frame, hiddenTop) and mints a fresh one per distinct crop', () => {
    const cache = new TextureCache();
    expect(cache.cropped(SOURCE, FRAME, 12)).toBe(cache.cropped(SOURCE, FRAME, 12));
    expect(cache.cropped(SOURCE, FRAME, 12)).not.toBe(cache.cropped(SOURCE, FRAME, 13));
    // The full-frame get() cache is independent of the crop cache.
    expect(cache.get(SOURCE, FRAME)).toBe(cache.get(SOURCE, FRAME));
  });
});

describe('TextureCache.revealed', () => {
  const TIMES: BuildTimeSheet = { width: 64, height: 64, values: new Uint8Array(64 * 64) };

  it('returns the plain full frame at threshold 255 (fully revealed, no bake)', () => {
    const cache = new TextureCache();
    expect(cache.revealed(SOURCE, FRAME, TIMES, 255, 1)).toBe(cache.get(SOURCE, FRAME));
  });

  it('returns null when the atlas pixels are not CPU-readable (the caller falls back to the crop)', () => {
    // A bare TextureSource has no drawable resource — no canvas bake is possible headless.
    expect(new TextureCache().revealed(SOURCE, FRAME, TIMES, 100, 1)).toBeNull();
  });
});

describe('TextureCache.clear', () => {
  it('destroys the cached textures, not just the map entries', () => {
    // A Pixi Texture registers a `resize` listener on its source, so the app-owned atlas page keeps
    // every cached texture alive until `destroy` unregisters it — dropping the Map entry leaks them.
    const cache = new TextureCache();
    const full = cache.get(SOURCE, FRAME);
    const crop = cache.cropped(SOURCE, FRAME, 12);
    cache.clear();
    expect(full.destroyed).toBe(true);
    expect(crop.destroyed).toBe(true);
  });

  it('leaves the shared atlas page alive — the renderer borrows it, the app owns it', () => {
    const page = new TextureSource({ width: 64, height: 64 });
    const cache = new TextureCache();
    cache.get(page, FRAME);
    cache.clear();
    expect(page.destroyed).toBe(false);
  });
});
