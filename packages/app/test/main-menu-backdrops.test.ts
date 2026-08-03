import { describe, expect, it } from 'vitest';
import { parseBackdropsIndex, shuffledOrder } from '../src/entries/main-menu/backdrops.js';

describe('parseBackdropsIndex', () => {
  it('accepts a string list and rejects anything else', () => {
    expect(parseBackdropsIndex(['01-a.jpg', '02-b.jpg'])).toEqual(['01-a.jpg', '02-b.jpg']);
    expect(parseBackdropsIndex([])).toEqual([]);
    expect(parseBackdropsIndex(['01-a.jpg', 7])).toBeNull();
    expect(parseBackdropsIndex({ files: [] })).toBeNull();
    expect(parseBackdropsIndex(null)).toBeNull();
  });
});

describe('shuffledOrder', () => {
  it('permutes every index exactly once', () => {
    const order = shuffledOrder(8, () => 0.31);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('is pinned by the injected rng', () => {
    expect(shuffledOrder(4, () => 0)).toEqual(shuffledOrder(4, () => 0));
    expect(shuffledOrder(4, () => 0.99)).toEqual([0, 1, 2, 3]);
  });

  it('handles empty and single-image pools', () => {
    expect(shuffledOrder(0, () => 0.5)).toEqual([]);
    expect(shuffledOrder(1, () => 0.5)).toEqual([0]);
  });
});
