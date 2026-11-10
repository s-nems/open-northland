import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { drawPassDepth, rowOfDepth } from '../../../src/data/scene/index.js';
import { PLOT_BOUNDS } from '../../../src/gpu/placement/plan-road.js';
import { BAND_DEPTH, DepthSortedLayer } from '../../../src/gpu/world-renderer/depth-sorted-layer.js';
import { restoreStash, stashHidden } from '../../../src/gpu/world-views/visibility.js';

/** Depths this far apart always file into different bands; closer ones may share one. */
const FAR = 10_000;
/** A window of feet rows whose edges fall mid-band. */
const WINDOW_TOP = 7 * BAND_DEPTH + BAND_DEPTH / 2;
const WINDOW_BOTTOM = 12 * BAND_DEPTH + BAND_DEPTH / 2;

function layerWith(depths: readonly number[]): { layer: DepthSortedLayer; children: Container[] } {
  const layer = new DepthSortedLayer();
  layer.isRenderGroup = true;
  const children = depths.map((depth) => {
    const child = new Container();
    child.zIndex = depth;
    return layer.addChild(child);
  });
  layer.sortChildren();
  return { layer, children };
}

function bandOf(child: Container): Container {
  const band = child.parent;
  if (band === null) throw new Error('child is not in a band');
  return band;
}

function settle(layer: DepthSortedLayer): void {
  layer.renderGroup.structureDidChange = false;
  for (const band of layer.children) band.renderGroup.structureDidChange = false;
}

/** Pixi's own painter order: one array, appended on add, stable-sorted by depth. */
class FlatOrder {
  list: Container[] = [];

  add(child: Container): void {
    this.remove(child);
    this.list.push(child);
  }

  remove(child: Container): void {
    const at = this.list.indexOf(child);
    if (at >= 0) this.list.splice(at, 1);
  }

  sort(): void {
    this.list = [...this.list].sort((a, b) => a.zIndex - b.zIndex);
  }
}

/** Deterministic test noise. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('depth sorted layer', () => {
  it('keeps a band’s instructions when depths change without changing its painter order', () => {
    const { layer, children } = layerWith([1, 3]);
    const [a, b] = children;
    if (a === undefined || b === undefined) throw new Error('missing children');
    settle(layer);
    a.zIndex = 2;
    b.zIndex = 4;
    layer.sortChildren();
    expect(layer.entries()).toEqual([a, b]);
    expect(bandOf(a).renderGroup.structureDidChange).toBe(false);
    b.zIndex = 0;
    layer.sortChildren();
    expect(layer.entries()).toEqual([b, a]);
    expect(bandOf(a).renderGroup.structureDidChange).toBe(true);
    expect(layer.renderGroup.structureDidChange).toBe(false);
  });

  it('rebuilds only the band whose entries changed', () => {
    const { layer, children } = layerWith([0, 1, FAR, FAR + 1]);
    const [near, , far] = children;
    if (near === undefined || far === undefined) throw new Error('missing children');
    expect(bandOf(near)).not.toBe(bandOf(far));
    settle(layer);
    near.visible = false;
    expect(bandOf(near).renderGroup.structureDidChange).toBe(true);
    expect(bandOf(far).renderGroup.structureDidChange).toBe(false);
    expect(layer.renderGroup.structureDidChange).toBe(false);
  });

  it('moves a child whose depth crossed bands twice once, and leaves one whose depth came back', () => {
    const { layer, children } = layerWith([0, 1, FAR]);
    const [crosser, returner, far] = children;
    if (crosser === undefined || returner === undefined || far === undefined) throw new Error('missing');
    const home = bandOf(returner);
    crosser.zIndex = FAR / 2;
    crosser.zIndex = FAR + 1;
    returner.zIndex = FAR;
    returner.zIndex = 1;
    settle(layer);
    layer.sortChildren();
    expect(bandOf(crosser)).toBe(bandOf(far));
    expect(layer.entries()).toEqual([returner, far, crosser]);
    expect(bandOf(returner)).toBe(home);
    expect(home.renderGroup.structureDidChange).toBe(true);
    layer.destroy({ children: true });
  });

  it('matches Pixi’s single stable sort through adds, removals, re-adds, re-arrivals and band crossings', () => {
    const next = random(7);
    const layer = new DepthSortedLayer();
    layer.isRenderGroup = true;
    const flat = new FlatOrder();
    const pool = Array.from({ length: 80 }, () => new Container());
    // Few distinct depths across several bands, so ties and crossings are common.
    const depth = (): number => Math.floor(next() * 12) * 97;
    for (let frame = 0; frame < 200; frame++) {
      for (const child of pool) {
        const roll = next();
        const attached = child.parent !== null;
        if (!attached && roll < 0.2) {
          if (next() < 0.5) child.zIndex = depth();
          layer.addChild(child);
          flat.add(child);
          // A depth written after the add files the child late, as a fresh arrival.
          if (next() < 0.3) child.zIndex = depth();
        } else if (attached && roll < 0.05) {
          layer.removeChild(child);
          flat.remove(child);
        } else if (attached && roll < 0.08) {
          child.removeFromParent();
          flat.remove(child);
        } else if (attached && roll < 0.1) {
          layer.addChild(child);
          flat.add(child);
        } else if (attached && roll < 0.2) {
          if (next() < 0.5) child.zIndex = depth();
          layer.rearrive(child);
          flat.add(child);
        } else if (attached && roll < 0.4) {
          child.zIndex = depth();
        }
      }
      layer.sortChildren();
      flat.sort();
      expect(layer.entries()).toEqual(flat.list);
      // Moving entries between bands leaves nothing queued for the next frame.
      expect(layer.sortDirty).toBe(false);
      const counts = layer.children.map((band) => band.children.length);
      expect(counts.every((count) => count > 0)).toBe(true);
    }
  });

  it('keeps a band’s instructions when its children re-arrive in their painter order', () => {
    const { layer, children } = layerWith([5, 5, 5, 7]);
    const [a, b, c, d] = children;
    if (a === undefined || b === undefined || c === undefined || d === undefined)
      throw new Error('missing children');
    settle(layer);
    for (const child of [b, c, d]) layer.rearrive(child);
    layer.sortChildren();
    expect(layer.entries()).toEqual([a, b, c, d]);
    expect(bandOf(a).renderGroup.structureDidChange).toBe(false);
    layer.rearrive(a);
    layer.sortChildren();
    expect(layer.entries()).toEqual([b, c, a, d]);
    expect(bandOf(a).renderGroup.structureDidChange).toBe(true);
  });

  it('sorts on its render group’s onRender pass, before the structure check', () => {
    const { layer, children } = layerWith([1, 2]);
    const [a, b] = children;
    if (a === undefined || b === undefined) throw new Error('missing children');
    settle(layer);
    b.zIndex = 0;
    expect(layer.entries()).toEqual([a, b]);
    layer.renderGroup.runOnRender(undefined as never);
    expect(layer.entries()).toEqual([b, a]);
    expect(bandOf(a).renderGroup.structureDidChange).toBe(true);
  });

  it('retires a band its last entry left and files infinite and NaN depths at the ends', () => {
    const { layer, children } = layerWith([
      0,
      FAR,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
    const [zero, far, nan, high, low] = children;
    expect(layer.entries()).toEqual([low, zero, far, high, nan]);
    if (far === undefined) throw new Error('missing child');
    const bands = layer.children.length;
    far.destroy();
    layer.sortChildren();
    expect(layer.children).toHaveLength(bands - 1);
    expect(layer.entries()).toEqual([low, zero, high, nan]);
  });

  it('preserves custom depth notifications on attachment and reattachment', () => {
    const layer = new DepthSortedLayer();
    layer.isRenderGroup = true;
    const child = new Container();
    layer.addChild(child);
    layer.removeChild(child);
    let notifications = 0;
    const ordinary = child.depthOfChildModified;
    const custom = function (this: Container): void {
      notifications++;
      ordinary.call(this);
    };
    child.depthOfChildModified = custom;
    layer.addChild(child);
    settle(layer);
    child.zIndex = 2;
    expect(notifications).toBe(1);
    expect(bandOf(child).renderGroup.structureDidChange).toBe(true);
    layer.removeChild(child);
    expect(child.depthOfChildModified).toBe(custom);
    layer.destroy();
    child.destroy();
  });

  it('restores ordinary depth notification after a child leaves the layer', () => {
    const layer = new DepthSortedLayer(),
      other = new Container();
    const child = new Container();
    const original = child.depthOfChildModified;
    layer.addChild(child);
    other.addChild(child);
    expect(child.depthOfChildModified).toBe(original);
    other.sortDirty = false;
    child.zIndex = 4;
    expect(other.sortDirty).toBe(true);
  });

  it('hides every other entry but keeps the band holding a solo subject visible', () => {
    const { layer, children } = layerWith([0, 1, FAR]);
    const [solo, neighbour, far] = children;
    if (solo === undefined || neighbour === undefined || far === undefined)
      throw new Error('missing children');
    const stash = stashHidden(layer.children, solo);
    expect([solo.visible, bandOf(solo).visible]).toEqual([true, true]);
    expect([neighbour.visible, bandOf(far).visible]).toEqual([false, false]);
    restoreStash(stash);
    expect([neighbour.visible, bandOf(far).visible]).toEqual([true, true]);
  });

  it('hides the bands of every pass whose rows miss a window, and restores them', () => {
    const fish = drawPassDepth('fish');
    const ground = drawPassDepth('ground');
    const { layer, children } = layerWith([100, FAR, fish + 100, ground + FAR, Number.MAX_SAFE_INTEGER]);
    const [near, far, nearFish, farGround, pinned] = children;
    if (!near || !far || !nearFish || !farGround || !pinned) throw new Error('missing children');
    settle(layer);
    const hidden: Container[] = [];
    layer.hideBandsOutside(0, 200, hidden);
    expect([near, nearFish, pinned].map((child) => bandOf(child).visible)).toEqual([true, true, true]);
    expect([far, farGround].map((child) => bandOf(child).visible)).toEqual([false, false]);
    // The bands' own instructions stand; only the layer's list of bands changes.
    expect(layer.children.some((band) => band.renderGroup.structureDidChange)).toBe(false);
    layer.showBands(hidden);
    expect(layer.children.every((band) => band.visible)).toBe(true);
    expect(hidden).toEqual([]);
  });

  it('keeps a band reaching into the window from either edge and hides one wholly past it', () => {
    const sorted = drawPassDepth('sorted');
    const straddlingTop = sorted + WINDOW_TOP - BAND_DEPTH / 2;
    const straddlingBottom = sorted + WINDOW_BOTTOM;
    const pastBottom = sorted + WINDOW_BOTTOM + BAND_DEPTH;
    const { layer, children } = layerWith([straddlingTop, straddlingBottom, pastBottom]);
    const [top, bottom, past] = children;
    if (!top || !bottom || !past) throw new Error('missing children');
    // The first band starts above the window but its rows run into it.
    const topRow = rowOfDepth(Math.floor(straddlingTop / BAND_DEPTH) * BAND_DEPTH);
    if (topRow === null) throw new Error('expected a sorted-pass row');
    expect(topRow).toBeLessThan(WINDOW_TOP);
    expect(topRow + BAND_DEPTH).toBeGreaterThan(WINDOW_TOP);
    const hidden: Container[] = [];
    layer.hideBandsOutside(WINDOW_TOP, WINDOW_BOTTOM, hidden);
    expect([top, bottom, past].map((child) => bandOf(child).visible)).toEqual([true, true, false]);
    expect(hidden).toEqual([bandOf(past)]);
  });

  it('keeps a claimed road plot sorting back past the window top once the window lowers by the plot', () => {
    const sorted = drawPassDepth('sorted');
    // A plot anchored on the window's top row sorts back by the plot's top, onto the last row of a band
    // whose rows all lie above the anchor.
    const plotRow = Math.floor(WINDOW_TOP / BAND_DEPTH) * BAND_DEPTH - 1;
    const anchorRow = plotRow - PLOT_BOUNDS.top;
    const { layer, children } = layerWith([sorted + plotRow]);
    const [plot] = children;
    if (!plot) throw new Error('missing children');
    const hidden: Container[] = [];
    layer.hideBandsOutside(anchorRow, WINDOW_BOTTOM, hidden);
    expect(bandOf(plot).visible).toBe(false);
    layer.showBands(hidden);
    layer.hideBandsOutside(anchorRow + PLOT_BOUNDS.top, WINDOW_BOTTOM, hidden);
    expect(bandOf(plot).visible).toBe(true);
  });
});
