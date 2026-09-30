import { describe, expect, it } from 'vitest';
import { SpriteDepthOrder } from '../../src/data/scene/depth-order.js';
import type { SpriteDrawItem } from '../../src/data/scene/draw-item.js';

const item = (ref: number, depth: number): SpriteDrawItem => ({
  kind: 'settler',
  ref,
  depth,
  x: 0,
  y: 0,
  state: 'idle',
});
const oracle = (items: SpriteDrawItem[]) => [...items].sort((a, b) => a.depth - b.depth || a.ref - b.ref);

describe('retained scene depth order', () => {
  it('matches total painter order across movement, ties, culling and camera jumps', () => {
    const order = new SpriteDepthOrder();
    for (let frame = 0; frame < 30; frame++) {
      const items = Array.from({ length: frame % 7 === 0 ? 73 : 80 }, (_, ref) =>
        item(ref, (ref * 13 + frame * 17) % 23),
      ).reverse();
      const expected = oracle(items);
      order.sort(items);
      expect(items).toEqual(expected);
      expect(items.every((value, i) => value === expected[i])).toBe(true);
    }
  });

  it('preserves fractional depths and refs above 32 bits across membership changes', () => {
    const order = new SpriteDepthOrder();
    for (let frame = 0; frame < 24; frame++) {
      const items = Array.from({ length: frame % 5 === 0 ? 17 : 65 }, (_, i) =>
        item(2 ** 40 + (i % 3) * 2 ** 32 + i, ((i * 7 + frame * 3) % 11) / 8),
      ).reverse();
      const expected = oracle(items);
      order.sort(items);
      expect(items).toEqual(expected);
    }
  });

  it('uses the native comparator for non-finite keys and then resumes finite ordering', () => {
    const order = new SpriteDepthOrder();
    const unusual = [item(3, Number.NaN), item(2, Infinity), item(1, -Infinity), item(4, 0)];
    const expected = oracle(unusual);
    order.sort(unusual);
    expect(unusual).toEqual(expected);
    const finite = [item(4, 0.25), item(3, -0.125), item(2, 0.25), item(1, 0)];
    const finiteExpected = oracle(finite);
    order.sort(finite);
    expect(finite).toEqual(finiteExpected);
  });

  it('keeps fresh item identities while reusing the preceding membership order', () => {
    const order = new SpriteDepthOrder();
    order.sort([item(1, 1), item(2, 2), item(3, 3)]);
    const moved = [item(3, 0), item(1, 1), item(2, 1)];
    order.sort(moved);
    expect(moved.map((value) => value.ref)).toEqual([3, 1, 2]);
    order.sort([]);
    const returning = [item(2, 0), item(1, 0)];
    order.sort(returning);
    expect(returning.map((value) => value.ref)).toEqual([1, 2]);
    const singleton = item(9, 0);
    order.sort([singleton]);
    expect(Reflect.get(order, 'scratch')).toEqual([undefined]);
  });
});
