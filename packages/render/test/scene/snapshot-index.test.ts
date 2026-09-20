import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { ONE } from '../../src/data/projection/index.js';
import { signpostBoardsOf } from '../../src/data/scene/signpost-boards.js';
import { enterableStoresOf, targetPositionsOf } from '../../src/data/scene/snapshot-index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/** The combat attack atomic (id 81) - the same numeric contract `snapshot-index.ts` transcribes. */
const ATTACK_ATOMIC_ID = 81;

/** A snapshot whose entity list counts full walks: `for...of` passes, not the index reads an id lookup
 *  does. */
function walkCounting(snapshot: WorldSnapshot): { snapshot: WorldSnapshot; walks: () => number } {
  let walks = 0;
  const entities = new Proxy(snapshot.entities, {
    get(target, prop, receiver) {
      if (prop === Symbol.iterator) walks++;
      return Reflect.get(target, prop, receiver);
    },
  });
  return { snapshot: { ...snapshot, entities }, walks: () => walks };
}

describe('targetPositionsOf', () => {
  it('indexes only the referenced targets, never every positioned entity', () => {
    // One attacker aiming at entity 2, plus bystanders 3..5 that nothing targets.
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

  it('returns the shared empty index for a snapshot with no target-facing actor', () => {
    const quietA = snapshotOf([entity(1, 1, 1, { Settler: { tribe: 0 } })]);
    const quietB = snapshotOf([entity(2, 2, 2, { Resource: { level: 3 } })]);
    expect(targetPositionsOf(quietA).size).toBe(0);
    expect(targetPositionsOf(quietA)).toBe(targetPositionsOf(quietB)); // one shared instance
  });

  it('skips a target ref the snapshot no longer carries (it died this tick)', () => {
    const snap = snapshotOf([
      entity(1, 1, 1, {
        Settler: { tribe: 0 },
        CurrentAtomic: { atomicId: ATTACK_ATOMIC_ID, elapsed: 1, targetEntity: 99 },
      }),
    ]);
    expect(targetPositionsOf(snap).size).toBe(0);
  });

  it('memoizes by snapshot identity - a second frame over the same tick reuses the index', () => {
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

describe('the shared scene walk', () => {
  // The posts carry each other as a stored link, so both draw a board.
  const SIGNPOST_4 = { Signpost: { links: [5] }, Owner: { player: 0 } };
  const SIGNPOST_5 = { Signpost: { links: [4] }, Owner: { player: 0 } };
  const world = () =>
    snapshotOf([
      entity(1, 1, 1, {
        Settler: { tribe: 0 },
        CurrentAtomic: { atomicId: ATTACK_ATOMIC_ID, elapsed: 1, targetEntity: 2 },
      }),
      entity(2, 2, 1, { Settler: { tribe: 1 } }),
      entity(3, 3, 1, { Building: { buildingType: 7, tribe: 0 } }),
      entity(4, 4, 1, SIGNPOST_4),
      entity(5, 5, 1, SIGNPOST_5),
    ]);

  it('walks the entity list once for every pre-scan a frame reads', () => {
    const { snapshot, walks } = walkCounting(world());
    expect(enterableStoresOf(snapshot)).toEqual(new Set([3]));
    expect(targetPositionsOf(snapshot).get(2)).toEqual({ x: 2 * ONE, y: 1 * ONE });
    expect(signpostBoardsOf(snapshot).size).toBe(2);
    expect(walks()).toBe(1);
  });

  it('walks nothing more on the frames that follow within the same tick', () => {
    const { snapshot, walks } = walkCounting(world());
    enterableStoresOf(snapshot);
    signpostBoardsOf(snapshot);
    enterableStoresOf(snapshot);
    targetPositionsOf(snapshot);
    signpostBoardsOf(snapshot);
    expect(walks()).toBe(1);
  });
});
