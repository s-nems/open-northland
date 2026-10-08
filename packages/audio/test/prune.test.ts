import { describe, expect, it } from 'vitest';
import { pruneExpired } from '../src/data/prune.js';

/**
 * The bookkeeping-map eviction the one-shot ledger uses: a no-op until the map outgrows its bound, then a
 * single sweep dropping only the entries the caller calls expired.
 */
describe('pruneExpired', () => {
  const MAX_SIZE = 3;
  const MAX_AGE = 100;
  const NOW = 1000;
  const olderThanMaxAge = (when: number): boolean => NOW - when >= MAX_AGE;

  it('is a no-op while the map is below maxSize, even with stale entries', () => {
    const map = new Map<string, number>([
      ['a', 0], // far past maxAge, but the map is under the size bound
      ['b', 900],
    ]);
    pruneExpired(map, MAX_SIZE, olderThanMaxAge);
    expect([...map.keys()]).toEqual(['a', 'b']);
  });

  it('once at maxSize, drops exactly the expired entries', () => {
    const map = new Map<string, number>([
      ['expired', NOW - MAX_AGE - 1],
      ['boundary', NOW - MAX_AGE],
      ['fresh', NOW - MAX_AGE + 1],
    ]);
    pruneExpired(map, MAX_SIZE, olderThanMaxAge);
    expect([...map.keys()]).toEqual(['fresh']);
  });

  it('serves any key and value type', () => {
    const map = new Map<number, { readonly endsAt: number }>([
      [1, { endsAt: NOW - 1 }],
      [2, { endsAt: NOW + 1 }],
      [3, { endsAt: NOW }],
    ]);
    pruneExpired(map, MAX_SIZE, (play) => play.endsAt <= NOW);
    expect([...map.keys()]).toEqual([2]);
  });
});
