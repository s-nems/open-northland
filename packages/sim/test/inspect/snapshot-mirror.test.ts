import { describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import { TOUCHED_LOG_OVERFLOW_LIMIT } from '../../src/ecs/touched-log.js';
import {
  type Command,
  type Entity,
  entityById,
  fx,
  Simulation,
  type SnapshotDelta,
  SnapshotMirror,
  type WorldSnapshot,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * A `SnapshotMirror` fed by `Simulation.snapshotDeltas()` must read exactly what `Simulation.snapshot()`
 * reads, with the clone cache's identities, so the runtime can move from the live snapshot to the mirror
 * (and later to a mirror behind a worker) without any consumer noticing. The parity run drives a real
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

const PLANT_TICK = 200;
const FELL_TICK = 250;

function canonicalJson(snapshot: WorldSnapshot): string {
  return JSON.stringify(snapshot);
}

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

describe('snapshot mirror parity over a settlement run', () => {
  it('equals the live snapshot after every tick and keeps untouched entity identities', () => {
    const sim = settlementSim();
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    let previous: WorldSnapshot | null = null;
    let touchedTicks = 0;
    let removedTicks = 0;
    let planted: Entity | null = null;
    for (let tick = 1; tick <= 400; tick++) {
      for (const cmd of SETUP.get(tick) ?? []) sim.enqueueSetup(cmd);
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
      expect(canonicalJson(mirrored)).toBe(canonicalJson(live));
      expect(mirrored).not.toBe(previous);
      if (previous !== null) {
        const touched = new Set(delta.touched.map((e) => e.id));
        for (const entity of mirrored.entities) {
          const before = entityById(previous, entity.id);
          if (touched.has(entity.id)) expect(entity).not.toBe(before);
          else expect(entity).toBe(before);
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

  it('shares the clone cache with the live snapshot on the same thread: one object per entity', () => {
    const sim = settlementSim();
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    for (let tick = 1; tick <= 40; tick++) {
      for (const cmd of SETUP.get(tick) ?? []) sim.enqueueSetup(cmd);
      sim.step();
      mirror.apply(nonNull(deltas.next()));
      const live = sim.snapshot();
      const mirrored = mirror.snapshot();
      expect(mirrored.entities.length).toBe(live.entities.length);
      for (const [i, entity] of mirrored.entities.entries()) expect(entity).toBe(live.entities[i]);
    }
  });

  it('a live snapshot taken between two deltas loses the stream nothing', () => {
    const sim = settlementSim();
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    for (let tick = 1; tick <= 60; tick++) {
      for (const cmd of SETUP.get(tick) ?? []) sim.enqueueSetup(cmd);
      sim.step();
      if (tick % 2 === 0) sim.snapshot(); // drains the touched log ahead of the stream's own take
      mirror.apply(nonNull(deltas.next()));
    }
    expect(canonicalJson(mirror.snapshot())).toBe(canonicalJson(sim.snapshot()));
  });

  it('a delta taken every few ticks spans them and still lands on the live snapshot', () => {
    const sim = settlementSim();
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    for (let tick = 1; tick <= 90; tick++) {
      for (const cmd of SETUP.get(tick) ?? []) sim.enqueueSetup(cmd);
      sim.step();
      if (tick % 7 === 0) {
        const delta = nonNull(deltas.next());
        expect(delta.baseTick).toBe(tick === 7 ? -1 : tick - 7);
        mirror.apply(delta);
        expect(canonicalJson(mirror.snapshot())).toBe(canonicalJson(sim.snapshot()));
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
      sim.step();
      mirrorA.apply(nonNull(a.next()));
      if (tick % 3 === 0) mirrorB.apply(nonNull(b.next()));
    }
    const live = canonicalJson(sim.snapshot());
    expect(canonicalJson(mirrorA.snapshot())).toBe(live);
    expect(canonicalJson(mirrorB.snapshot())).toBe(live);
  });
});

describe('snapshot delta stream', () => {
  it('opens with a rebuild and answers null while the tick and world hold', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    bareResource(sim, 5);
    const deltas = sim.snapshotDeltas();
    const first = nonNull(deltas.next());
    expect(first.rebuild).toBe(true);
    expect(first.touched.map((e) => e.id)).toEqual([1]);
    expect(first.removed).toEqual([]);
    expect(deltas.next()).toBeNull();
    sim.step();
    const stepped = nonNull(deltas.next());
    expect(stepped).toMatchObject({ tick: 1, baseTick: 0, rebuild: false, touched: [], removed: [] });
    expect(deltas.next()).toBeNull();
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
    expect(delta.touched.map((e) => e.id)).toEqual([node]);
    expect(delta.touched[0]?.components.Resource).toMatchObject({ remaining: 4 });
    expect(delta.removed).toEqual([other]);
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
    expect(delta.touched).toEqual([]);
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
    expect(canonicalJson(mirror.snapshot())).toBe(canonicalJson(sim.snapshot()));
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
  function delta(partial: Partial<SnapshotDelta>): SnapshotDelta {
    return { tick: 1, baseTick: 0, rebuild: false, touched: [], removed: [], events: [], ...partial };
  }
  function entity(id: number, mark = 0) {
    return { id, components: { mark } };
  }
  function seeded(ids: readonly number[]): SnapshotMirror {
    const mirror = new SnapshotMirror();
    mirror.apply(delta({ tick: 0, baseTick: -1, rebuild: true, touched: ids.map((id) => entity(id)) }));
    return mirror;
  }

  it('inserts new entities at their canonical places, before, between and after the held ones', () => {
    const mirror = seeded([10, 20, 30]);
    mirror.apply(delta({ touched: [entity(5), entity(15), entity(25), entity(35), entity(40)] }));
    expect(ids(mirror.snapshot())).toEqual([5, 10, 15, 20, 25, 30, 35, 40]);
  });

  it('replaces a held entity in place with the delta object', () => {
    const mirror = seeded([10, 20, 30]);
    const before = mirror.snapshot();
    const replacement = entity(20, 1);
    mirror.apply(delta({ touched: [replacement] }));
    const after = mirror.snapshot();
    expect(ids(after)).toEqual([10, 20, 30]);
    expect(entityById(after, 20)).toBe(replacement);
    expect(entityById(after, 10)).toBe(entityById(before, 10));
    expect(after).not.toBe(before);
    expect(mirror.version).toBe(2);
  });

  it('drops removed entities from the head, the middle and the tail in one pass, and keeps them as departed', () => {
    const mirror = seeded([10, 20, 30, 40, 50]);
    const before = mirror.snapshot().entities.slice();
    mirror.apply(delta({ removed: [10, 30, 50] }));
    expect(ids(mirror.snapshot())).toEqual([20, 40]);
    expect(mirror.departed).toEqual([before[0], before[2], before[4]]);
    expect(mirror.departed[0]).toBe(before[0]);
    mirror.apply(delta({ tick: 2, baseTick: 1 }));
    expect(mirror.departed).toEqual([]);
  });

  it('applies removals and insertions of one delta together', () => {
    const mirror = seeded([10, 20, 30]);
    mirror.apply(delta({ touched: [entity(25), entity(30, 1)], removed: [10] }));
    expect(ids(mirror.snapshot())).toEqual([20, 25, 30]);
    expect(entityById(mirror.snapshot(), 30)?.components).toEqual({ mark: 1 });
  });

  it('refuses a delta that does not follow its tick, a delta before the rebuild, and a read before any', () => {
    const empty = new SnapshotMirror();
    expect(() => empty.snapshot()).toThrow(/no delta applied/);
    expect(() => empty.apply(delta({}))).toThrow(/first delta must rebuild/);
    const mirror = seeded([10]);
    mirror.apply(delta({ tick: 1, baseTick: 0 }));
    expect(() => mirror.apply(delta({ tick: 3, baseTick: 2 }))).toThrow(/refuses a delta from tick 2/);
    expect(() => mirror.apply(delta({ tick: 0, baseTick: 1 }))).toThrow(/earlier tick 0/);
    expect(mirror.tick).toBe(1);
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
