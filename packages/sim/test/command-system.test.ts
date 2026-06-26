import { beforeEach, describe, expect, it } from 'vitest';
import type { Command } from '../src/commands.js';
import {
  Building,
  Carrying,
  CurrentAtomic,
  Health,
  JobAssignment,
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
const SAWMILL = 2; // a workplace (one carpenter slot, a plank recipe) — its operator gets bound
const SMITHY = 4; // tech-gated: viking `jobEnablesHouse 2 4` locks it behind a carpenter (job 2)
const WOODCUTTER = 1;
const CARPENTER = 2; // the job that unlocks the SMITHY for the viking tribe
const WOOD = 1;
const VIKING = 1;
const FRANK = 2; // a tribe absent from the fixture's tribe table — its tech-graph gates nothing

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
  JobAssignment.store.clear();
  Health.store.clear();
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

  it('spawnSettler with no hitpoints mints a non-combatant (no Health pool — golden path)', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 2, tribe: VIKING });
    sim.step();
    // The default (omitted hitpoints) path leaves the settler Health-less, so it never fights and the
    // golden hash stays untouched — the separate-optional-component pattern.
    expect(sim.world.has(nthEntity(sim, 0), Health)).toBe(false);
  });

  it('spawnSettler with hitpoints stamps a Health pool: the civ becomes a combatant from command data', () => {
    const sim = fresh();
    // A civilization soldier enters the world as a combatant THROUGH THE COMMAND SEAM (not a test reaching
    // into the world): a positive hitpoints pool stamps a full Health{hitpoints: max, max}, the settler
    // analogue of the animal `hitpoints_adult` stamp. The magnitude is caller-supplied (approximated —
    // humans' HP is below the readable `.ini`).
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 2, tribe: VIKING, hitpoints: 1000 });
    sim.step();
    const health = sim.world.get(nthEntity(sim, 0), Health);
    expect(health.hitpoints).toBe(1000);
    expect(health.max).toBe(1000); // a fresh combatant spawns at full health
  });

  it('spawnSettler with non-positive hitpoints stamps no Health (only a real pool makes a combatant)', () => {
    const sim = fresh();
    // 0 (or negative) is not a combatant — stamping a 0-HP pool would spawn an already-dead fighter the
    // cleanup reaper deletes the same tick. Treat it as the non-combatant default and stamp nothing.
    sim.enqueue({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING, hitpoints: 0 });
    sim.step();
    expect(sim.world.has(nthEntity(sim, 0), Health)).toBe(false);
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

  it('demolish unbinds the workplace operators: each returns to idle and re-employable', () => {
    const sim = fresh();
    // A sawmill (type 2, one carpenter slot) and a carpenter standing on its tile. The JobSystem (in
    // the step schedule) ADOPTS the pre-employed-but-unbound operator, binding it to the mill it staffs.
    sim.enqueue({ kind: 'placeBuilding', buildingType: SAWMILL, x: 5, y: 5, tribe: VIKING });
    sim.enqueue({ kind: 'spawnSettler', jobType: CARPENTER, x: 5, y: 5, tribe: VIKING });
    sim.step();
    const mill = nthEntity(sim, 0);
    const worker = nthEntity(sim, 1);
    expect(sim.world.get(worker, JobAssignment).workplace).toBe(mill); // bound to THIS mill

    // Demolish the mill: its operator must be released, not left latched to a dead entity.
    sim.enqueue({ kind: 'demolish', building: mill });
    sim.step();
    expect(sim.world.isAlive(mill)).toBe(false);
    expect(sim.world.has(worker, JobAssignment)).toBe(false); // binding cleared
    expect(sim.world.get(worker, Settler).jobType).toBeNull(); // back to idle for re-assignment
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

  it('gates a tech-locked building: skipped (still logged) until the enabling job exists', () => {
    const sim = fresh();
    // No carpenter yet — the SMITHY is locked behind `jobEnablesHouse 2 4`, so placement is skipped.
    sim.enqueue({ kind: 'placeBuilding', buildingType: SMITHY, x: 0, y: 0, tribe: VIKING });
    sim.step();
    expect(sim.world.entityCount).toBe(0); // gated out — nothing built
    expect(sim.commands.log).toHaveLength(1); // but still recorded for faithful replay

    // Spawn the enabling carpenter, then retry: now the smithy unlocks and is placed.
    sim.enqueue({ kind: 'spawnSettler', jobType: CARPENTER, x: 1, y: 0, tribe: VIKING });
    sim.step();
    sim.enqueue({ kind: 'placeBuilding', buildingType: SMITHY, x: 0, y: 0, tribe: VIKING });
    sim.step();

    const buildings = [...sim.world.query(Building)];
    expect(buildings).toHaveLength(1);
    expect(sim.world.get(buildings[0] as Entity, Building).buildingType).toBe(SMITHY);
  });

  it('does not gate the building for a different tribe whose carpenter is enabling', () => {
    const sim = fresh();
    // A carpenter exists, but in a DIFFERENT tribe — the smithy stays gated for the viking tribe.
    sim.enqueue({ kind: 'spawnSettler', jobType: CARPENTER, x: 1, y: 0, tribe: FRANK });
    sim.step();
    sim.enqueue({ kind: 'placeBuilding', buildingType: SMITHY, x: 0, y: 0, tribe: VIKING });
    sim.step();
    expect([...sim.world.query(Building)]).toHaveLength(0); // wrong tribe's carpenter doesn't unlock it
  });

  it('leaves ungated buildings (the headquarters) placeable with no enabling settler', () => {
    const sim = fresh();
    // The HQ carries no `jobEnablesHouse` edge, so it places without any settler present.
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 0, y: 0, tribe: VIKING });
    sim.step();
    expect([...sim.world.query(Building)]).toHaveLength(1);
  });

  it('gates nothing for a tribe absent from the tribe table (no tech-graph data)', () => {
    const sim = fresh();
    // The FRANK tribe has no TribeType in the fixture, so its tech-graph gates nothing — even the
    // otherwise-locked smithy places (a map with no tribe data still gets its start buildings).
    sim.enqueue({ kind: 'placeBuilding', buildingType: SMITHY, x: 0, y: 0, tribe: FRANK });
    sim.step();
    expect([...sim.world.query(Building)]).toHaveLength(1);
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
