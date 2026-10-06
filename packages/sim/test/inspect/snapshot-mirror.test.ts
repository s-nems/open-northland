import { describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import { TOUCHED_LOG_OVERFLOW_LIMIT } from '../../src/ecs/touched-log.js';
import {
  type Command,
  type Entity,
  type EntityDelta,
  type EntitySnapshot,
  type EntitySnapshotDelta,
  entityById,
  entityDeltas,
  fx,
  packSnapshotDelta,
  Simulation,
  type SnapshotDelta,
  SnapshotMirror,
  type WorldSnapshot,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { expectSameWorld, keepSettlersWalking } from '../fixtures/snapshot-parity.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * A `SnapshotMirror` fed by `Simulation.snapshotDeltas()` must read exactly what `Simulation.snapshot()`
 * reads, keeping an untouched entity's object and an unwritten component's clone across deltas, so the
 * runtime can move from the live snapshot to the mirror (and later to a mirror behind a worker) without
 * any consumer noticing. The parity run drives a real
 * settlement; the small worlds pin the list edits and the refusals one by one.
 */

const HEADQUARTERS = 1;
const WOODCUTTER = 1;
const VIKING = 1;
const { Position, Resource } = components;

function settlementSim(): Simulation {
  return new Simulation({ seed: 7, content: testContent(), map: grassNodeMap(8, 2) });
}

/** The setup that makes a run touch, create and destroy entities: a building, spawned settlers,
 *  scenery that gets harvested and grows back. */
const SETUP = new Map<number, Command[]>([
  [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
  [3, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
  [4, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 1, tribe: VIKING }]],
]);

/** The settlement map's last node column, the walkers' far end. */
const EAST_HX = 7;
const PLANT_TICK = 200;
const FELL_TICK = 250;

function bareResource(sim: Simulation, remaining: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: 0, y: 0 });
  sim.world.add(e, Resource, { goodType: 1, remaining, harvestAtomic: 24 });
  return e;
}

function ids(snapshot: WorldSnapshot): number[] {
  return snapshot.entities.map((e) => e.id);
}

function nonNull<T>(value: T | null): T {
  if (value === null) throw new Error('expected a value');
  return value;
}

/** The mirror's identity contract for a touched entity: the entry's values replace the written
 *  components, the previous object's clones stay for the rest, and the removed ones are gone. */
function expectPatched(entity: EntitySnapshot, before: EntitySnapshot | undefined, entry: EntityDelta): void {
  for (const [name, value] of Object.entries(entry.components))
    expect(entity.components[name]).toStrictEqual(value);
  for (const name of entry.removed) expect(name in entity.components).toBe(false);
  if (before === undefined) return;
  for (const [name, value] of Object.entries(before.components)) {
    if (name in entry.components || entry.removed.includes(name)) continue;
    expect(entity.components[name]).toBe(value);
  }
}

describe('snapshot mirror parity over a settlement run', () => {
  it('equals the live snapshot after every tick and keeps untouched entity and component identities', () => {
    const sim = settlementSim();
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    let previous: WorldSnapshot | null = null;
    let touchedTicks = 0;
    let removedTicks = 0;
    let planted: Entity | null = null;
    for (let tick = 1; tick <= 400; tick++) {
      for (const cmd of SETUP.get(tick) ?? []) sim.enqueueSetup(cmd);
      keepSettlersWalking(sim, EAST_HX);
      sim.step();
      // Nothing dies in this short run on bare grass, so mint a bare entity and destroy it by hand
      // between two steps; no system reads it, and a snapshot lists it like any other.
      if (tick === PLANT_TICK) planted = sim.world.create();
      if (tick === FELL_TICK) sim.world.destroy(nonNull(planted));
      const delta = nonNull(deltas.next());
      expect(delta.tick).toBe(sim.tick);
      expect(delta.rebuild).toBe(tick === 1);
      mirror.apply(delta);
      const mirrored = mirror.snapshot();
      const live = sim.snapshot();
      expect(mirror.tick).toBe(sim.tick);
      expectSameWorld(mirrored, live);
      expect(mirrored).not.toBe(previous);
      if (previous !== null) {
        const touched = new Map(entityDeltas(delta).map((entry) => [entry.id, entry]));
        for (const entity of mirrored.entities) {
          const before = entityById(previous, entity.id);
          const entry = touched.get(entity.id);
          if (entry === undefined) {
            expect(entity).toBe(before);
          } else {
            expect(entity).not.toBe(before);
            expectPatched(entity, before, entry);
          }
        }
        for (const id of delta.removed) expect(entityById(mirrored, id)).toBeUndefined();
      }
      if (delta.touched.length > 0) touchedTicks++;
      if (delta.removed.length > 0) removedTicks++;
      // The mirror edits its list in place, so a snapshot kept past the tick copies it.
      previous = { ...mirrored, entities: mirrored.entities.slice() };
    }
    // The run must have exercised every edit, or the parity proves nothing.
    expect(touchedTicks).toBeGreaterThan(100);
    expect(removedTicks).toBeGreaterThan(0);
  });

  it('carries a walking settler as its moved components, not the whole entity', () => {
    const sim = settlementSim();
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    let partial = 0;
    for (let tick = 1; tick <= 120; tick++) {
      for (const cmd of SETUP.get(tick) ?? []) sim.enqueueSetup(cmd);
      keepSettlersWalking(sim, EAST_HX);
      sim.step();
      const delta = nonNull(deltas.next());
      mirror.apply(delta);
      for (const entry of entityDeltas(delta)) {
        const held = entityById(mirror.snapshot(), entry.id);
        if (held === undefined) throw new Error(`touched entity ${entry.id} left the mirror`);
        const carried = Object.keys(entry.components).length;
        expect(carried).toBeLessThanOrEqual(Object.keys(held.components).length);
        if (carried < Object.keys(held.components).length) partial++;
      }
    }
    expect(partial).toBeGreaterThan(50);
  });

  it('a live snapshot taken between two deltas loses the stream nothing', () => {
    const sim = settlementSim();
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    for (let tick = 1; tick <= 60; tick++) {
      for (const cmd of SETUP.get(tick) ?? []) sim.enqueueSetup(cmd);
      keepSettlersWalking(sim, EAST_HX);
      sim.step();
      if (tick % 2 === 0) sim.snapshot(); // drains the touched log ahead of the stream's own take
      mirror.apply(nonNull(deltas.next()));
    }
    expectSameWorld(mirror.snapshot(), sim.snapshot());
  });

  it('a delta taken every few ticks spans them and still lands on the live snapshot', () => {
    const sim = settlementSim();
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    for (let tick = 1; tick <= 90; tick++) {
      for (const cmd of SETUP.get(tick) ?? []) sim.enqueueSetup(cmd);
      keepSettlersWalking(sim, EAST_HX);
      sim.step();
      if (tick % 7 === 0) {
        const delta = nonNull(deltas.next());
        expect(delta.sequence).toBe(tick / 7 - 1);
        mirror.apply(delta);
        expectSameWorld(mirror.snapshot(), sim.snapshot());
      }
    }
  });

  it('two streams over one world each see every change', () => {
    const sim = settlementSim();
    const a = sim.snapshotDeltas();
    const b = sim.snapshotDeltas();
    const mirrorA = new SnapshotMirror();
    const mirrorB = new SnapshotMirror();
    for (let tick = 1; tick <= 30; tick++) {
      for (const cmd of SETUP.get(tick) ?? []) sim.enqueueSetup(cmd);
      keepSettlersWalking(sim, EAST_HX);
      sim.step();
      mirrorA.apply(nonNull(a.next()));
      if (tick % 3 === 0) mirrorB.apply(nonNull(b.next()));
    }
    const live = sim.snapshot();
    expectSameWorld(mirrorA.snapshot(), live);
    expectSameWorld(mirrorB.snapshot(), live);
  });
});

describe('snapshot delta stream', () => {
  it('opens with a rebuild and answers null while the tick and world hold', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    bareResource(sim, 5);
    const deltas = sim.snapshotDeltas();
    const first = nonNull(deltas.next());
    expect(first.rebuild).toBe(true);
    expect([...first.touched]).toEqual([1]);
    expect(first.removed).toEqual([]);
    expect(deltas.next()).toBeNull();
    sim.step();
    const stepped = nonNull(deltas.next());
    expect(stepped).toMatchObject({ tick: 1, sequence: 1, rebuild: false, removed: [] });
    expect(stepped.touched).toHaveLength(0);
    expect(deltas.next()).toBeNull();
  });

  it('carries records of numbers, booleans, strings and null as scalars, and repeats a layout in a later delta', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { Fleeing, PathFollow, SettlerNeeds } = components;
    const walker = bareResource(sim, 5);
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    mirror.apply(nonNull(deltas.next()));
    const follow = {
      index: 2,
      legElapsed: 0,
      legCost: 7,
      legStartedAt: undefined,
      departureCharged: true as const,
    };
    const needs = {
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(1),
      piety: fx.fromInt(2),
      enjoyment: fx.fromInt(3),
      asOf: 9,
      drain: 'body' as const,
    };
    sim.world.add(walker, PathFollow, follow);
    sim.world.add(walker, SettlerNeeds, needs);
    sim.world.add(walker, Fleeing, { repathAt: 1, calmUntil: null });
    const first = nonNull(deltas.next());
    expect(first.values).toEqual([]);
    expect(first.recordFields).toEqual(expect.arrayContaining(['nnnb', 'nnnnns', 'nz']));
    mirror.apply(first);
    sim.world.mut(walker, PathFollow).index = 3;
    const second = nonNull(deltas.next());
    expect(second.values).toEqual([]);
    expect(second.recordKeys).toEqual([['index', 'legElapsed', 'legCost', 'departureCharged']]);
    mirror.apply(second);
    const held = entityById(mirror.snapshot(), walker)?.components;
    expect(held?.PathFollow).toStrictEqual({ index: 3, legElapsed: 0, legCost: 7, departureCharged: true });
    expect(held?.SettlerNeeds).toStrictEqual({ ...needs });
    expect(held?.Fleeing).toStrictEqual({ repathAt: 1, calmUntil: null });
    expect(held).toStrictEqual(entityById(sim.snapshot(), walker)?.components);
  });

  it('tells apart scalar records whose keys join to the same text', () => {
    const delta = packSnapshotDelta({
      tick: 0,
      sequence: 0,
      rebuild: true,
      touched: [
        { id: 1, components: { Odd: { 'a,b': 1, c: 2 } }, removed: [] },
        { id: 2, components: { Odd: { a: 3, 'b,c': 4 } }, removed: [] },
      ],
      removed: [],
      events: [],
    });
    expect(entityDeltas(delta).map((e) => e.components.Odd)).toStrictEqual([
      { 'a,b': 1, c: 2 },
      { a: 3, 'b,c': 4 },
    ]);
  });

  it('carries a same-tick mutation as a touched entity, and a destroyed one as removed', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const node = bareResource(sim, 5);
    const other = bareResource(sim, 3);
    const deltas = sim.snapshotDeltas();
    deltas.next();
    sim.world.mut(node, Resource).remaining = 4;
    sim.world.destroy(other);
    const delta = nonNull(deltas.next());
    expect(entityDeltas(delta)).toEqual([
      { id: node, components: { Resource: { goodType: 1, remaining: 4, harvestAtomic: 24 } }, removed: [] },
    ]);
    expect(delta.removed).toEqual([other]);
  });

  it('lists touched ids ascending in an Int32Array, which a structured clone copies as bytes', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const nodes = [bareResource(sim, 5), bareResource(sim, 3), bareResource(sim, 2)];
    const deltas = sim.snapshotDeltas();
    deltas.next();
    for (const node of nodes.reverse()) sim.world.mut(node, Resource).remaining = 1;
    const { touched, changeOf, valueKinds } = nonNull(deltas.next());
    expect(touched).toBeInstanceOf(Int32Array);
    expect(changeOf).toBeInstanceOf(Int32Array);
    expect(valueKinds).toBeInstanceOf(Int32Array);
    expect([...touched]).toEqual([...nodes].reverse());
  });

  it('numbers two deltas of one tick apart, so a mirror given only the second refuses it', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const node = bareResource(sim, 5);
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    mirror.apply(nonNull(deltas.next()));
    sim.world.mut(node, Resource).remaining = 4;
    const first = nonNull(deltas.next());
    sim.world.mut(node, Resource).remaining = 3;
    const second = nonNull(deltas.next());
    expect(second.tick).toBe(first.tick);
    expect(() => mirror.apply(second)).toThrow(/a delta was skipped/);
    mirror.apply(first);
    mirror.apply(second);
    expect(entityById(mirror.snapshot(), node)?.components.Resource).toMatchObject({ remaining: 3 });
  });

  it('carries a removed component by name and a re-added one as written', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const node = bareResource(sim, 5);
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    mirror.apply(nonNull(deltas.next()));
    const position = entityById(mirror.snapshot(), node)?.components.Position;
    sim.world.remove(node, Resource);
    const dropped = nonNull(deltas.next());
    expect(entityDeltas(dropped)).toEqual([{ id: node, components: {}, removed: ['Resource'] }]);
    mirror.apply(dropped);
    const bare = entityById(mirror.snapshot(), node);
    expect(bare?.components).toEqual({ Position: { x: 0, y: 0 } });
    expect(bare?.components.Position).toBe(position);
    sim.world.add(node, Resource, { goodType: 2, remaining: 1, harvestAtomic: 24 });
    const readded = nonNull(deltas.next());
    expect(entityDeltas(readded)).toEqual([
      { id: node, components: { Resource: { goodType: 2, remaining: 1, harvestAtomic: 24 } }, removed: [] },
    ]);
    mirror.apply(readded);
    expectSameWorld(mirror.snapshot(), sim.snapshot());
  });

  it('a component removed and re-added inside one stretch is carried as written, not as removed', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const node = bareResource(sim, 5);
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    mirror.apply(nonNull(deltas.next()));
    sim.world.remove(node, Resource);
    sim.snapshot(); // the cache re-clones the node without the component in between
    sim.world.add(node, Resource, { goodType: 3, remaining: 9, harvestAtomic: 24 });
    const delta = nonNull(deltas.next());
    expect(entityDeltas(delta)).toEqual([
      { id: node, components: { Resource: { goodType: 3, remaining: 9, harvestAtomic: 24 } }, removed: [] },
    ]);
    mirror.apply(delta);
    expectSameWorld(mirror.snapshot(), sim.snapshot());
  });

  it('a delta taken after the entity was carried once diffs against that take, not the live cache', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const node = bareResource(sim, 5);
    const deltas = sim.snapshotDeltas();
    deltas.next();
    sim.world.mut(node, Resource).remaining = 4;
    sim.snapshot(); // refreshes the cache's clone of the node before the stream looks
    sim.world.mut(node, Position).x = fx.fromInt(1);
    sim.snapshot();
    const delta = nonNull(deltas.next());
    expect(Object.keys(entityDeltas(delta)[0]?.components ?? {}).sort()).toEqual(['Position', 'Resource']);
  });

  it('an entity created and destroyed inside one stretch is only a removal, which the mirror skips', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    bareResource(sim, 5);
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    mirror.apply(nonNull(deltas.next()));
    const shortLived = bareResource(sim, 1);
    sim.world.destroy(shortLived);
    const delta = nonNull(deltas.next());
    expect(delta.touched).toHaveLength(0);
    expect(delta.removed).toEqual([shortLived]);
    mirror.apply(delta);
    expect(ids(mirror.snapshot())).toEqual([1]);
  });

  it('rebuilds after the touched log overflowed, and the mirror follows', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const kept = bareResource(sim, 5);
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    mirror.apply(nonNull(deltas.next()));
    sim.world.destroy(kept);
    const survivors: Entity[] = [];
    for (let i = 0; i <= TOUCHED_LOG_OVERFLOW_LIMIT; i++) survivors.push(sim.world.create());
    const delta = nonNull(deltas.next());
    expect(delta.rebuild).toBe(true);
    expect(delta.removed).toEqual([]);
    mirror.apply(delta);
    expect(ids(mirror.snapshot())).toEqual(survivors);
    expectSameWorld(mirror.snapshot(), sim.snapshot());
  });

  it('a closed stream refuses to answer rather than hand out a delta missing changes', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    bareResource(sim, 5);
    const deltas = sim.snapshotDeltas();
    deltas.next();
    deltas.close();
    bareResource(sim, 2);
    sim.step();
    expect(() => deltas.next()).toThrow(/closed/);
  });
});

describe('snapshot mirror list edits', () => {
  function delta(partial: Partial<EntitySnapshotDelta>): SnapshotDelta {
    return packSnapshotDelta({
      tick: 1,
      sequence: 1,
      rebuild: false,
      touched: [],
      removed: [],
      events: [],
      ...partial,
    });
  }
  function entity(id: number, mark = 0): EntityDelta {
    return { id, components: { mark }, removed: [] };
  }
  function seeded(ids: readonly number[]): SnapshotMirror {
    const mirror = new SnapshotMirror();
    mirror.apply(delta({ tick: 0, sequence: 0, rebuild: true, touched: ids.map((id) => entity(id)) }));
    return mirror;
  }

  it('inserts new entities at their canonical places, before, between and after the held ones', () => {
    const mirror = seeded([10, 20, 30]);
    mirror.apply(delta({ touched: [entity(5), entity(15), entity(25), entity(35), entity(40)] }));
    expect(ids(mirror.snapshot())).toEqual([5, 10, 15, 20, 25, 30, 35, 40]);
  });

  it('patches a held entity in place: a new object, the untouched clones kept, the written ones replaced', () => {
    const mirror = seeded([10, 20, 30]);
    const before = mirror.snapshot();
    const held = entityById(before, 20);
    const mark = held?.components.mark;
    const size = { w: 1 };
    mirror.apply(delta({ touched: [{ id: 20, components: { size }, removed: [] }] }));
    const after = mirror.snapshot();
    expect(ids(after)).toEqual([10, 20, 30]);
    const patched = entityById(after, 20);
    expect(patched).not.toBe(held);
    expect(patched?.components).toEqual({ mark: 0, size: { w: 1 } });
    expect(patched?.components.mark).toBe(mark);
    expect(patched?.components.size).toStrictEqual(size);
    expect(held?.components).toEqual({ mark: 0 }); // the previous snapshot's object is left alone
    expect(entityById(after, 10)).toBe(entityById(before, 10));
    expect(after).not.toBe(before);
    mirror.apply(delta({ tick: 2, sequence: 2, touched: [{ id: 20, components: {}, removed: ['mark'] }] }));
    expect(entityById(mirror.snapshot(), 20)?.components).toEqual({ size: { w: 1 } });
  });

  it('keeps a wide record plain through creation, growth, a write and a removal', () => {
    // Past sixteen fields the mirror adds a name as a defined property: it must read, enumerate, copy
    // and serialize like an assigned one, in the same order.
    const WIDE = 24;
    const names = Array.from({ length: WIDE }, (_, i) => `c${i}`);
    const wide = Object.fromEntries(names.map((name, i) => [name, { v: i }]));
    const mirror = new SnapshotMirror();
    mirror.apply(
      delta({ tick: 0, sequence: 0, rebuild: true, touched: [{ id: 7, components: wide, removed: [] }] }),
    );
    expect(Object.keys(entityById(mirror.snapshot(), 7)?.components ?? {})).toEqual(names);
    mirror.apply(
      delta({ touched: [{ id: 7, components: { c3: { v: -3 }, extra: { v: 99 } }, removed: [] }] }),
    );
    mirror.apply(delta({ tick: 2, sequence: 2, touched: [{ id: 7, components: {}, removed: ['c0'] }] }));
    const grown = nonNull(entityById(mirror.snapshot(), 7) ?? null).components;
    const expected = Object.fromEntries(
      Object.entries({ ...wide, c3: { v: -3 }, extra: { v: 99 } }).filter(([name]) => name !== 'c0'),
    );
    expect(Object.keys(grown)).toEqual(Object.keys(expected));
    expect(grown).toStrictEqual(expected);
    expect(Object.getOwnPropertyDescriptor(grown, 'extra')).toMatchObject({
      writable: true,
      enumerable: true,
    });
    expect(structuredClone(grown)).toStrictEqual(expected);
  });

  it('answers entityById from its id map through creation, patching, removal and rebuild', () => {
    const mirror = seeded([10, 20, 30]);
    mirror.apply(delta({ touched: [entity(20, 1), entity(25)], removed: [10] }));
    const after = mirror.snapshot();
    expect(entityById(after, 10)).toBeUndefined();
    expect(entityById(after, 20)?.components).toEqual({ mark: 1 });
    expect(entityById(after, 25)).toBe(after.entities[1]);
    expect(mirror.verifyIndexes()).toEqual([]);
    mirror.apply(delta({ tick: 2, sequence: 2, rebuild: true, touched: [entity(40)] }));
    expect(entityById(mirror.snapshot(), 20)).toBeUndefined();
    expect(entityById(mirror.snapshot(), 40)?.id).toBe(40);
    expect(mirror.verifyIndexes()).toEqual([]);
  });

  it('drops removed entities from the head, the middle and the tail in one pass, and keeps them as departed', () => {
    const mirror = seeded([10, 20, 30, 40, 50]);
    const before = mirror.snapshot().entities.slice();
    mirror.apply(delta({ removed: [10, 30, 50] }));
    expect(ids(mirror.snapshot())).toEqual([20, 40]);
    expect(mirror.departed).toEqual([before[0], before[2], before[4]]);
    expect(mirror.departed[0]).toBe(before[0]);
    mirror.apply(delta({ tick: 2, sequence: 2 }));
    expect(mirror.departed).toEqual([]);
  });

  it.each([{ removed: [] }, { removed: ['removed'] }])(
    'patches components with removals $removed without changing a held record',
    ({ removed }) => {
      const mirror = new SnapshotMirror();
      const kept = { value: 1 };
      const oldValue = { value: 2 };
      mirror.apply(
        delta({
          tick: 0,
          sequence: 0,
          rebuild: true,
          touched: [{ id: 10, components: { kept, written: oldValue, removed: 3 }, removed: [] }],
        }),
      );
      const held = entityById(mirror.snapshot(), 10);
      const nextValue = { value: 4 };
      mirror.apply(
        delta({
          touched: [{ id: 10, components: { written: nextValue, appended: undefined }, removed }],
        }),
      );
      const current = entityById(mirror.snapshot(), 10);
      expect(current?.components).not.toBe(held?.components);
      expect(Object.keys(current?.components ?? {})).toEqual(
        removed.length === 0 ? ['kept', 'written', 'removed', 'appended'] : ['kept', 'written', 'appended'],
      );
      expect(current?.components.kept).toBe(held?.components.kept);
      expect(current?.components.written).toStrictEqual(nextValue);
      expect(Object.hasOwn(current?.components ?? {}, 'appended')).toBe(true);
      expect(held?.components).toEqual({ kept, written: oldValue, removed: 3 });
    },
  );

  it('applies removals and insertions of one delta together', () => {
    const mirror = seeded([10, 20, 30]);
    mirror.apply(delta({ touched: [entity(25), entity(30, 1)], removed: [10] }));
    expect(ids(mirror.snapshot())).toEqual([20, 25, 30]);
    expect(entityById(mirror.snapshot(), 30)?.components).toEqual({ mark: 1 });
    expect(entityById(mirror.snapshot(), 25)?.components).toEqual({ mark: 0 });
  });

  it('refuses a delta out of sequence, a delta before the rebuild, and a read before any', () => {
    const empty = new SnapshotMirror();
    expect(() => empty.snapshot()).toThrow(/no delta applied/);
    expect(() => empty.apply(delta({}))).toThrow(/first delta must rebuild/);
    const mirror = seeded([10]);
    mirror.apply(delta({ tick: 1, sequence: 1 }));
    expect(() => mirror.apply(delta({ tick: 3, sequence: 3 }))).toThrow(
      /refuses delta 3: a delta was skipped/,
    );
    expect(() => mirror.apply(delta({ tick: 1, sequence: 1 }))).toThrow(/refuses delta 1/);
    expect(mirror.tick).toBe(1);
  });

  it('accepts a rebuild at any place in the sequence and counts on from it', () => {
    const mirror = seeded([10]);
    mirror.apply(delta({ tick: 5, sequence: 7, rebuild: true, touched: [entity(20)] }));
    mirror.apply(delta({ tick: 6, sequence: 8 }));
    expect(ids(mirror.snapshot())).toEqual([20]);
  });

  it('exposes the delta events on the snapshot and hands out the same object until the next delta', () => {
    const mirror = seeded([10]);
    const events = [{ kind: 'buildingFinished', entity: 10 as Entity }] as const;
    mirror.apply(delta({ events }));
    expect(mirror.snapshot().events).toBe(events);
    expect(mirror.snapshot()).toBe(mirror.snapshot());
  });

  it('a component write on a mirrored entity reaches the mirror with the sim clone', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mover = bareResource(sim, 5);
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    mirror.apply(nonNull(deltas.next()));
    sim.world.mut(mover, Position).x = fx.fromInt(3);
    mirror.apply(nonNull(deltas.next()));
    expect(entityById(mirror.snapshot(), mover)?.components.Position).toEqual({ x: fx.fromInt(3), y: 0 });
  });
});
