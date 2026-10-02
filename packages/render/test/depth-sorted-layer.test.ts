import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { DepthSortedLayer } from '../src/gpu/depth-sorted-layer.js';
import { restoreStash, stashHidden } from '../src/gpu/visibility.js';

/** Depths this far apart always file into different bands; closer ones may share one. */
const FAR = 10_000;

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

  it('matches Pixi’s single stable sort through adds, removals, re-adds and band crossings', () => {
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
});
