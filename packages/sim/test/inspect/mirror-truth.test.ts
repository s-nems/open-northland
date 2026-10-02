import { describe, expect, it } from 'vitest';
import {
  type Command,
  type Entity,
  type EntityDelta,
  type EntitySnapshot,
  entitiesWith,
  entityDeltas,
  firstDifference,
  groupedBy,
  indexesOf,
  isPositioned,
  MirrorTruth,
  packSnapshotDelta,
  Simulation,
  type SnapshotDelta,
  SnapshotMirror,
  TileBuckets,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { keepSettlersWalking } from '../fixtures/snapshot-parity.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The `debug=diag` truth check: a stream opened with `digest` folds the world's clones of every entity a
 * delta names, and `MirrorTruth` folds the mirror's own objects for the same ids after applying it. The
 * two agree on every honest delta and part on the delta that loses a write, a value or a removal. The
 * index half compares each held index with a fresh walk.
 */

const HEADQUARTERS = 1;
const WOODCUTTER = 1;
const VIKING = 1;
const RUN_TICKS = 300;
/** The settlement map's last node column, the walkers' far end. */
const EAST_HX = 7;
const PLANT_TICK = 100;
const FELL_TICK = 150;

const SETUP = new Map<number, Command[]>([
  [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
  [3, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
  [4, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 1, tribe: VIKING }]],
]);

function settlementSim(): Simulation {
  return new Simulation({ seed: 7, content: testContent(), map: grassNodeMap(8, 2) });
}

function nonNull<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

interface Planted {
  id: Entity | null;
}

/** Steps the settlement, minting and destroying a bare entity by hand so a delta carries a removal. */
function stepSettlement(sim: Simulation, tick: number, planted: Planted): void {
  for (const cmd of SETUP.get(tick) ?? []) sim.enqueueSetup(cmd);
  keepSettlersWalking(sim, EAST_HX);
  sim.step();
  if (tick === PLANT_TICK) planted.id = sim.world.create();
  if (tick === FELL_TICK) sim.world.destroy(nonNull(planted.id));
}

/** The first entry that changes the value of a component the mirror already holds, and that
 *  component's name: dropping a write of the same value would leave nothing to notice. */
function rewrittenComponent(delta: SnapshotDelta, mirror: SnapshotMirror): [EntityDelta, string] | null {
  for (const entry of entityDeltas(delta)) {
    const held = mirror.snapshot().entities.find((entity) => entity.id === entry.id);
    const name = Object.keys(entry.components).find(
      (key) =>
        held !== undefined &&
        key in held.components &&
        JSON.stringify(held.components[key]) !== JSON.stringify(entry.components[key]),
    );
    if (name !== undefined) return [entry, name];
  }
  return null;
}

function withEntry(delta: SnapshotDelta, replaced: EntityDelta): SnapshotDelta {
  const touched = entityDeltas(delta).map((entry) => (entry.id === replaced.id ? replaced : entry));
  return packSnapshotDelta({ ...delta, touched });
}

describe('mirror truth digest', () => {
  it.each([1, 3])('agrees with the world after every delta taken every %i ticks', (ticksPerDelta) => {
    const sim = settlementSim();
    const deltas = sim.snapshotDeltas({ digest: true });
    const mirror = new SnapshotMirror();
    const truth = new MirrorTruth();
    const planted: Planted = { id: null };
    let removals = 0;
    for (let tick = 1; tick <= RUN_TICKS; tick++) {
      stepSettlement(sim, tick, planted);
      if (tick % ticksPerDelta !== 0) continue;
      const delta = nonNull(deltas.next());
      expect(delta.digest?.entities).toBe(sim.world.entityCount);
      mirror.apply(delta);
      expect(truth.check(delta, mirror.snapshot())).toBeNull();
      removals += delta.removed.length;
    }
    expect(removals).toBeGreaterThan(0);
  });

  it('carries no digest unless the stream asked for one', () => {
    const sim = settlementSim();
    sim.step();
    expect(nonNull(sim.snapshotDeltas().next()).digest).toBeUndefined();
  });

  /** Run the settlement until `tamper` changes a delta, and return the first mismatch the check
   *  reports with the tick of the tampered delta. */
  function tamperedRun(tamper: (delta: SnapshotDelta, mirror: SnapshotMirror) => SnapshotDelta | null) {
    const sim = settlementSim();
    const deltas = sim.snapshotDeltas({ digest: true });
    const mirror = new SnapshotMirror();
    const truth = new MirrorTruth();
    const planted: Planted = { id: null };
    for (let tick = 1; tick <= RUN_TICKS; tick++) {
      stepSettlement(sim, tick, planted);
      const taken = nonNull(deltas.next());
      const delta = (tick > 1 ? tamper(taken, mirror) : null) ?? taken;
      mirror.apply(delta);
      const mismatch = truth.check(delta, mirror.snapshot());
      if (delta !== taken) return { mismatch, tamperedTick: delta.tick };
      expect(mismatch).toBeNull();
    }
    throw new Error('the run never offered a delta to tamper with');
  }

  it('reports the delta that lost a component write', () => {
    const { mismatch, tamperedTick } = tamperedRun((delta, mirror) => {
      const rewritten = rewrittenComponent(delta, mirror);
      if (rewritten === null) return null;
      const [entry, name] = rewritten;
      const { [name]: _lost, ...kept } = entry.components;
      return withEntry(delta, { ...entry, components: kept });
    });
    expect(mismatch?.tick).toBe(tamperedTick);
    expect(mismatch?.actual.entities).toBe(mismatch?.expected.entities);
  });

  it('reports the delta whose value changed on the way', () => {
    const { mismatch, tamperedTick } = tamperedRun((delta, mirror) => {
      const rewritten = rewrittenComponent(delta, mirror);
      if (rewritten === null) return null;
      const [entry, name] = rewritten;
      return withEntry(delta, { ...entry, components: { ...entry.components, [name]: { garbled: true } } });
    });
    expect(mismatch?.tick).toBe(tamperedTick);
  });

  it('reports the delta that lost a removal', () => {
    const { mismatch, tamperedTick } = tamperedRun((delta) =>
      delta.removed.length === 0 ? null : { ...delta, removed: [] },
    );
    expect(mismatch?.tick).toBe(tamperedTick);
    expect(nonNull(mismatch).actual.entities).toBe(nonNull(mismatch).expected.entities + 1);
  });
});

describe('mirror index verification', () => {
  const settlerMark = groupedBy((entity: EntitySnapshot) =>
    'Settler' in entity.components ? entity.id % 2 : undefined,
  );

  function readIndexes(mirror: SnapshotMirror): void {
    const snapshot = mirror.snapshot();
    entitiesWith(snapshot, 'Settler');
    indexesOf(snapshot).get(settlerMark);
    isPositioned(snapshot, 1);
  }

  it('finds nothing to report over a settlement run', () => {
    const sim = settlementSim();
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    const planted: Planted = { id: null };
    for (let tick = 1; tick <= RUN_TICKS; tick++) {
      stepSettlement(sim, tick, planted);
      mirror.apply(nonNull(deltas.next()));
      readIndexes(mirror);
      expect(mirror.verifyIndexes()).toEqual([]);
    }
  });

  it('reports a held index entry the changes did not leave there', () => {
    const sim = settlementSim();
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    const planted: Planted = { id: null };
    for (let tick = 1; tick <= 10; tick++) {
      stepSettlement(sim, tick, planted);
      mirror.apply(nonNull(deltas.next()));
    }
    readIndexes(mirror);
    const settlers = entitiesWith(mirror.snapshot(), 'Settler') as EntitySnapshot[];
    expect(settlers.length).toBe(2);
    settlers.pop();
    const reported = mirror.verifyIndexes();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBe(
      'the withComponent(Settler) index differs from a fresh walk at the root (length 1 against 2)',
    );
  });
});

describe('firstDifference', () => {
  it('compares lists in order, maps and sets by key, records by own keys', () => {
    expect(firstDifference([1, { a: 2 }], [1, { a: 2 }])).toBeNull();
    expect(firstDifference([1, 2], [2, 1])).toBe('the root[0]');
    expect(firstDifference(new Map([[1, [3]]]), new Map([[1, [4]]]))).toBe('the root key 1[0]');
    expect(firstDifference(new Set([1, 2]), new Set([2, 1]))).toBeNull();
    expect(firstDifference({ a: 1 }, { b: 1 })).toBe('the root.a');
    expect(firstDifference(new Map(), {})).toBe('the root');
  });
});

describe('TileBuckets.differenceFrom', () => {
  const A = { name: 'a' };
  const B = { name: 'b' };

  it('ignores the order a history left inside a bucket and names a misplaced item', () => {
    const held = new TileBuckets<object>();
    held.set(1, A, 0, 0);
    held.set(2, B, 1, 1);
    const fresh = new TileBuckets<object>();
    fresh.set(2, B, 1, 1);
    fresh.set(1, A, 0, 0);
    expect(held.differenceFrom(fresh)).toBeNull();
    held.set(2, B, 40, 40);
    expect(held.differenceFrom(fresh)).toBe("id 2's bucket");
    held.move(1, B, 0, 0);
    expect(held.differenceFrom(fresh)).toBe('id 1');
    // A move never places an id the buckets do not hold.
    held.move(3, A, 0, 0);
    expect(held.has(3)).toBe(false);
  });
});
