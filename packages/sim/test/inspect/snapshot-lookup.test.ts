import { describe, expect, it } from 'vitest';
import { entityById, Simulation, type WorldSnapshot } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * `entityById` is the shared random-access read over a snapshot (render's selection rings, the app's
 * panels and highlights), binary-searching the canonical ascending-id order `takeSnapshot` emits.
 * Live ids are sparse because entities die, so the search can never assume `id === index`.
 */

/** A hand-built snapshot value carrying the given ascending ids, the shape `takeSnapshot` produces. */
function snap(ids: readonly number[]): WorldSnapshot {
  return { tick: 1, entities: ids.map((id) => ({ id, components: {} })), events: [] };
}

describe('entityById', () => {
  const sparse = snap([2, 5, 9, 40]);

  it('resolves every live id, at every position in the array', () => {
    for (const entity of sparse.entities) {
      expect(entityById(sparse, entity.id)).toBe(entity);
    }
  });

  it('returns undefined for an id the snapshot does not carry', () => {
    expect(entityById(sparse, 1)).toBeUndefined(); // below the first live id
    expect(entityById(sparse, 7)).toBeUndefined(); // a gap inside the live range
    expect(entityById(sparse, 99)).toBeUndefined(); // past the last live id
    expect(entityById(snap([]), 1)).toBeUndefined();
  });

  it('resolves a real snapshot whose ids were made sparse by deaths, and misses the dead', () => {
    // The ascending-order precondition is takeSnapshot's, not the caller's, so prove the search holds
    // on the real path, and that a destroyed id answers undefined instead of a surviving neighbour.
    const sim = new Simulation({ seed: 1, content: testContent() });
    const created = Array.from({ length: 9 }, () => sim.world.create());
    const dead = created.filter((_, i) => i % 3 !== 0);
    for (const e of dead) sim.world.destroy(e);

    const live = sim.snapshot();
    expect(live.entities.map((e) => e.id)).toEqual(created.filter((e) => !dead.includes(e)));
    for (const entity of live.entities) {
      expect(entityById(live, entity.id)).toBe(entity);
    }
    for (const e of dead) expect(entityById(live, e)).toBeUndefined();
  });
});
