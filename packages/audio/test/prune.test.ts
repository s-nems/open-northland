import { describe, expect, it } from 'vitest';
import { pruneExpired } from '../src/web/prune.js';

/**
 * The shared cooldown-map eviction both impure audio units use: a no-op until the map outgrows its
 * bound, then a single sweep dropping only entries at/past the age window. The two boundaries it
 * concentrates — the `< maxSize` guard and the `>= maxAge` cutoff — are exactly what a caller relies
 * on, so they are pinned here directly rather than only transitively through chatter/engine.
 */
describe('pruneExpired', () => {
  const MAX_SIZE = 3;
  const MAX_AGE = 100;

  it('is a no-op while the map is below maxSize, even with stale entries', () => {
    const map = new Map<string, number>([
      ['a', 0], // age 1000 — far past maxAge, but the map is under the size bound
      ['b', 900],
    ]);
    pruneExpired(map, MAX_SIZE, 1000, MAX_AGE);
    expect([...map.keys()]).toEqual(['a', 'b']);
  });

  it('once at/over maxSize, drops entries at or past maxAge and keeps younger ones', () => {
    const now = 1000;
    const map = new Map<string, number>([
      ['expired', now - MAX_AGE - 1], // age > maxAge → dropped
      ['boundary', now - MAX_AGE], // age === maxAge → dropped (>= cutoff)
      ['fresh', now - MAX_AGE + 1], // age < maxAge → kept
    ]);
    pruneExpired(map, MAX_SIZE, now, MAX_AGE);
    expect([...map.keys()]).toEqual(['fresh']);
  });

  it('serves a numeric-keyed map the same as a string-keyed one (generic K)', () => {
    const now = 500;
    const map = new Map<number, number>([
      [1, now - MAX_AGE - 50],
      [2, now - 1],
      [3, now - MAX_AGE - 5],
    ]);
    pruneExpired(map, MAX_SIZE, now, MAX_AGE);
    expect([...map.keys()]).toEqual([2]);
  });
});
