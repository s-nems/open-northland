import { describe, expect, it } from 'vitest';
import {
  type DrawItem,
  resolveSpriteFrame,
  type SpriteState,
  SYNTHETIC_ATLAS_HEIGHT,
  SYNTHETIC_ATLAS_WIDTH,
  SYNTHETIC_BINDINGS,
  syntheticAtlasFrames,
} from '../src/index.js';

/**
 * Unit tests for the PURE half of the free synthetic atlas — its frame geometry + bindings. This is
 * the self-verifiable part (a data lookup, no screen): every bound sprite kind must resolve to an
 * in-bounds, non-empty frame, so the textured branch of `renderScene` actually draws something. The
 * pixel half (drawing the canvas) stays deferred to a human eye (see synthetic-atlas.ts).
 */

/** Hand-build a minimal drawable item of a given kind (+ optional state) the resolver reads. */
function item(kind: DrawItem['kind'], state?: SpriteState): DrawItem {
  return { kind, ref: 1, x: 0, y: 0, depth: 0, ...(state !== undefined ? { state } : {}) };
}

/** The settler's three per-state markers + the building/resource frames — every frame the atlas draws. */
const ALL_ITEMS: readonly DrawItem[] = [
  item('settler', 'idle'),
  item('settler', 'moving'),
  item('settler', 'acting'),
  item('building'),
  item('resource'),
];

describe('syntheticAtlasFrames', () => {
  it('reports the declared sheet dimensions', () => {
    const atlas = syntheticAtlasFrames();
    expect(atlas.width).toBe(SYNTHETIC_ATLAS_WIDTH);
    expect(atlas.height).toBe(SYNTHETIC_ATLAS_HEIGHT);
  });

  it('binds every drawable kind (and every settler state) to an in-bounds, non-empty frame', () => {
    const atlas = syntheticAtlasFrames();
    for (const drawable of ALL_ITEMS) {
      const label = `${drawable.kind}/${drawable.state ?? 'n/a'}`;
      const frame = resolveSpriteFrame(drawable, SYNTHETIC_BINDINGS, atlas);
      expect(frame, `${label} must resolve to a frame`).not.toBeNull();
      if (frame === null) continue;
      // Non-empty so the placeholder fallback never fires for a bound kind.
      expect(frame.width).toBeGreaterThan(0);
      expect(frame.height).toBeGreaterThan(0);
      // Inside the sheet (a textured sub-rect must not sample off the atlas).
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(SYNTHETIC_ATLAS_WIDTH);
      expect(frame.y + frame.height).toBeLessThanOrEqual(SYNTHETIC_ATLAS_HEIGHT);
      // Feet-anchored: bottom-centre at the anchor (offsetX = -w/2, offsetY = -h).
      expect(frame.offsetX).toBe(-frame.width / 2);
      expect(frame.offsetY).toBe(-frame.height);
    }
  });

  it('binds each settler state to a DISTINCT frame (the richer per-state path is real)', () => {
    const atlas = syntheticAtlasFrames();
    const idle = resolveSpriteFrame(item('settler', 'idle'), SYNTHETIC_BINDINGS, atlas);
    const moving = resolveSpriteFrame(item('settler', 'moving'), SYNTHETIC_BINDINGS, atlas);
    const acting = resolveSpriteFrame(item('settler', 'acting'), SYNTHETIC_BINDINGS, atlas);
    // Three distinct atlas rects — a walking settler doesn't draw the idle frame.
    const keys = [idle, moving, acting].map((f) => `${f?.x},${f?.y}`);
    expect(new Set(keys).size).toBe(3);
  });

  it('lays out frames without overlap (a sub-rect never samples a neighbour)', () => {
    const atlas = syntheticAtlasFrames();
    const rects = ALL_ITEMS.map((it) => resolveSpriteFrame(it, SYNTHETIC_BINDINGS, atlas));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        expect(a, `item ${i} resolves a frame`).not.toBeNull();
        expect(b, `item ${j} resolves a frame`).not.toBeNull();
        if (a == null || b == null) continue;
        const disjoint =
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(disjoint, `frames ${i} and ${j} must not overlap`).toBe(true);
      }
    }
  });

  it('is pure: two calls produce structurally equal frame tables', () => {
    const a = syntheticAtlasFrames();
    const b = syntheticAtlasFrames();
    for (const drawable of ALL_ITEMS) {
      const fa = resolveSpriteFrame(drawable, SYNTHETIC_BINDINGS, a);
      const fb = resolveSpriteFrame(drawable, SYNTHETIC_BINDINGS, b);
      expect(JSON.stringify(fa)).toBe(JSON.stringify(fb));
    }
  });
});
