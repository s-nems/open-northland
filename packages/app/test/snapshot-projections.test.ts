import { terrainWorldBounds } from '@open-northland/render';
import { fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { workerRoleOf } from '../src/game/sandbox/index.js';
import { forEachMinimapDot } from '../src/hud/minimap/dots.js';
import { createFogGates, createSnapshotProjections } from '../src/view/projections/index.js';
import { building, type Ent, settler, snapshotOf, visitCountingSnapshot } from './support/snapshot.js';

/**
 * The identity memo behind the frame loop's per-tick projections: an O(entities) read must run once per
 * SNAPSHOT, not once per RAF frame (the loop calls these every frame while the fixed timestep may not
 * have stepped). Pinned here because nothing else fails when the memo silently stops hitting - the cost
 * is invisible to every other test.
 */
describe('createSnapshotProjections - memoized by snapshot identity', () => {
  const HOME_TYPE = 2;
  const PLAYER = 0;
  const projectionsFor = () =>
    createSnapshotProjections(PLAYER, new Map(), workerRoleOf, createFogGates(), {
      isLivestockTribe: () => false,
    });
  const snap = snapshotOf([building(10, HOME_TYPE, 1, 1), settler(1, 0, 10)]);

  it('returns the identical reference for the same snapshot, a fresh one for the next', () => {
    const { hudFor, doorBadgesFor } = projectionsFor();
    expect(hudFor(snap)).toBe(hudFor(snap));
    expect(doorBadgesFor(snap)).toBe(doorBadgesFor(snap));

    const next = snapshotOf([building(10, HOME_TYPE, 1, 1)]); // a new tick's snapshot - a new instance
    expect(doorBadgesFor(next)).not.toBe(doorBadgesFor(snap));
  });

  it('re-reads the hearts when the selection moves under a held snapshot (a paused pick)', () => {
    const selected = new Set<number>();
    let version = 0;
    const { lifeHeartsFor } = createSnapshotProjections(PLAYER, new Map(), workerRoleOf, createFogGates(), {
      isLivestockTribe: () => false,
      selection: { ids: () => selected, version: () => version },
    });
    const unhurt = snapshotOf([
      { id: 1, components: { Settler: { tribe: 1 }, Owner: { player: 0 }, Position: { x: 0, y: 0 } } },
    ]);
    expect(lifeHeartsFor(unhurt)).toBe(lifeHeartsFor(unhurt)); // still memoized within one version
    expect(lifeHeartsFor(unhurt)).toHaveLength(0);

    selected.add(1);
    version++;
    expect(lifeHeartsFor(unhurt)).toHaveLength(1); // same snapshot instance - the version is the key
  });
});

/**
 * The scale half of the same contract: a decoded map's entity count is dominated by scenery, so the
 * per-tick projections must share ONE walk of it (`actorsOf`) instead of each re-walking the map. Pinned
 * by counting entities handed out, because a projection that quietly walks `entities` again still returns
 * the right answer. The heart projection also reaches for render's scene index, a second walk with a memo
 * of its own; the last case below bounds that one.
 */
describe('per-tick projections - one walk of the map between them', () => {
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

    const { doorBadgesFor, settlerBubblesFor, lifeHeartsFor } = createSnapshotProjections(
      PLAYER,
      new Map(),
      workerRoleOf,
      createFogGates(),
      { isLivestockTribe: () => false },
    );
    doorBadgesFor(snapshot); // a tally pass, a projection pass, and the household grouping
    settlerBubblesFor(snapshot);
    lifeHeartsFor(snapshot);
    forEachMinimapDot(snapshot, null, terrainWorldBounds(8, 8), 0.5, undefined, () => undefined);

    // One shared pass builds the actor index; each projection then reads only that.
    expect(visits()).toBe(entities.length);
  });

  it("builds render's scene index once for a heart-wearer mid store-exchange, however many ask", () => {
    // The one case the shared pass does not answer: a wounded carrier inside a completed store is not
    // drawn, so it gets no heart - and only render's scene index knows that. Under the running renderer
    // that index already exists; a headless caller pays for it, but once per snapshot, not per projection.
    const store = owned(building(10, HOME_TYPE, 1, 1), 1, 1);
    const PEOPLE_TRIBE = 1;
    const hurt: Ent = {
      id: 11,
      components: {
        ...owned(settler(11, 0, 10), 2, 2).components,
        Settler: { jobType: 0, tribe: PEOPLE_TRIBE },
        Health: { hitpoints: 50, max: 100 },
        CurrentAtomic: { effect: { kind: 'pileup', store: store.id } },
      },
    };
    const entities: Ent[] = [store, hurt];
    for (let i = 0; i < SCENERY; i++) entities.push(tree(100 + i));
    const { snapshot, visits } = visitCountingSnapshot(snapshotOf(entities));
    const heartInputs = { isLivestockTribe: () => false };

    const first = createSnapshotProjections(PLAYER, new Map(), workerRoleOf, createFogGates(), heartInputs);
    expect(first.lifeHeartsFor(snapshot)).toHaveLength(0); // hidden indoors
    expect(visits()).toBe(entities.length * 2); // the actor index, plus the scene index once

    const second = createSnapshotProjections(PLAYER, new Map(), workerRoleOf, createFogGates(), heartInputs);
    second.lifeHeartsFor(snapshot);
    expect(visits()).toBe(entities.length * 2); // unchanged - both indexes key on the snapshot, not on us
  });
});
