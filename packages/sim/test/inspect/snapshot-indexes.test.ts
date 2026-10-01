import { describe, expect, it } from 'vitest';
import {
  type Command,
  countedBy,
  type EntityDelta,
  type EntitySnapshot,
  entitiesWith,
  groupedBy,
  indexesOf,
  isPositioned,
  ONE,
  packSnapshotDelta,
  positionedWithin,
  Simulation,
  type SnapshotDelta,
  type SnapshotIndexSpec,
  SnapshotMirror,
  TileBuckets,
  type WorldSnapshot,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { keepSettlersWalking } from '../fixtures/snapshot-parity.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The views `indexesOf` serves over a mirror must equal what a walk over the mirror's entity list would
 * find, after every delta, with the same entity objects, and their state must be the maintained object
 * rather than a rebuild; a snapshot taken off the sim serves the same views by one walk.
 */

const HEADQUARTERS = 1;
const WOODCUTTER = 1;
const VIKING = 1;
const PLAYER = 0;
const OTHER_PLAYER = 1;

const SETUP = new Map<number, Command[]>([
  [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
  [3, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
  [4, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 1, tribe: VIKING }]],
]);

const RUN_TICKS = 300;
const MAP_WIDTH = 8;
const MAP_HEIGHT = 2;
/** Frames the whole test map with a margin, in tile units. */
const WHOLE_MAP = { minX: -2, minY: -2, maxX: MAP_WIDTH + 2, maxY: MAP_HEIGHT + 2 };
/** The left half of the map, so a walking settler crosses its edge. */
const LEFT_HALF = { minX: 0, minY: 0, maxX: MAP_WIDTH / 2, maxY: MAP_HEIGHT };

function has(name: string): (entity: EntitySnapshot) => boolean {
  return (entity) => Object.hasOwn(entity.components, name);
}

function ownerOf(entity: EntitySnapshot): number | undefined {
  const player = (entity.components.Owner as { player?: unknown } | undefined)?.player;
  return typeof player === 'number' ? player : undefined;
}

function tileOf(entity: EntitySnapshot): { x: number; y: number } | null {
  const pos = entity.components.Position as { x?: unknown; y?: unknown } | undefined;
  if (pos === undefined || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
  return { x: pos.x / ONE, y: pos.y / ONE };
}

function nonNull<T>(value: T | null): T {
  if (value === null) throw new Error('expected a value');
  return value;
}

/** Element-wise identity, not deep equality: the view must hand out the snapshot's own objects. */
function expectSameObjects(actual: readonly EntitySnapshot[], expected: readonly EntitySnapshot[]): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) expect(actual[i]).toBe(expected[i]);
}

const SETTLERS_BY_OWNER = countedBy((entity) => (has('Settler')(entity) ? ownerOf(entity) : undefined));

const BY_OWNER = groupedBy(ownerOf);

function expectGroupsMatchWalk(
  groups: ReadonlyMap<number, readonly EntitySnapshot[]>,
  snapshot: WorldSnapshot,
  keyOf: (entity: EntitySnapshot) => number | undefined,
): void {
  const walked = new Map<number, EntitySnapshot[]>();
  for (const entity of snapshot.entities) {
    const key = keyOf(entity);
    if (key === undefined) continue;
    const group = walked.get(key);
    if (group === undefined) walked.set(key, [entity]);
    else group.push(entity);
  }
  expect([...groups.keys()].sort()).toEqual([...walked.keys()].sort());
  for (const [key, group] of walked) expectSameObjects(groups.get(key) ?? [], group);
}

function expectIndexesMatchWalk(snapshot: WorldSnapshot): void {
  for (const name of ['Settler', 'Building', 'Position', 'Owner']) {
    expectSameObjects(entitiesWith(snapshot, name), snapshot.entities.filter(has(name)));
  }
  expectGroupsMatchWalk(indexesOf(snapshot).get(BY_OWNER), snapshot, ownerOf);
  const settlerCounts = indexesOf(snapshot).get(SETTLERS_BY_OWNER);
  const walked = new Map<number, number>();
  for (const entity of snapshot.entities) {
    const owner = has('Settler')(entity) ? ownerOf(entity) : undefined;
    if (owner !== undefined) walked.set(owner, (walked.get(owner) ?? 0) + 1);
  }
  expect(settlerCounts).toEqual(walked);
  const positioned = snapshot.entities.filter((entity) => tileOf(entity) !== null);
  expectSameObjects(
    positionedWithin(snapshot, WHOLE_MAP).sort((a, b) => a.id - b.id),
    positioned,
  );
  for (const entity of snapshot.entities)
    expect(isPositioned(snapshot, entity.id)).toBe(tileOf(entity) !== null);
  // A box query is a superset of the entities inside it; the caller filters by position.
  const inLeftHalf = positioned.filter((entity) => {
    const tile = nonNull(tileOf(entity));
    return (
      tile.x >= LEFT_HALF.minX &&
      tile.x <= LEFT_HALF.maxX &&
      tile.y >= LEFT_HALF.minY &&
      tile.y <= LEFT_HALF.maxY
    );
  });
  const queried = new Set(positionedWithin(snapshot, LEFT_HALF));
  for (const entity of inLeftHalf) expect(queried.has(entity)).toBe(true);
}

function settlementSim(): Simulation {
  return new Simulation({ seed: 7, content: testContent(), map: grassNodeMap(MAP_WIDTH, MAP_HEIGHT) });
}

describe('snapshot indexes over a mirror', () => {
  it('equal a walk over the mirror after every delta and keep one maintained state', () => {
    const sim = settlementSim();
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    let settlers: readonly EntitySnapshot[] | null = null;
    let touchedTicks = 0;
    for (let tick = 1; tick <= RUN_TICKS; tick++) {
      for (const cmd of SETUP.get(tick) ?? []) sim.enqueueSetup(cmd);
      keepSettlersWalking(sim, MAP_WIDTH - 1);
      sim.step();
      const delta = nonNull(deltas.next());
      mirror.apply(delta);
      const mirrored = mirror.snapshot();
      expectIndexesMatchWalk(mirrored);
      const current = entitiesWith(mirrored, 'Settler');
      // The list object is the same one across deltas: maintained, not rebuilt per snapshot.
      if (settlers !== null) expect(current).toBe(settlers);
      settlers = current;
      if (delta.touched.length > 0) touchedTicks++;
    }
    expect(touchedTicks).toBeGreaterThan(100);
    expect(nonNull(settlers).length).toBe(2);
  });

  it('start over on a rebuilding delta', () => {
    const sim = settlementSim();
    for (let tick = 1; tick <= 10; tick++) {
      for (const cmd of SETUP.get(tick) ?? []) sim.enqueueSetup(cmd);
      sim.step();
    }
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    mirror.apply(nonNull(deltas.next()));
    const before = entitiesWith(mirror.snapshot(), 'Settler');
    expectIndexesMatchWalk(mirror.snapshot());
    // A second stream's first delta rebuilds the same mirror: the views are rebuilt from the new list.
    const reopened = sim.snapshotDeltas();
    sim.step();
    mirror.apply(nonNull(reopened.next()));
    const after = entitiesWith(mirror.snapshot(), 'Settler');
    expect(after).not.toBe(before);
    expectIndexesMatchWalk(mirror.snapshot());
  });

  it('serve a snapshot taken off the simulation by one walk over its list', () => {
    const sim = settlementSim();
    for (let tick = 1; tick <= 20; tick++) {
      for (const cmd of SETUP.get(tick) ?? []) sim.enqueueSetup(cmd);
      sim.step();
    }
    const live = sim.snapshot();
    expectIndexesMatchWalk(live);
    expect(entitiesWith(live, 'Settler')).toBe(entitiesWith(live, 'Settler'));
    expect(indexesOf(live)).toBe(indexesOf(sim.snapshot()));
  });

  it('follow removals, key changes, moves and dropped components through hand-built deltas', () => {
    const MARK_A = 2;
    const MARK_B = 3;
    const markOf = (entity: EntitySnapshot): number | undefined => {
      const kind = (entity.components.Mark as { kind?: unknown } | undefined)?.kind;
      return typeof kind === 'number' ? kind : undefined;
    };
    const byMark = groupedBy(markOf);
    const byMarkRead = groupedBy(markOf, 'marks', { values: ['Mark'] });
    const at = (x: number, y: number) => ({ x: x * ONE, y: y * ONE });
    const owner = (player: number) => ({ player });
    const entry = (id: number, components: Record<string, unknown>, removed: string[] = []): EntityDelta => ({
      id,
      components,
      removed,
    });
    let tick = 0;
    const next = (touched: EntityDelta[], removed: number[] = [], rebuild = false): SnapshotDelta => {
      tick++;
      return packSnapshotDelta({ tick, sequence: tick, rebuild, touched, removed, events: [] });
    };
    const mirror = new SnapshotMirror();
    const check = (): void => {
      const snapshot = mirror.snapshot();
      expectIndexesMatchWalk(snapshot);
      expectGroupsMatchWalk(indexesOf(snapshot).get(byMark), snapshot, markOf);
      expectGroupsMatchWalk(indexesOf(snapshot).get(byMarkRead), snapshot, markOf);
    };

    mirror.apply(
      next(
        [
          entry(1, { Settler: {}, Owner: owner(PLAYER), Position: at(1, 1) }),
          entry(2, { Building: {}, Owner: owner(PLAYER), Position: at(3, 0) }),
          entry(3, { Settler: {}, Owner: owner(OTHER_PLAYER), Position: at(1, 2), Mark: { kind: MARK_A } }),
          entry(5, { Mark: { kind: MARK_A } }),
        ],
        [],
        true,
      ),
    );
    check();
    // A removal, an owner change (group and count key) and a move into another bucket.
    mirror.apply(next([entry(1, { Owner: owner(OTHER_PLAYER) }), entry(3, { Position: at(9, 1) })], [2]));
    check();
    // Dropped components, a mark key change and a new entity.
    mirror.apply(
      next([
        entry(3, {}, ['Position', 'Settler']),
        entry(4, { Settler: {}, Owner: owner(PLAYER), Position: at(2, 2) }),
        entry(5, { Mark: { kind: MARK_B } }),
      ]),
    );
    check();
    // A write that leaves the position object alone swaps the bucketed entity in place.
    mirror.apply(next([entry(1, { Mark: { kind: MARK_B } }), entry(5, {}, ['Mark'])]));
    check();
    const moved = mirror.snapshot().entities.find((entity) => entity.id === 1);
    expect(positionedWithin(mirror.snapshot(), WHOLE_MAP)).toContain(moved);
    // A rebuild drops every maintained state; the next read walks the new list.
    mirror.apply(next([entry(4, { Settler: {}, Owner: owner(PLAYER), Position: at(2, 2) })], [], true));
    check();
  });
});

describe('a spec that declares its reads', () => {
  it('replaces an entity whose change wrote what it reads and swaps every other one', () => {
    interface Calls {
      readonly replaced: number[];
      readonly swapped: number[];
    }
    const spy: SnapshotIndexSpec<Calls> = {
      reads: { values: ['Mark'], presence: ['Settler'] },
      empty: () => ({ replaced: [], swapped: [] }),
      add: () => {},
      remove: () => {},
      replace: (calls, _previous, next) => calls.replaced.push(next.id),
      swap: (calls, _previous, next) => calls.swapped.push(next.id),
    };
    // The same spec swapping per delta: one run of every touched held entity, the replaced ones too.
    const runSpy: SnapshotIndexSpec<number[][]> = {
      reads: { values: ['Mark'], presence: ['Settler'] },
      empty: () => [],
      add: () => {},
      remove: () => {},
      swapAll: (runs, nexts) => runs.push(nexts.map((next) => next.id)),
    };
    const entry = (id: number, components: Record<string, unknown>, removed: string[] = []): EntityDelta => ({
      id,
      components,
      removed,
    });
    const mirror = new SnapshotMirror();
    mirror.apply(
      packSnapshotDelta({
        tick: 1,
        sequence: 0,
        rebuild: true,
        touched: [
          entry(1, { Settler: {}, SettlerNeeds: { hunger: 0 }, Position: { x: 0, y: 0 } }),
          entry(2, { Mark: { kind: 1 } }),
          entry(3, { Position: { x: 0, y: 0 } }),
        ],
        removed: [],
        events: [],
      }),
    );
    const calls = indexesOf(mirror.snapshot()).get(spy);
    const runs = indexesOf(mirror.snapshot()).get(runSpy);
    // A rewrite of a presence-read component and a write of an unread one swap; a value read replaces.
    mirror.apply(
      packSnapshotDelta({
        tick: 2,
        sequence: 1,
        rebuild: false,
        touched: [
          entry(1, { Settler: {}, SettlerNeeds: { hunger: 1 }, Position: { x: 1, y: 0 } }),
          entry(2, { Mark: { kind: 2 } }),
          entry(3, { Position: { x: 1, y: 0 } }),
        ],
        removed: [],
        events: [],
      }),
    );
    expect(calls).toEqual({ replaced: [2], swapped: [1, 3] });
    // Gaining or dropping a presence-read component replaces.
    mirror.apply(
      packSnapshotDelta({
        tick: 3,
        sequence: 2,
        rebuild: false,
        touched: [entry(1, {}, ['Settler']), entry(3, { Settler: {}, SettlerNeeds: { hunger: 0 } })],
        removed: [],
        events: [],
      }),
    );
    expect(calls).toEqual({ replaced: [2, 1, 3], swapped: [1, 3] });
    expect(runs).toEqual([
      [1, 2, 3],
      [1, 3],
    ]);
  });
});

describe('tile buckets', () => {
  it('serve a box query as a superset and move an item that changed bucket', () => {
    const buckets = new TileBuckets<string>();
    buckets.set(1, 'near', 1, 1);
    buckets.set(2, 'far', 100, 100);
    expect(buckets.within({ minX: 0, minY: 0, maxX: 4, maxY: 4 })).toEqual(['near']);
    expect(buckets.within({ minX: 90, minY: 90, maxX: 110, maxY: 110 })).toEqual(['far']);
    buckets.set(1, 'moved', 100, 101);
    expect(buckets.within({ minX: 0, minY: 0, maxX: 4, maxY: 4 })).toEqual([]);
    expect(buckets.within({ minX: 90, minY: 90, maxX: 110, maxY: 110 }).sort()).toEqual(['far', 'moved']);
    expect(buckets.get(1)).toBe('moved');
    expect(buckets.delete(2)).toBe(true);
    expect(buckets.delete(2)).toBe(false);
    expect(buckets.size).toBe(1);
    // A box far wider than the populated area walks the buckets instead of its own empty cells.
    expect(buckets.within({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 })).toEqual(['moved']);
  });
});
