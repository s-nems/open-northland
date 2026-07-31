import { fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { workerRoleOf } from '../src/game/sandbox/index.js';
import { forEachMinimapDot } from '../src/hud/minimap/dots.js';
import { terrainWorldBounds } from '../src/hud/minimap/model.js';
import { createFogGates, createSnapshotProjections } from '../src/view/projections/index.js';
import { building, type Ent, settler, snapshotOf, visitCountingSnapshot } from './support/snapshot.js';

/**
 * The identity memo behind the frame loop's per-tick projections: an O(entities) read must run once per
 * SNAPSHOT, not once per RAF frame (the loop calls these every frame while the fixed timestep may not
 * have stepped). Pinned here because nothing else fails when the memo silently stops hitting — the cost
 * is invisible to every other test.
 */
describe('createSnapshotProjections — memoized by snapshot identity', () => {
  const HOME_TYPE = 2;
  const projectionsFor = () =>
    createSnapshotProjections(new Map(), workerRoleOf, createFogGates(), { isLivestockTribe: () => false });
  const snap = snapshotOf([building(10, HOME_TYPE, 1, 1), settler(1, 0, 10)]);

  it('returns the identical reference for the same snapshot, a fresh one for the next', () => {
    const { hudFor, doorBadgesFor } = projectionsFor();
    expect(hudFor(snap)).toBe(hudFor(snap));
    expect(doorBadgesFor(snap)).toBe(doorBadgesFor(snap));

    const next = snapshotOf([building(10, HOME_TYPE, 1, 1)]); // a new tick's snapshot — a new instance
    expect(doorBadgesFor(next)).not.toBe(doorBadgesFor(snap));
  });
});

/**
 * The scale half of the same contract: a decoded map's entity count is dominated by scenery, so the
 * per-tick projections must share ONE walk of it (`actorsOf`) instead of each re-walking the map. Pinned
 * by counting entities handed out, because a projection that quietly walks `entities` again still returns
 * the right answer.
 */
describe('per-tick projections — one walk of the map between them', () => {
  const HOME_TYPE = 2;
  const SCENERY = 400;
  const PLAYER = 0;
  /** A resource node: the scenery a real map plants in the tens of thousands, read by no projection. */
  const tree = (id: number): Ent => ({
    id,
    components: { Resource: { goodType: 1 }, Position: { x: fx.fromInt(id), y: fx.fromInt(id) } },
  });
  const owned = (e: Ent, x: number, y: number): Ent => ({
    id: e.id,
    components: {
      ...e.components,
      Owner: { player: PLAYER },
      Position: { x: fx.fromInt(x), y: fx.fromInt(y) },
    },
  });

  it('hands out each entity once, not once per projection', () => {
    const entities: Ent[] = [owned(building(10, HOME_TYPE, 1, 1), 1, 1), owned(settler(11, 0, 10), 2, 2)];
    for (let i = 0; i < SCENERY; i++) entities.push(tree(100 + i));
    const { snapshot, visits } = visitCountingSnapshot(snapshotOf(entities));

    const { doorBadgesFor, settlerBubblesFor, livestockHeartsFor } = createSnapshotProjections(
      new Map(),
      workerRoleOf,
      createFogGates(),
      { isLivestockTribe: () => false },
    );
    doorBadgesFor(snapshot); // a tally pass, a projection pass, and the household grouping
    settlerBubblesFor(snapshot);
    livestockHeartsFor(snapshot);
    forEachMinimapDot(snapshot, null, terrainWorldBounds(8, 8), 0.5, undefined, () => undefined);

    // One shared pass builds the actor index; each projection then reads only that.
    expect(visits()).toBe(entities.length);
  });
});
