import { describe, expect, it } from 'vitest';
import { reconcileSprites } from '../src/world-renderer.js';

/**
 * Unit test for the retained renderer's one PURE decision — pool bookkeeping — extracted so it is
 * self-verifiable without a GPU. `reconcileSprites` decides which pooled sprites to DESTROY: an entity
 * that has left the snapshot (died) frees its objects, while one merely culled off-screen (still live)
 * is kept in the pool for when it scrolls back. Getting this wrong is either a leak (never destroy) or a
 * flicker (destroy the culled). The Pixi mutation around it is the human-gated half.
 */

describe('reconcileSprites', () => {
  it('destroys pooled entities absent from the live set (died), keeps culled-but-live ones', () => {
    const live = new Set([1, 2, 4]);
    const pooled = [1, 2, 3, 4, 5]; // 3 and 5 have left the snapshot
    expect(reconcileSprites(live, pooled).toDestroy).toEqual([3, 5]);
  });

  it('destroys nothing when every pooled entity is still live (e.g. all merely off-screen)', () => {
    expect(reconcileSprites(new Set([1, 2, 3]), [1, 2, 3]).toDestroy).toEqual([]);
  });

  it('is empty for an empty pool, whatever the live set', () => {
    expect(reconcileSprites(new Set([1, 2]), []).toDestroy).toEqual([]);
  });

  it('ignores live refs that were never pooled', () => {
    expect(reconcileSprites(new Set([1, 2, 3, 4]), [2]).toDestroy).toEqual([]);
  });

  it('preserves pooled iteration order in the destroy list (deterministic)', () => {
    expect(reconcileSprites(new Set<number>(), [5, 1, 3]).toDestroy).toEqual([5, 1, 3]);
  });
});
