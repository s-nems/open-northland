import { describe, expect, it } from 'vitest';
import { ONE } from '../../src/data/projection/index.js';
import { targetPositionsOf } from '../../src/data/scene/snapshot-index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/** The combat attack atomic (id 81) — the same numeric contract `snapshot-index.ts` transcribes. */
const ATTACK_ATOMIC_ID = 81;

describe('targetPositionsOf', () => {
  it('indexes only the referenced targets, never every positioned entity', () => {
    // One attacker aiming at entity 2, plus bystanders 3..5 that nothing targets: a busy map's
    // standing forests must not be re-indexed each tick just because someone somewhere is fighting.
    const snap = snapshotOf([
      entity(1, 1, 1, {
        Settler: { tribe: 0 },
        CurrentAtomic: { atomicId: ATTACK_ATOMIC_ID, elapsed: 1, targetEntity: 2 },
      }),
      entity(2, 2, 1, { Settler: { tribe: 1 } }),
      entity(3, 3, 1, { Resource: { level: 3 } }),
      entity(4, 4, 1, { Resource: { level: 3 } }),
      entity(5, 5, 1, { Settler: { tribe: 0 } }),
    ]);
    const index = targetPositionsOf(snap);
    expect(index.size).toBe(1);
    expect(index.get(2)).toEqual({ x: 2 * ONE, y: 1 * ONE });
  });

  it('indexes a projectile target', () => {
    const snap = snapshotOf([
      entity(1, 1, 1, { Projectile: { target: 2, originX: ONE, originY: ONE } }),
      entity(2, 2, 2, { Settler: { tribe: 1 } }),
      entity(3, 3, 3, { Settler: { tribe: 0 } }),
    ]);
    const index = targetPositionsOf(snap);
    expect(index.size).toBe(1);
    expect(index.get(2)).toEqual({ x: 2 * ONE, y: 2 * ONE });
  });

  it('returns the shared empty index for a snapshot with no target-facing actor', () => {
    const quietA = snapshotOf([entity(1, 1, 1, { Settler: { tribe: 0 } })]);
    const quietB = snapshotOf([entity(2, 2, 2, { Resource: { level: 3 } })]);
    expect(targetPositionsOf(quietA).size).toBe(0);
    expect(targetPositionsOf(quietA)).toBe(targetPositionsOf(quietB)); // one shared instance
  });

  it('memoizes by snapshot identity — a second frame over the same tick reuses the index', () => {
    const snap = snapshotOf([
      entity(1, 1, 1, {
        Settler: { tribe: 0 },
        CurrentAtomic: { atomicId: ATTACK_ATOMIC_ID, elapsed: 1, targetEntity: 2 },
      }),
      entity(2, 2, 1, { Settler: { tribe: 1 } }),
    ]);
    expect(targetPositionsOf(snap)).toBe(targetPositionsOf(snap));
  });
});
