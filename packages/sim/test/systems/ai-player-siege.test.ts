import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Owner, Rider, Settler, Vehicle, VehicleDrive } from '../../src/components/index.js';
import { CommandQueue } from '../../src/core/command-queue.js';
import type { Command, PlayerCommand } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { EventBuffer, playerCommand, Rng, Simulation } from '../../src/index.js';
import {
  crewedCatapults,
  militaryModule,
  PARK_RING_MAX_NODES,
  PARK_RING_MIN_NODES,
  PARK_SPACING_NODES,
  RALLY_HOLD_RADIUS_NODES,
  takeCensus,
  WAVE_MIN_SOLDIERS,
} from '../../src/systems/ai-player/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import { interactionCell } from '../../src/systems/settlers/targets/index.js';
import { boardRider, createVehicle } from '../../src/systems/vehicles/index.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

// The seat's catapults: a driver drafted for each, kept out of the field army, and the idle ones parked
// on the attack stance around the barracks.

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const BARRACKS_TYPE = 12;
const FIST = 31;
const SPEARMAN = 32;
const BOWMAN = 40;
const CATAPULT = 5;
/** The heal potion, one of the outfit goods a waiting soldier is sent for. */
const POTION = 60;
/** A seed whose opening wave draw is its floor, so a band of that floor charges at once. */
const EAGER_SEED = 7;
const BARRACKS = { x: 30, y: 30 };
const FOE_HQ = { x: 110, y: 70 };
const HQ = { x: 20, y: 30 };
/** A yard well outside the park band, inside a catapult's walk range of the barracks. */
const YARD = { x: 60, y: 44 };
/** Ticks enough for a catapult to drive from {@link YARD} into its park. */
const PARK_DRIVE_TICKS = 800;

const CONTENT: ContentSet = siegeContent();

/** {@link aiContent} with the catapult row of `vehicletypes.ini`: one seat, soldiers as crew. */
function siegeContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      {
        typeId: POTION,
        id: 'potion_heal_big',
        weight: 1,
        equip: { category: 'misc', wears: true, uses: 5, restorePct: { healthMax: 50 } },
      },
    ],
    vehicles: [
      {
        typeId: CATAPULT,
        id: 'catapult',
        jobId: 54,
        stockSlots: 0,
        logicSize: 1,
        passengerJobs: [FIST, SPEARMAN, BOWMAN],
        commanderJob: FIST,
        hitpoints: 3000,
      },
    ],
  });
}

function ctxOf(sim: Simulation, tick = 0): SystemContext {
  return {
    content: CONTENT,
    rng: new Rng(EAGER_SEED),
    tick,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

function siegeSim(): Simulation {
  const sim = new Simulation({ seed: 1, content: CONTENT, map: grassNodeMap(128, 96) });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  place(sim, BARRACKS_TYPE, BARRACKS, SEAT);
  return sim;
}

function place(sim: Simulation, buildingType: number, at: { x: number; y: number }, owner: number): void {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
}

function spawnAt(
  sim: Simulation,
  spots: readonly { x: number; y: number }[],
  jobType: number,
  owner = SEAT,
): Entity[] {
  const before = new Set(sim.world.query(Settler));
  for (const { x, y } of spots) {
    sim.enqueueSetup({ kind: 'spawnSettler', jobType, x, y, tribe: VIKING, owner });
  }
  sim.step();
  return [...sim.world.query(Settler)].filter((e) => !before.has(e));
}

function spawnOne(sim: Simulation, at: { x: number; y: number }, jobType: number, owner = SEAT): Entity {
  const [e] = spawnAt(sim, [at], jobType, owner);
  if (e === undefined) throw new Error('setup: no settler spawned');
  return e;
}

function catapultAt(sim: Simulation, at: { x: number; y: number }): Entity {
  const e = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: CATAPULT,
    x: at.x,
    y: at.y,
    tribe: VIKING,
    owner: SEAT,
  });
  if (e === null) throw new Error('setup: the catapult is not in the content');
  return e;
}

/** Seat `driver` aboard `vehicle`, the way an authored scene crews one. */
function crew(sim: Simulation, driver: Entity, vehicle: Entity): void {
  sim.enqueue(playerCommand(SEAT, { kind: 'attachToVehicle', entity: driver, vehicle }));
  sim.step();
  boardRider(sim.world, driver, vehicle);
}

function rallyOf(sim: Simulation): { x: number; y: number } {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain');
  const barracks = [...sim.world.query(Building, Owner)].find(
    (e) => sim.world.get(e, Building).buildingType === BARRACKS_TYPE,
  );
  if (barracks === undefined) throw new Error('setup: no barracks');
  return terrain.coordsOf(interactionCell(sim.world, ctxOf(sim), terrain, barracks));
}

function run(sim: Simulation): PlayerCommand[] {
  return [...militaryModule.run(sim.world, ctxOf(sim, sim.tick), SEAT)].filter(
    (c) => c.kind !== 'setRegeneration',
  );
}

function attaches(commands: readonly Command[]): Extract<Command, { kind: 'attachToVehicle' }>[] {
  return commands.flatMap((c) => (c.kind === 'attachToVehicle' ? [c] : []));
}

function vehicleOrders(commands: readonly Command[]): Command[] {
  return commands.filter((c) => c.kind === 'moveVehicle' || c.kind === 'setVehicleStance');
}

function apply(sim: Simulation, commands: readonly PlayerCommand[]): void {
  for (const c of commands) sim.enqueue(playerCommand(SEAT, c));
  sim.step();
}

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

describe('military module - the catapult drivers', () => {
  it('drafts the bare soldier over an armed one standing nearer the catapult', () => {
    const sim = siegeSim();
    const catapult = catapultAt(sim, YARD);
    spawnOne(sim, { x: YARD.x + 2, y: YARD.y + 2 }, SPEARMAN);
    const bare = spawnOne(sim, { x: YARD.x + 12, y: YARD.y + 4 }, FIST);

    const commands = run(sim);
    expect(attaches(commands)).toEqual([{ kind: 'attachToVehicle', entity: bare, vehicle: catapult }]);
    // The attach applies next tick: the muster must not call him in over it.
    expect(commands.some((c) => 'entity' in c && c.entity === bare && c.kind !== 'attachToVehicle')).toBe(
      false,
    );
  });

  it('drafts the nearer of two equally kitted men', () => {
    const sim = siegeSim();
    const catapult = catapultAt(sim, YARD);
    spawnOne(sim, { x: YARD.x + 12, y: YARD.y + 4 }, FIST);
    const near = spawnOne(sim, { x: YARD.x + 4, y: YARD.y + 2 }, FIST);

    expect(attaches(run(sim))).toEqual([{ kind: 'attachToVehicle', entity: near, vehicle: catapult }]);
  });

  it('drafts a new driver once the old one dies', () => {
    const sim = siegeSim();
    const catapult = catapultAt(sim, YARD);
    const [first, second] = spawnAt(
      sim,
      [
        { x: YARD.x + 4, y: YARD.y + 2 },
        { x: YARD.x + 8, y: YARD.y + 2 },
      ],
      FIST,
    );
    if (first === undefined || second === undefined) throw new Error('setup: two soldiers');
    apply(sim, attaches(run(sim)));
    expect(crewedCatapults(sim.world, ctxOf(sim), SEAT)).toEqual([{ vehicle: catapult, driver: first }]);
    expect(attaches(run(sim))).toEqual([]);

    sim.enqueueSetup({ kind: 'debugKill', target: first });
    sim.step();
    expect(crewedCatapults(sim.world, ctxOf(sim), SEAT)).toEqual([]);
    expect(attaches(run(sim))).toEqual([{ kind: 'attachToVehicle', entity: second, vehicle: catapult }]);
  });

  it('keeps a driver out of the field army, so no march or recall ever names him', () => {
    const sim = siegeSim();
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    const rally = rallyOf(sim);
    const band = spawnAt(
      sim,
      Array.from({ length: WAVE_MIN_SOLDIERS + 1 }, (_, i) => ({
        x: rally.x + (i % RALLY_HOLD_RADIUS_NODES),
        y: rally.y + 2 * Math.floor(i / RALLY_HOLD_RADIUS_NODES),
      })),
      SPEARMAN,
    );
    const driver = band[0];
    if (driver === undefined) throw new Error('setup: no band');
    crew(sim, driver, catapultAt(sim, YARD));

    expect(takeCensus(sim.world, ctxOf(sim), SEAT).ready).not.toContain(driver);
    const commands = run(sim);
    expect(commands.some((c) => c.kind === 'attackMoveUnit')).toBe(true); // the band still marches
    expect(commands.some((c) => 'entity' in c && c.entity === driver)).toBe(false);
  });
});

describe('military module - the parked catapults', () => {
  function parkedSim(): { sim: Simulation; catapults: Entity[] } {
    const sim = siegeSim();
    const catapults = [catapultAt(sim, YARD), catapultAt(sim, { x: YARD.x + 4, y: YARD.y })];
    const drivers = spawnAt(
      sim,
      [
        { x: YARD.x, y: YARD.y + 6 },
        { x: YARD.x + 4, y: YARD.y + 6 },
      ],
      FIST,
    );
    catapults.forEach((vehicle, i) => {
      const driver = drivers[i];
      if (driver === undefined) throw new Error('setup: a driver per catapult');
      crew(sim, driver, vehicle);
    });
    return { sim, catapults };
  }

  it('drives each idle catapult to its own spot around the barracks, on the attack stance', () => {
    const { sim, catapults } = parkedSim();
    const rally = rallyOf(sim);
    const commands = run(sim);

    expect(commands.filter((c) => c.kind === 'setVehicleStance')).toEqual(
      catapults.map((vehicle) => ({ kind: 'setVehicleStance', vehicle, stance: 'attack' })),
    );
    const goals = commands.flatMap((c) => (c.kind === 'moveVehicle' ? [c] : []));
    expect(goals.map((c) => c.vehicle)).toEqual(catapults);
    for (const goal of goals) {
      expect(manhattan(goal, rally)).toBeGreaterThanOrEqual(PARK_RING_MIN_NODES);
      expect(manhattan(goal, rally)).toBeLessThanOrEqual(PARK_RING_MAX_NODES);
    }
    const [a, b] = goals;
    if (a === undefined || b === undefined) throw new Error('expected two parks');
    expect(manhattan(a, b)).toBeGreaterThanOrEqual(PARK_SPACING_NODES);
  });

  it('never orders a catapult again while it drives to its park or stands in it', () => {
    const { sim, catapults } = parkedSim();
    apply(sim, run(sim));
    expect(catapults.every((e) => sim.world.has(e, VehicleDrive))).toBe(true);
    expect(vehicleOrders(run(sim))).toEqual([]);

    for (let t = 0; t < PARK_DRIVE_TICKS; t++) sim.step();
    expect(catapults.some((e) => sim.world.has(e, VehicleDrive))).toBe(false);
    expect(catapults.map((e) => sim.world.get(e, Vehicle).stance)).toEqual(['attack', 'attack']);
    expect(vehicleOrders(run(sim))).toEqual([]);
  });
});

describe('military module - the parked driver outfit', () => {
  /** A seat whose headquarters holds one potion, with one catapult and its driver aboard at `at`. */
  function outfitSim(at: (rally: { x: number; y: number }) => { x: number; y: number }): {
    sim: Simulation;
    driver: Entity;
    vehicle: Entity;
  } {
    const sim = siegeSim();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      x: HQ.x,
      y: HQ.y,
      tribe: VIKING,
      owner: SEAT,
      initialGoods: [{ good: POTION, amount: 1 }],
    });
    sim.step();
    const spot = at(rallyOf(sim));
    const vehicle = catapultAt(sim, spot);
    const driver = spawnOne(sim, { x: spot.x, y: spot.y + 4 }, FIST);
    crew(sim, driver, vehicle);
    sim.enqueue(playerCommand(SEAT, { kind: 'setVehicleStance', vehicle, stance: 'attack' }));
    sim.step();
    return { sim, driver, vehicle };
  }

  const inPark = (rally: { x: number; y: number }) => ({ x: rally.x + 4, y: rally.y + 8 });

  it('sends the driver of a parked catapult down for an outfit a store holds', () => {
    const { sim, driver } = outfitSim(inPark);
    const commands = run(sim);
    expect(vehicleOrders(commands)).toEqual([]); // parked already
    const errand = commands.filter((c) => c.kind === 'equipGood');
    expect(errand).toEqual([{ kind: 'equipGood', entity: driver, group: 'misc', slot: 0, goodType: POTION }]);

    apply(sim, errand);
    expect(sim.world.has(driver, Rider)).toBe(false);
  });

  it('keeps the driver aboard while his catapult is still on its way home', () => {
    const { sim } = outfitSim(() => YARD);
    expect(run(sim).some((c) => c.kind === 'equipGood')).toBe(false);
  });

  it('keeps aboard the driver of a catapult the launching wave takes', () => {
    const { sim, driver, vehicle } = outfitSim(inPark);
    place(sim, HQ_TYPE, FOE_HQ, FOE);
    const rally = rallyOf(sim);
    spawnAt(
      sim,
      Array.from({ length: WAVE_MIN_SOLDIERS + 1 }, (_, i) => ({
        x: rally.x + (i % RALLY_HOLD_RADIUS_NODES),
        y: rally.y + 2 * Math.floor(i / RALLY_HOLD_RADIUS_NODES),
      })),
      SPEARMAN,
    );
    const commands = run(sim);
    expect(commands.some((c) => c.kind === 'moveVehicle' && c.vehicle === vehicle && c.attackMove)).toBe(
      true,
    );
    expect(commands.some((c) => c.kind === 'equipGood' && c.entity === driver)).toBe(false);
  });

  it('keeps the parked driver aboard while a raid stands at the gates', () => {
    const { sim } = outfitSim(inPark);
    spawnOne(sim, { x: BARRACKS.x + 6, y: BARRACKS.y + 6 }, SPEARMAN, FOE);
    expect(run(sim).some((c) => c.kind === 'equipGood')).toBe(false);
  });
});
