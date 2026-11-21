import { describe, expect, it, vi } from 'vitest';
import { WalkerHits } from '../../../src/gpu/overlays/walker-hits.js';
import type { DrawnWalker } from '../../../src/gpu/sprite-pool/index.js';
import { snapshotOf } from '../../support/fixtures.js';

const PICKED = 2;
const walkersOf = (...refs: number[]): DrawnWalker[] => refs.map((ref) => ({ ref, marksGround: true }));

describe('WalkerHits', () => {
  it('reads the walkers again for a new snapshot or drawn list, and not on the frames between', () => {
    const read = vi.fn((_snapshot: unknown, ref: number) => (ref === PICKED ? ref : undefined));
    const hits = new WalkerHits(read);
    const snapshot = snapshotOf([]);
    const walkers = walkersOf(1, PICKED, 3);

    expect(hits.of(snapshot, walkers)).toEqual([{ ref: PICKED, value: PICKED }]);
    expect(read).toHaveBeenCalledTimes(walkers.length);
    hits.of(snapshot, walkers);
    expect(read).toHaveBeenCalledTimes(walkers.length);

    hits.of(snapshotOf([]), walkers);
    expect(read).toHaveBeenCalledTimes(2 * walkers.length);
    const panned = walkersOf(PICKED);
    hits.of(snapshot, panned);
    expect(read).toHaveBeenCalledTimes(2 * walkers.length + panned.length);
    hits.forget();
    hits.of(snapshot, panned);
    expect(read).toHaveBeenCalledTimes(2 * walkers.length + 2 * panned.length);
  });
});
