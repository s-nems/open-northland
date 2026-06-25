import { beforeEach, describe, expect, it } from 'vitest';
import type { Command } from '../src/commands.js';
import {
  Building,
  Carrying,
  CurrentAtomic,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Production,
  Resource,
  Settler,
  Stockpile,
} from '../src/components/index.js';
import type { Entity } from '../src/ecs/world.js';
import { Simulation } from '../src/index.js';
import { testContent } from './fixtures/content.js';

/**
 * Tests for CommandSystem + the serializable command queue + the snapshot read-view (the
 * only-way-state-mutates seam). A command enqueued via `sim.enqueue` is applied on the next
 * `step()`'s CommandSystem pass, appended to the command log, and surfaced through events; the
 * snapshot is a plain, canonical, non-aliasing read-view render consumes instead of live stores.
 *
 * Fixture (fixtures/content.ts): building type 1 = HEADQUARTERS (storage, stock wood init 10 / plank
 * init 0), job 1 = woodcutter. Stores are module-level singletons shared across sims, so each test
 * clears them first (see other sim tests).
 */

const HEADQUARTERS = 1;
const WOODCUTTER = 1;
const WOOD = 1;
const VIKING = 1;

function clearStores(): void {
  Position.store.clear();
  Settler.store.clear();
  Resource.store.clear();
  Building.store.clear();
  Stockpile.store.clear();
  Carrying.store.clear();
  CurrentAtomic.store.clear();
  MoveGoal.store.clear();
  PathFollow.store.clear();
  PathRequest.store.clear();
  Production.store.clear();
}

beforeEach(clearStores);

function fresh(seed = 1): Simulation {
  return new Simulation({ seed, content: testContent() });
}

/** The nth canonical (ascending-id) entity, asserting it exists — keeps tests free of `!`. */
function nthEntity(sim: Simulation, n: number): Entity {
  const ids = sim.world.canonicalEntities();
  const e = ids[n];
  if (e === undefined) throw new Error(`no entity at index ${n} (have ${ids.length})`);
  return e;
}

describe('CommandSystem', () => {
  it('placeBuilding creates a built building with a seeded stockpile and emits buildingPlaced', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 3, y: 4, tribe: VIKING });
    expect(sim.commands.pendingCount).toBe(1);

    sim.step();

    expect(sim.commands.pendingCount).toBe(0);
    expect(sim.world.canonicalEntities()).toHaveLength(1);
    const e = nthEntity(sim, 0);
    const b = sim.world.get(e, Building);
    expect(b.buildingType).toBe(HEADQUARTERS);
    expect(b.tribe).toBe(VIKING);
    // The HQ stock slots: wood init 10 (seeded), plank init 0 (omitted — only positive initials seed).
    const stock = sim.world.get(e, Stockpile).amounts;
    expect(stock.get(WOOD)).toBe(10);
    expect(stock.has(2)).toBe(false);
    const pos = sim.world.get(e, Position);
    expect([pos.x, pos.y]).toEqual([3 * 65536, 4 * 65536]);
    const placed = sim.events.current().filter((ev) => ev.kind === 'buildingPlaced');
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ at: { x: 3, y: 4 } });
  });

  it('spawnSettler creates a settler with the given job and emits settlerBorn', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 2, tribe: VIKING });
    sim.step();

    const e = nthEntity(sim, 0);
    const s = sim.world.get(e, Settler);
    expect(s.jobType).toBe(WOODCUTTER);
    expect(s.tribe).toBe(VIKING);
    expect(sim.events.current().some((ev) => ev.kind === 'settlerBorn')).toBe(true);
  });

  it('skips a command with an unknown type id (recoverable bad input — no throw, still logged)', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'placeBuilding', buildingType: 999, x: 0, y: 0, tribe: VIKING });
    sim.enqueue({ kind: 'spawnSettler', jobType: 999, x: 0, y: 0, tribe: VIKING });
    expect(() => sim.step()).not.toThrow();

    expect(sim.world.entityCount).toBe(0); // nothing created from bad input
    expect(sim.commands.log).toHaveLength(2); // but both are still recorded for faithful replay
  });

  it('demolish destroys a placed building (ids are never recycled)', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 0, y: 0, tribe: VIKING });
    sim.step();
    const e = nthEntity(sim, 0);
    expect(sim.world.isAlive(e)).toBe(true);

    sim.enqueue({ kind: 'demolish', building: e });
    sim.step();
    expect(sim.world.isAlive(e)).toBe(false);
    expect(sim.world.entityCount).toBe(0);
  });

  it('records applied commands in the log stamped with the tick they were applied on', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
    sim.step(); // tick 1
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 1, y: 1, tribe: VIKING });
    sim.step(); // tick 2

    const log = sim.commands.log;
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ tick: 1, command: { kind: 'spawnSettler' } });
    expect(log[1]).toMatchObject({ tick: 2, command: { kind: 'placeBuilding' } });
  });

  it('applies commands in FIFO enqueue order within one tick', () => {
    const sim = fresh();
    // Two placements; the entity ids must reflect enqueue order (first enqueued = lower id).
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING });
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 6, y: 0, tribe: VIKING });
    sim.step();

    expect(sim.world.canonicalEntities()).toHaveLength(2);
    // First enqueued (the building) got the lower id.
    expect(sim.world.has(nthEntity(sim, 0), Building)).toBe(true);
    expect(sim.world.has(nthEntity(sim, 1), Settler)).toBe(true);
  });

  it('is deterministic: same seed + same commands on the same ticks => byte-identical state', () => {
    const cmds: Command[] = [
      { kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 2, y: 2, tribe: VIKING },
      { kind: 'spawnSettler', jobType: WOODCUTTER, x: 3, y: 3, tribe: VIKING },
    ];

    const runA = fresh(7);
    for (const c of cmds) runA.enqueue(c);
    runA.run(50);
    const hashA = runA.hashState();

    clearStores();
    const runB = fresh(7);
    for (const c of cmds) runB.enqueue(c);
    runB.run(50);
    const hashB = runB.hashState();

    expect(hashB).toBe(hashA);
  });
});

describe('snapshot read-view', () => {
  it('is a plain, canonical, non-aliasing copy of the world (Maps -> sorted [k,v] arrays)', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 1, y: 1, tribe: VIKING });
    sim.step();

    const snap = sim.snapshot();
    expect(snap.tick).toBe(1);
    expect(snap.entities).toHaveLength(1);
    const [ent] = snap.entities;
    if (ent === undefined) throw new Error('expected one snapshot entity');
    expect(ent.id).toBe(nthEntity(sim, 0) as number);

    // The Stockpile Map became a plain sorted [k,v] array — no live Map in the snapshot (transferable).
    const stock = ent.components.Stockpile as { amounts: Array<[number, number]> };
    expect(stock.amounts).toEqual([[WOOD, 10]]);
    expect(stock.amounts).not.toBeInstanceOf(Map);

    // Non-aliasing: mutating the snapshot must not reach the live store.
    stock.amounts.push([99, 1]);
    expect(sim.world.get(nthEntity(sim, 0), Stockpile).amounts.has(99)).toBe(false);

    // The snapshot carries the tick's events.
    expect(snap.events.some((ev) => ev.kind === 'buildingPlaced')).toBe(true);
  });

  it('snapshot entities are in canonical ascending-id order', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING });
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 1, y: 0, tribe: VIKING });
    sim.step();

    const snap = sim.snapshot();
    const ids = snap.entities.map((e) => e.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });
});
