import type { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  compactResolvedStockpileLayers,
  type MotionTrack,
  reconcileSprites,
  trackMotion,
} from '../src/gpu/sprite-pool/index.js';
import { type DrawItem, resolveLayers, type SpriteAtlas, type SpriteSheet } from '../src/index.js';

/**
 * Unit test for the retained renderer's one PURE decision — pool bookkeeping — extracted so it is
 * self-verifiable without a GPU. `reconcileSprites` decides which pooled sprites to DESTROY: an entity
 * that has left the snapshot (died) frees its objects, while one merely culled off-screen (still live)
 * is kept in the pool for when it scrolls back. Getting this wrong is either a leak (never destroy) or a
 * flicker (destroy the culled). The Pixi mutation around it is the human-gated half.
 */

describe('reconcileSprites', () => {
  it('destroys pooled entities absent from the live set (died), keeps culled-but-live ones', () => {
    const live = new Set([1, 2, 4]);
    const pooled = [1, 2, 3, 4, 5]; // 3 and 5 have left the snapshot
    expect(reconcileSprites(live, pooled).toDestroy).toEqual([3, 5]);
  });

  it('destroys nothing when every pooled entity is still live (e.g. all merely off-screen)', () => {
    expect(reconcileSprites(new Set([1, 2, 3]), [1, 2, 3]).toDestroy).toEqual([]);
  });

  it('is empty for an empty pool, whatever the live set', () => {
    expect(reconcileSprites(new Set([1, 2]), []).toDestroy).toEqual([]);
  });

  it('ignores live refs that were never pooled', () => {
    expect(reconcileSprites(new Set([1, 2, 3, 4]), [2]).toDestroy).toEqual([]);
  });

  it('preserves pooled iteration order in the destroy list (deterministic)', () => {
    expect(reconcileSprites(new Set<number>(), [5, 1, 3]).toDestroy).toEqual([5, 1, 3]);
  });
});

describe('compactResolvedStockpileLayers', () => {
  it('requires the primary heap before drawing optional flag overlays', () => {
    expect(compactResolvedStockpileLayers<string>([null, 'flag'])).toBeNull();
    expect(compactResolvedStockpileLayers<string>(['heap', null])).toEqual(['heap']);
    expect(compactResolvedStockpileLayers<string>(['heap', 'flag'])).toEqual(['heap', 'flag']);
  });
});

describe('trackMotion — the inter-tick interpolation decision', () => {
  const fresh = (): MotionTrack => ({ tick: -1, x: 0, y: 0, prevX: 0, prevY: 0, drawX: 0, drawY: 0 });
  /** Run one trackMotion update and read back the stamped drawn anchor. */
  const drawnAt = (
    m: MotionTrack,
    tick: number,
    x: number,
    y: number,
    alpha: number,
  ): { x: number; y: number } => {
    trackMotion(m, tick, x, y, alpha);
    return { x: m.drawX, y: m.drawY };
  };

  it('snaps both anchors on first sight (no glide in from the origin)', () => {
    const m = fresh();
    expect(drawnAt(m, 5, 100, 50, 0.5)).toEqual({ x: 100, y: 50 });
  });

  it('lerps from the previous tick anchor to the current one by alpha', () => {
    const m = fresh();
    trackMotion(m, 1, 100, 50, 0); // first sight — snap
    expect(drawnAt(m, 2, 108, 50, 0.25)).toEqual({ x: 102, y: 50 });
    expect(drawnAt(m, 2, 108, 50, 0.75)).toEqual({ x: 106, y: 50 }); // same tick, alpha grows
  });

  it('is continuous across a tick boundary (alpha→1 meets the next tick at alpha 0)', () => {
    const m = fresh();
    trackMotion(m, 1, 100, 0, 0);
    const endOfTick = drawnAt(m, 2, 108, 0, 1);
    const startOfNext = drawnAt(m, 3, 116, 0, 0);
    expect(startOfNext.x).toBe(endOfTick.x); // 108 both ways — no visible jump at the boundary
  });

  it('clamps alpha outside [0,1]', () => {
    const m = fresh();
    trackMotion(m, 1, 0, 0, 0);
    expect(drawnAt(m, 2, 10, 0, 2).x).toBe(10);
    expect(drawnAt(m, 3, 20, 0, -1).x).toBe(10);
  });

  it('snaps (never lerps) across a teleport-sized jump', () => {
    const m = fresh();
    trackMotion(m, 1, 0, 0, 0);
    // 500 px in one tick is a respawn, not a walk — both anchors jump, alpha is irrelevant.
    expect(drawnAt(m, 2, 500, 0, 0.5)).toEqual({ x: 500, y: 0 });
  });

  it('keeps lerping over a multi-tick catch-up step (within the snap band)', () => {
    const m = fresh();
    trackMotion(m, 1, 0, 0, 0);
    // The frame ran 3 sim ticks at once (~26 px for a walker): still smooth, from the last DRAWN tick.
    expect(drawnAt(m, 4, 26, 0, 0.5)).toEqual({ x: 13, y: 0 });
  });
});

describe('resolveLayers — the animated building overlay is bounds-exempt', () => {
  // A minimal mill sheet: the `miller` family atlas carries the bladeless body (bob 70), the still
  // blade (76) and one spin frame (85). The fake TextureSource is never touched — resolveLayers is a
  // pure layer *decision*; binding to a GPU texture is the pool's half.
  const source = {} as TextureSource;
  const frame = (
    n: number,
  ): [number, { x: number; y: number; width: number; height: number; offsetX: number; offsetY: number }] => [
    n,
    { x: n, y: 0, width: 10, height: 10, offsetX: 0, offsetY: 0 },
  ];
  const atlas: SpriteAtlas = { width: 100, height: 10, frames: new Map([frame(70), frame(76), frame(85)]) };
  const sheet: SpriteSheet = {
    source,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: {
      settler: 1,
      resource: 1,
      building: {
        byType: { 13: { layer: 'miller', bob: 70 } },
        default: 70,
        overlayByType: { 13: { layer: 'miller', idle: 76, working: [85] } },
      },
    },
    families: { miller: { source, atlas } },
  };
  const mill: DrawItem = { kind: 'building', ref: 1, x: 0, y: 0, depth: 0, typeId: 13 };

  it('marks ONLY the overlay layer boundsExempt (the body still stamps the entity box)', () => {
    const layers = resolveLayers(sheet, mill, 0) ?? [];
    // Body first, rotor overlay second — and only the rotor is excluded from the bounds union, so the
    // selection ring and the portrait framing read the stable body box while the spin frames breathe.
    expect(layers.map((l) => [l.frame.x, l.boundsExempt ?? false])).toEqual([
      [70, false],
      [76, true],
    ]);
  });
});
