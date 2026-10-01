import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { DepthSortedLayer } from '../src/gpu/depth-sorted-layer.js';

describe('depth sorted retained instructions', () => {
  it('keeps instructions when depths change without changing painter order', () => {
    const layer = new DepthSortedLayer();
    layer.isRenderGroup = true;
    const a = layer.addChild(new Container()),
      b = layer.addChild(new Container());
    a.zIndex = 1;
    b.zIndex = 3;
    layer.sortChildren();
    layer.renderGroup.structureDidChange = false;
    a.zIndex = 2;
    b.zIndex = 4;
    layer.sortChildren();
    expect(layer.children).toEqual([a, b]);
    expect(layer.renderGroup.structureDidChange).toBe(false);
    b.zIndex = 0;
    layer.sortChildren();
    expect(layer.children).toEqual([b, a]);
    expect(layer.renderGroup.structureDidChange).toBe(true);
  });

  it('preserves stable ties and ordinary structural invalidations', () => {
    const layer = new DepthSortedLayer();
    layer.isRenderGroup = true;
    const children = Array.from({ length: 40 }, (_, i) => {
      const child = layer.addChild(new Container());
      child.zIndex = (i * 17) % 7;
      return child;
    });
    const expected = [...children].sort((a, b) => a.zIndex - b.zIndex);
    layer.sortChildren();
    expect(layer.children).toEqual(expected);
    expect(Reflect.get(layer, 'scratch')).not.toContain(children[0]);
    layer.renderGroup.structureDidChange = false;
    layer.removeChild(children[0] ?? new Container());
    expect(layer.renderGroup.structureDidChange).toBe(true);
    layer.sortChildren();
    expect(layer.renderGroup.structureDidChange).toBe(true);
  });

  it('matches stable native ordering for fractional moving depths and shrinking membership', () => {
    const layer = new DepthSortedLayer();
    layer.isRenderGroup = true;
    const children = Array.from({ length: 65 }, () => layer.addChild(new Container()));
    for (let frame = 0; frame < 12; frame++) {
      if (frame === 5) for (const child of children.slice(17)) layer.removeChild(child);
      const before = [...layer.children];
      layer.renderGroup.structureDidChange = false;
      for (let i = 0; i < before.length; i++) {
        const child = before[i];
        if (child !== undefined) child.zIndex = 2 ** 36 + ((i * 7 + frame * 3) % 11) / 8;
      }
      const expected = [...before].sort((a, b) => a.zIndex - b.zIndex);
      layer.sortChildren();
      expect(layer.children).toEqual(expected);
      expect(layer.renderGroup.structureDidChange).toBe(expected.some((child, i) => child !== before[i]));
      expect(Reflect.get(layer, 'scratch')).not.toContain(before[0]);
    }
  });

  it('falls back to the native stable comparator for non-finite depths', () => {
    const layer = new DepthSortedLayer();
    const children = [Number.NaN, Infinity, -Infinity, 0].map((depth) => {
      const child = layer.addChild(new Container());
      child.zIndex = depth;
      return child;
    });
    const expected = [...children].sort((a, b) => a.zIndex - b.zIndex);
    layer.sortChildren();
    expect(layer.children).toEqual(expected);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child !== undefined) child.zIndex = i / 8;
    }
    const finite = [...layer.children].sort((a, b) => a.zIndex - b.zIndex);
    layer.sortChildren();
    expect(layer.children).toEqual(finite);
  });

  it('sorts a depth-only reorder on its render group’s onRender pass, before the structure check', () => {
    const layer = new DepthSortedLayer();
    layer.isRenderGroup = true;
    const a = layer.addChild(new Container()),
      b = layer.addChild(new Container());
    a.zIndex = 1;
    b.zIndex = 2;
    layer.sortChildren();
    layer.renderGroup.structureDidChange = false;
    b.zIndex = 0;
    expect(layer.children).toEqual([a, b]);
    layer.renderGroup.runOnRender(undefined as never);
    expect(layer.children).toEqual([b, a]);
    expect(layer.renderGroup.structureDidChange).toBe(true);
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
    layer.renderGroup.structureDidChange = false;
    child.zIndex = 2;
    expect(notifications).toBe(1);
    expect(layer.renderGroup.structureDidChange).toBe(true);
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
});
