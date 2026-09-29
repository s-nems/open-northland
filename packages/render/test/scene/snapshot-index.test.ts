import {
  type EntityDelta,
  type EntitySnapshot,
  SnapshotMirror,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { ONE } from '../../src/data/projection/index.js';
import { signpostBoards } from '../../src/data/scene/signpost-boards.js';
import { enterableStoresOf, palisadesOf, targetPositionsOf } from '../../src/data/scene/snapshot-index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/** The combat attack atomic (id 81) - the same numeric contract `snapshot-index.ts` transcribes. */
const ATTACK_ATOMIC_ID = 81;

/** A workshop craft atomic (the baker's bread), which faces nothing: only its workplace is wanted. */
const MAKE_BREAD_ATOMIC_ID = 47;

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
        CurrentAtomic: { atomicId: ATTACK_ATOMIC_ID, targetEntity: 2 },
        AtomicClock: { elapsed: 1 },
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
        CurrentAtomic: { atomicId: ATTACK_ATOMIC_ID, targetEntity: 99 },
        AtomicClock: { elapsed: 1 },
      }),
    ]);
    expect(targetPositionsOf(snap).size).toBe(0);
  });

  it('memoizes by snapshot identity - a second frame over the same tick reuses the index', () => {
    const snap = snapshotOf([
      entity(1, 1, 1, {
        Settler: { tribe: 0 },
        CurrentAtomic: { atomicId: ATTACK_ATOMIC_ID, targetEntity: 2 },
        AtomicClock: { elapsed: 1 },
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
  const POST_4 = entity(4, 4, 1, SIGNPOST_4);
  const world = () =>
    snapshotOf([
      entity(1, 1, 1, {
        Settler: { tribe: 0 },
        CurrentAtomic: { atomicId: ATTACK_ATOMIC_ID, targetEntity: 2 },
        AtomicClock: { elapsed: 1 },
      }),
      entity(2, 2, 1, { Settler: { tribe: 1 } }),
      entity(3, 3, 1, { Building: { buildingType: 7, tribe: 0 } }),
      POST_4,
      entity(5, 5, 1, SIGNPOST_5),
    ]);

  it('builds each view of a plain snapshot with one walk, and none on the frames that follow', () => {
    const { snapshot, walks } = walkCounting(world());
    expect(enterableStoresOf(snapshot)).toEqual(new Set([3]));
    expect(targetPositionsOf(snapshot).get(2)).toEqual({ x: 2 * ONE, y: 1 * ONE });
    const VIEWS_READ = 2; // enterable stores, wanted targets
    expect(walks()).toBe(VIEWS_READ);
    enterableStoresOf(snapshot);
    targetPositionsOf(snapshot);
    expect(walks()).toBe(VIEWS_READ);
    // A drawn post's boards look its neighbours up by id instead of walking the map's posts.
    expect(signpostBoards(snapshot, POST_4.components)).toHaveLength(1);
    expect(walks()).toBe(VIEWS_READ);
  });
});

/** A mirror at its first tick holding `entities`. */
function mirrorOf(entities: readonly EntitySnapshot[]): SnapshotMirror {
  const mirror = new SnapshotMirror();
  const touched = entities.map((e) => ({ id: e.id, components: e.components, removed: [] }));
  mirror.apply({ tick: 1, sequence: 0, rebuild: true, touched, removed: [], events: [] });
  return mirror;
}

function advance(mirror: SnapshotMirror, touched: readonly EntityDelta[], removed: readonly number[] = []) {
  const lastTick = mirror.tick ?? 0;
  // One delta per tick from the tick-1 rebuild at sequence 0: the last tick is the next sequence.
  mirror.apply({ tick: lastTick + 1, sequence: lastTick, rebuild: false, touched, removed, events: [] });
  return mirror.snapshot();
}

describe('the views over a mirror', () => {
  const site = (built: number) => ({ Building: { buildingType: 7, tribe: 0, built } });

  it('follows a finished site, a new target and a dead store from the deltas alone', () => {
    const mirror = mirrorOf([
      entity(1, 1, 1, { Settler: { tribe: 0 } }),
      entity(2, 2, 1, { Settler: { tribe: 1 } }),
      entity(3, 3, 1, site(0)),
      entity(4, 4, 1, { Building: { buildingType: 7, tribe: 0 } }),
    ]);
    expect(enterableStoresOf(mirror.snapshot())).toEqual(new Set([4]));
    expect(targetPositionsOf(mirror.snapshot()).size).toBe(0);
    const swing = {
      CurrentAtomic: { atomicId: ATTACK_ATOMIC_ID, targetEntity: 2 },
      AtomicClock: { elapsed: 1 },
    };
    const next = advance(
      mirror,
      [
        { id: 1, components: swing, removed: [] },
        { id: 3, components: site(ONE), removed: [] },
      ],
      [4],
    );
    expect(enterableStoresOf(next)).toEqual(new Set([3]));
    expect(targetPositionsOf(next).get(2)).toEqual({ x: 2 * ONE, y: 1 * ONE });
    // The swing ends: nothing references 2 any more.
    const calm = advance(mirror, [{ id: 1, components: {}, removed: ['CurrentAtomic', 'AtomicClock'] }]);
    expect(targetPositionsOf(calm).size).toBe(0);
  });

  it('matches a fresh walk as targets move, crafts change workplace and stores upgrade', () => {
    const swingAt = (target: number) => ({ atomicId: ATTACK_ATOMIC_ID, targetEntity: target });
    const craftAt = (workplace: number) => ({
      atomicId: MAKE_BREAD_ATOMIC_ID,
      targetEntity: workplace,
      elapsed: 0,
      duration: 1,
      effect: { kind: 'produce' },
    });
    const store = { Building: { buildingType: 7, tribe: 0 } };
    const mirror = mirrorOf([
      entity(1, 1, 1, { Settler: { tribe: 0 }, CurrentAtomic: swingAt(2) }),
      entity(2, 2, 1, { Settler: { tribe: 1 } }),
      entity(3, 3, 1, store),
      entity(4, 4, 1, store),
      entity(5, 5, 1, { Settler: { tribe: 0 }, CurrentAtomic: craftAt(3) }),
    ]);
    const expectFreshWalk = (snapshot: WorldSnapshot): void => {
      const fresh = snapshotOf([...snapshot.entities]);
      expect(targetPositionsOf(snapshot)).toEqual(targetPositionsOf(fresh));
      expect(enterableStoresOf(snapshot)).toEqual(enterableStoresOf(fresh));
    };
    expectFreshWalk(mirror.snapshot());
    const steps: readonly EntityDelta[][] = [
      // Writes that leave `CurrentAtomic` and `Building` alone.
      [
        { id: 1, components: { Position: { x: ONE, y: 2 * ONE } }, removed: [] },
        { id: 3, components: { Stockpile: { amounts: [] } }, removed: [] },
      ],
      // The swing turns on another target, the craftsman moves to another workplace.
      [
        { id: 1, components: { CurrentAtomic: swingAt(4) }, removed: [] },
        { id: 5, components: { CurrentAtomic: craftAt(4) }, removed: [] },
      ],
      // A rewritten atomic on the same target, and a store starting an upgrade from the ground up.
      [
        { id: 1, components: { CurrentAtomic: swingAt(4) }, removed: [] },
        {
          id: 4,
          components: { Upgrading: {}, Building: { buildingType: 7, tribe: 0, built: 0 } },
          removed: [],
        },
      ],
      // Dropping the upgrade alone turns the unbuilt store into a site.
      [{ id: 4, components: {}, removed: ['Upgrading'] }],
      [{ id: 4, components: { Building: { buildingType: 7, tribe: 0 } }, removed: [] }],
    ];
    for (const touched of steps) expectFreshWalk(advance(mirror, touched));
    expect(targetPositionsOf(mirror.snapshot()).has(4)).toBe(true);
    expect(targetPositionsOf(mirror.snapshot()).has(2)).toBe(false);
  });

  it('keeps the palisade list while no change touches a palisade, and hands a new one after', () => {
    const WALL = { Palisade: { kind: 'wall' } };
    const mirror = mirrorOf([entity(1, 1, 1, WALL), entity(2, 2, 1, { Settler: { tribe: 0 } })]);
    const first = palisadesOf(mirror.snapshot());
    const walked = advance(mirror, [
      { id: 2, components: { Position: { x: 3 * ONE, y: ONE } }, removed: [] },
    ]);
    expect(palisadesOf(walked)).toBe(first);
    const built = advance(mirror, [
      { id: 5, components: { Position: { x: ONE, y: 2 * ONE }, ...WALL }, removed: [] },
    ]);
    const second = palisadesOf(built);
    expect(second).not.toBe(first);
    expect(second.map((e) => e.id)).toEqual([1, 5]);
    expect(first.map((e) => e.id)).toEqual([1]); // a list already handed out never changes
    expect(mirror.verifyIndexes()).toEqual([]);
  });
});
