import { describe, expect, it } from 'vitest';
import { randomStill } from '../src/entries/main-menu/backdrops.js';
import { rotationOrder } from '../src/entries/main-menu/rotation.js';

const POOL = ['01-a.jpg', '02-b.jpg', '03-c.jpg', '04-d.jpg'];

describe('randomStill', () => {
  it('draws from the pool, pinned by the injected rng', () => {
    expect(randomStill(POOL, null, () => 0)).toBe('01-a.jpg');
    expect(randomStill(POOL, null, () => 0.99)).toBe('04-d.jpg');
  });

  it('never draws the still already seen while the pool holds anything else', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) expect(randomStill(POOL, '01-a.jpg', () => r)).not.toBe('01-a.jpg');
  });

  it('repeats the one still rather than leaving the menu with nothing', () => {
    expect(randomStill(['01-a.jpg'], '01-a.jpg', () => 0.5)).toBe('01-a.jpg');
  });

  it('reads an empty pool as no still', () => {
    expect(randomStill([], null, () => 0.5)).toBeNull();
  });
});

describe('rotationOrder', () => {
  it('visits every still exactly once', () => {
    expect([...rotationOrder(POOL, null, () => 0.31)].sort()).toEqual([...POOL].sort());
  });

  it('is pinned by the injected rng', () => {
    expect(rotationOrder(POOL, null, () => 0)).toEqual(rotationOrder(POOL, null, () => 0));
    expect(rotationOrder(POOL, null, () => 0.99)).toEqual(POOL);
  });

  it('leads with the still already on screen, and still visits the rest', () => {
    const order = rotationOrder(POOL, '03-c.jpg', () => 0.99);
    expect(order[0]).toBe('03-c.jpg');
    expect([...order].sort()).toEqual([...POOL].sort());
  });

  it('ignores a still the pool no longer has', () => {
    expect(rotationOrder(POOL, '09-gone.jpg', () => 0.99)).toEqual(POOL);
  });

  it('handles empty and single-image pools', () => {
    expect(rotationOrder([], null, () => 0.5)).toEqual([]);
    expect(rotationOrder(['01-a.jpg'], '01-a.jpg', () => 0.5)).toEqual(['01-a.jpg']);
  });
});
