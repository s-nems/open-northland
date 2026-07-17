import { describe, expect, it } from 'vitest';
import { workerRoleOf } from '../src/game/sandbox/index.js';
import { createFogGates, createSnapshotProjections } from '../src/view/projections/index.js';
import { building, settler, snapshotOf } from './support/snapshot.js';

/**
 * The identity memo behind the frame loop's per-tick projections: an O(entities) read must run once per
 * SNAPSHOT, not once per RAF frame (the loop calls these every frame while the fixed timestep may not
 * have stepped). Pinned here because nothing else fails when the memo silently stops hitting — the cost
 * is invisible to every other test.
 */
describe('createSnapshotProjections — memoized by snapshot identity', () => {
  const HOME_TYPE = 2;
  const projectionsFor = () => createSnapshotProjections(new Map(), workerRoleOf, createFogGates());
  const snap = snapshotOf([building(10, HOME_TYPE, 1, 1), settler(1, 0, 10)]);

  it('returns the identical reference for the same snapshot, a fresh one for the next', () => {
    const { hudFor, doorBadgesFor } = projectionsFor();
    expect(hudFor(snap)).toBe(hudFor(snap));
    expect(doorBadgesFor(snap)).toBe(doorBadgesFor(snap));

    const next = snapshotOf([building(10, HOME_TYPE, 1, 1)]); // a new tick's snapshot — a new instance
    expect(doorBadgesFor(next)).not.toBe(doorBadgesFor(snap));
  });
});
