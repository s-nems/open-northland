import { describe, expect, it } from 'vitest';
import {
  Age,
  addPerson,
  Building,
  Carrying,
  CurrentAtomic,
  Female,
  JobAssignment,
  MoveGoal,
  Owner,
  Position,
  Settler,
  Stockpile,
  UnderConstruction,
  WorkFlag,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { assignWorker, unassignWorker } from '../../src/systems/orders/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/** The `unassignWorker` command. The garrison arm lives with the rest of the tower post, in
 *  `conflict/tower-garrison.test.ts`. */

const VIKING = 1;
const HUMAN = 0;
const CARPENTER = 2; // the sawmill's worker job
const CARRIER = 36; // the HQ's transport slot
const WOODCUTTER = 1; // the HQ's gathering slot - a flag trade
const PLANK = 2;
const HEADQUARTERS = 1;
const SAWMILL = 2;

function buildingAt(
  sim: Simulation,
  buildingType: number,
  x: number,
  opts: { readonly site?: boolean; readonly stock?: Array<[number, number]> } = {},
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  sim.world.add(e, Building, {
    buildingType,
    tribe: VIKING,
    built: opts.site === true ? fx.fromInt(0) : ONE,
    level: 0,
  });
  sim.world.add(e, Stockpile, { amounts: new Map(opts.stock ?? []) });
  if (opts.site === true) sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

function settlerAt(sim: Simulation, x: number, jobType: number | null, owner: number | null = HUMAN): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  if (owner !== null) sim.world.add(e, Owner, { player: owner });
  return e;
}

const post = (sim: Simulation, settler: Entity, building: Entity, jobPriority: readonly number[]): void => {
  assignWorker(sim.world, ctxOf(sim), { kind: 'assignWorker', entity: settler, building, jobPriority });
};

const release = (sim: Simulation, settler: Entity): void => {
  unassignWorker(sim.world, ctxOf(sim), { kind: 'unassignWorker', entity: settler });
};

describe('unassignWorker - take an owned settler off its workplace', () => {
  it('drops the binding and keeps the trade', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = buildingAt(sim, SAWMILL, 5);
    const worker = settlerAt(sim, 0, null);
    post(sim, worker, mill, [CARPENTER]);

    release(sim, worker);

    expect(sim.world.has(worker, JobAssignment)).toBe(false);
    expect(sim.world.get(worker, Settler).jobType).toBe(CARPENTER);
  });

  it('frees the slot, so the next settler can take it', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = buildingAt(sim, SAWMILL, 5); // one carpenter slot
    const first = settlerAt(sim, 0, null);
    const second = settlerAt(sim, 1, null);
    post(sim, first, mill, [CARPENTER]);

    release(sim, first);
    post(sim, second, mill, [CARPENTER]);

    expect(sim.world.get(second, JobAssignment).workplace).toBe(mill);
  });

  it('releases a settler posted to a FOUNDATION, the one with the longest wait', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const site = buildingAt(sim, SAWMILL, 5, { site: true });
    const worker = settlerAt(sim, 0, null);
    post(sim, worker, site, [CARPENTER]);
    expect(sim.world.get(worker, JobAssignment).workplace).toBe(site); // posted before it stands

    release(sim, worker);

    expect(sim.world.has(worker, JobAssignment)).toBe(false);
    expect(sim.world.get(worker, Settler).jobType).toBe(CARPENTER);
  });

  it('skips an unposted settler, a neutral one, a child and a woman', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mill = buildingAt(sim, SAWMILL, 5);
    const unposted = settlerAt(sim, 0, CARPENTER);
    const neutral = settlerAt(sim, 1, CARPENTER, null);
    const child = settlerAt(sim, 2, CARPENTER);
    const woman = settlerAt(sim, 3, CARPENTER);
    sim.world.add(child, Age, { ticks: 0 });
    sim.world.add(woman, Female, { female: true });
    // The three gated settlers are stamped past the order, so only the gate can explain a surviving bind.
    for (const e of [neutral, child, woman]) sim.world.add(e, JobAssignment, { workplace: mill });

    for (const e of [unposted, neutral, child, woman]) release(sim, e);

    expect(sim.world.has(unposted, JobAssignment)).toBe(false); // nothing to drop
    for (const e of [neutral, child, woman]) {
      expect(sim.world.get(e, JobAssignment).workplace).toBe(mill); // refused, binding intact
    }
  });

  it('leaves a released gatherer a work flag, exactly as a razed workplace does', () => {
    // A post IS a gatherer's yard: `bindEmployment` takes its flag away when it is hired. Released
    // without one it would forage the whole map, so both release paths re-plant it at its feet.
    const released = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 4) });
    const razed = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 4) });
    for (const sim of [released, razed]) {
      const base = buildingAt(sim, HEADQUARTERS, 5);
      const cutter = settlerAt(sim, 2, null);
      sim.enqueueSetup({ kind: 'assignWorker', entity: cutter, building: base, jobPriority: [WOODCUTTER] });
      sim.step();
      expect(sim.world.has(cutter, WorkFlag)).toBe(false); // hired, so the yard is the workplace
      sim.enqueueSetup(
        sim === released ? { kind: 'unassignWorker', entity: cutter } : { kind: 'demolish', building: base },
      );
      sim.step();

      expect(sim.world.has(cutter, JobAssignment)).toBe(false);
      expect(sim.world.get(cutter, Settler).jobType).toBe(WOODCUTTER);
      expect(sim.world.has(cutter, WorkFlag)).toBe(true); // bounded again, not roaming
    }
  });

  it('lets a carrier released mid-haul bank the load in its hands', () => {
    // Unlike a profession change, the trade is unchanged, so the load is still this settler's to deliver.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const store = buildingAt(sim, HEADQUARTERS, 6);
    buildingAt(sim, SAWMILL, 3, { stock: [[PLANK, 3]] });
    const hauler = settlerAt(sim, 0, null);
    sim.enqueueSetup({ kind: 'assignWorker', entity: hauler, building: store, jobPriority: [CARRIER] });
    for (let i = 0; i < 400 && !sim.world.has(hauler, Carrying); i++) sim.step();
    expect(sim.world.get(hauler, Carrying).goodType).toBe(PLANK); // caught mid-run, hands full

    sim.enqueueSetup({ kind: 'unassignWorker', entity: hauler });
    for (let i = 0; i < 400; i++) sim.step();

    expect(sim.world.has(hauler, JobAssignment)).toBe(false);
    expect(sim.world.has(hauler, Carrying)).toBe(false); // banked, not dumped in the field
    expect(sim.world.get(store, Stockpile).amounts.get(PLANK) ?? 0).toBe(1);
  });

  it('stops a released carrier hauling, and leaves it standing there trade-ful', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const store = buildingAt(sim, HEADQUARTERS, 6); // room for the planks…
    const mill = buildingAt(sim, SAWMILL, 3, { stock: [[PLANK, 3]] }); // …and a mill full of them
    const hauler = settlerAt(sim, 0, null);
    sim.enqueueSetup({ kind: 'assignWorker', entity: hauler, building: store, jobPriority: [CARRIER] });
    const banked = (): number => sim.world.get(store, Stockpile).amounts.get(PLANK) ?? 0;
    const waiting = (): number => sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0;
    // One whole round trip, so the release lands on a carrier with empty hands rather than mid-delivery.
    for (let i = 0; i < 400 && (banked() === 0 || sim.world.has(hauler, Carrying)); i++) sim.step();
    expect(sim.world.get(hauler, Settler).jobType).toBe(CARRIER);
    expect(banked()).toBe(1);
    expect(waiting()).toBe(2); // two planks still at the mill, and a bound carrier would fetch them

    sim.enqueueSetup({ kind: 'unassignWorker', entity: hauler });
    for (let i = 0; i < 400; i++) sim.step(); // several cycles' worth

    expect(sim.world.has(hauler, JobAssignment)).toBe(false);
    expect(sim.world.get(hauler, Settler).jobType).toBe(CARRIER); // still a carrier…
    expect(banked()).toBe(1); // …that ferries nothing more
    expect(waiting()).toBe(2);
    expect(sim.world.has(hauler, Carrying)).toBe(false);
    expect(sim.world.has(hauler, MoveGoal)).toBe(false);
    expect(sim.world.has(hauler, CurrentAtomic)).toBe(false);
  });
});
