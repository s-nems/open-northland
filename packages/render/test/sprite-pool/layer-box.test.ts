import type { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  BoundsUnion,
  createLayerDrawBox,
  layerDrawBox,
  placeholderBounds,
} from '../../src/gpu/sprite-pool/index.js';
import type { ResolvedLayer } from '../../src/index.js';

/**
 * The feet-local box arithmetic behind two things a player feels directly: where a layer's texture lands
 * (the bottom-up construction rise) and how big the entity's hit box / selection ring is. Pure numbers over
 * a resolved layer, so the fake TextureSource below is never sampled.
 */

const source = {} as TextureSource;

/** A resolved layer whose 10x10 frame sits at draw offset (−4, −20) — a feet-anchored body. */
const layer = (extra: Partial<ResolvedLayer> = {}): ResolvedLayer => ({
  source,
  frame: { x: 0, y: 0, width: 10, height: 10, offsetX: -4, offsetY: -20 },
  scale: 1,
  ...extra,
});

describe('layerDrawBox', () => {
  it('places a plain layer at its authored offset, uncropped', () => {
    const box = createLayerDrawBox();
    layerDrawBox(box, layer(), undefined, false);
    expect(box).toEqual({ ox: -4, oy: -20, drawnOy: -20, hiddenTop: 0, width: 10, height: 10 });
  });

  it('scales the offset and extents about the feet anchor', () => {
    const box = createLayerDrawBox();
    layerDrawBox(box, layer({ scale: 2 }), undefined, false);
    expect(box).toMatchObject({ ox: -8, oy: -40, drawnOy: -40, width: 20, height: 20 });
  });

  it('crops a reveal layer from the top and shifts it down so its base stays put', () => {
    const box = createLayerDrawBox();
    layerDrawBox(box, layer({ reveal: 1 }), 0.25, false);
    // A quarter risen: the top 8 of 10 rows are hidden, and the drawn top moves down by exactly that much,
    // so the layer's bottom edge (oy + height) does not move as it rises.
    expect(box.hiddenTop).toBe(8);
    expect(box.drawnOy).toBe(-12);
    expect(box.oy + box.height).toBe(box.drawnOy + (box.height - box.hiddenTop));
  });

  it('shifts a scaled reveal layer down by the scaled crop', () => {
    const box = createLayerDrawBox();
    layerDrawBox(box, layer({ reveal: 1, scale: 2 }), 0.25, false);
    // hiddenTop counts atlas texels while every other field is scaled px, so the shift must be scaled on
    // the way in — at scale 2 an 8-texel crop moves the drawn top 16 px, not 8.
    expect(box.hiddenTop).toBe(8);
    expect(box.drawnOy).toBe(box.oy + 16);
  });

  it('crops nothing when the caller bound a per-pixel reveal texture', () => {
    const box = createLayerDrawBox();
    layerDrawBox(box, layer({ reveal: 1 }), 0.25, true);
    // The baked TimeMask reveals pixels in place, so the quad still draws whole.
    expect(box.hiddenTop).toBe(0);
    expect(box.drawnOy).toBe(-20);
  });

  it('reports the uncropped rect as the bounds source even mid-reveal', () => {
    const risen = createLayerDrawBox();
    const flat = createLayerDrawBox();
    layerDrawBox(risen, layer({ reveal: 1 }), 0.05, false);
    layerDrawBox(flat, layer(), undefined, false);
    // A barely-started foundation must stay clickable over the finished building's whole box, so oy/width/
    // height ignore the crop entirely — only drawnOy/hiddenTop move.
    expect(risen.oy).toBe(flat.oy);
    expect(risen.width).toBe(flat.width);
    expect(risen.height).toBe(flat.height);
    expect(risen.drawnOy).toBeGreaterThan(flat.drawnOy);
  });

  it('hides a fully unrevealed layer by cropping its whole height', () => {
    const box = createLayerDrawBox();
    layerDrawBox(box, layer({ reveal: 1 }), 0, false);
    // The pool reads `hiddenTop >= frame.height` as "draw nothing this frame" (a 0% foundation).
    expect(box.hiddenTop).toBe(10);
  });
});

describe('BoundsUnion', () => {
  it('is empty until something is added', () => {
    const union = new BoundsUnion();
    expect(union.isEmpty()).toBe(true);
    union.add(0, 0, 1, 1);
    expect(union.isEmpty()).toBe(false);
  });

  it('unions overlapping and disjoint boxes into their outer extent', () => {
    const union = new BoundsUnion();
    union.add(-4, -20, 6, -10);
    union.add(-8, -14, 2, 0);
    expect(union).toMatchObject({ minX: -8, minY: -20, maxX: 6, maxY: 0 });
  });

  it('reset drops the previous entity’s box', () => {
    const union = new BoundsUnion();
    union.add(-100, -100, 100, 100);
    union.reset();
    expect(union.isEmpty()).toBe(true);
    union.add(0, -5, 1, 0);
    expect(union).toMatchObject({ minX: 0, minY: -5, maxX: 1, maxY: 0 });
  });
});

describe('placeholderBounds', () => {
  it('sizes a wide marker to its body box', () => {
    // A building's 28-wide body is wider than the footprint diamond, so the body decides the half-width.
    expect(placeholderBounds('building')).toEqual({ minX: -14, minY: -40, maxX: 14, maxY: 5 });
  });

  it('floors a narrow marker at the footprint diamond it stands on', () => {
    // A settler's 14-wide body is narrower than the 9-half-width diamond; the box must still cover the
    // drawn diamond, or clicks on the marker's tips would miss.
    expect(placeholderBounds('settler')).toMatchObject({ minX: -9, maxX: 9 });
  });

  it('covers the arrow marker’s own extent', () => {
    expect(placeholderBounds('projectile')).toMatchObject({ minX: -11, maxX: 11 });
  });
});
