import { describe, expect, it } from 'vitest';
import {
  type DrawItem,
  SYNTHETIC_ATLAS_HEIGHT,
  SYNTHETIC_ATLAS_WIDTH,
  SYNTHETIC_BINDINGS,
  type SpriteKind,
  resolveSpriteFrame,
  syntheticAtlasFrames,
} from '../src/index.js';

/**
 * Unit tests for the PURE half of the free synthetic atlas — its frame geometry + bindings. This is
 * the self-verifiable part (a data lookup, no screen): every bound sprite kind must resolve to an
 * in-bounds, non-empty frame, so the textured branch of `renderScene` actually draws something. The
 * pixel half (drawing the canvas) stays deferred to a human eye (see synthetic-atlas.ts).
 */

const KINDS: readonly SpriteKind[] = ['settler', 'building', 'resource'];

/** Hand-build a minimal drawable item of a given kind (the fields the resolver reads). */
function item(kind: SpriteKind): DrawItem {
  return { kind, ref: 1, x: 0, y: 0, depth: 0 };
}

describe('syntheticAtlasFrames', () => {
  it('reports the declared sheet dimensions', () => {
    const atlas = syntheticAtlasFrames();
    expect(atlas.width).toBe(SYNTHETIC_ATLAS_WIDTH);
    expect(atlas.height).toBe(SYNTHETIC_ATLAS_HEIGHT);
  });

  it('binds every drawable kind to an in-bounds, non-empty frame', () => {
    const atlas = syntheticAtlasFrames();
    for (const kind of KINDS) {
      const frame = resolveSpriteFrame(item(kind), SYNTHETIC_BINDINGS, atlas);
      expect(frame, `kind ${kind} must resolve to a frame`).not.toBeNull();
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

  it('lays out frames without overlap (a sub-rect never samples a neighbour)', () => {
    const atlas = syntheticAtlasFrames();
    const rects = KINDS.map((k) => atlas.frames.get(SYNTHETIC_BINDINGS[k]));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        if (a === undefined || b === undefined) continue;
        const disjoint =
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(disjoint, `frames ${i} and ${j} must not overlap`).toBe(true);
      }
    }
  });

  it('is pure: two calls produce structurally equal frame tables', () => {
    const a = syntheticAtlasFrames();
    const b = syntheticAtlasFrames();
    for (const kind of KINDS) {
      const bob = SYNTHETIC_BINDINGS[kind];
      expect(JSON.stringify(a.frames.get(bob))).toBe(JSON.stringify(b.frames.get(bob)));
    }
  });
});
