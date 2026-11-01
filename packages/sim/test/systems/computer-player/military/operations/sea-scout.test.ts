import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  COMPUTER_MODULE_IDS,
  type ComputerModuleEnables,
  FOG_MODE,
  Owner,
  TrainingOrder,
  Vehicle,
  vehiclePassengers,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import { halfCellMapFromCells, Simulation, type TerrainMap } from '../../../../../src/index.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../../../../src/systems/ai-shared/cadence.js';
import { computerProfileOf } from '../../../../../src/systems/computer-player/difficulty.js';
import { type OperationView, seatOperationsOf } from '../../../../../src/systems/computer-player/index.js';
import { believedBuildings } from '../../../../../src/systems/computer-player/knowledge/intel/index.js';
import {
  octantOf,
  SEA_SCOUT_SECTORS,
  SEA_SCOUT_TRIP_TIMEOUT_TICKS,
  scoutLoop,
} from '../../../../../src/systems/computer-player/military/operations/sea-scout.js';
import {
  landingFewestShips,
  landingFleetShips,
} from '../../../../../src/systems/computer-player/workforce/craft.js';
import { spawnSettler } from '../../../../../src/systems/spawn/index.js';
import { createVehicle } from '../../../../../src/systems/vehicles/index.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { grassNodeMap } from '../../../../fixtures/terrain.js';

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const BARRACKS_TYPE = 12;
const SPEARMAN = 32;
const SHIP = 3;
const SHIP_SEATS = 3;

/** Cells: the west island, the strait, the east island. */
const MAP_CELLS = { width: 70, height: 60 };
const STRAIT_FROM = 22;
const STRAIT_TO = 42;
const SEAT_HQ = { x: 16, y: 20 };
const BARRACKS = { x: 22, y: 50 };
/** Near enough the east shore that a ship off it sees the headquarters, out of sight from home. */
const FOE_HQ = { x: 100, y: 40 };
const SHIP_AT = { x: 46, y: 60 };
/** Where the ships beyond the first lie moored, a ship every {@link SHIP_SPACING} rows down the strait. */
const MORE_SHIPS_AT = { x: 46, y: 0 };
const SHIP_SPACING = 10;
/** Decisions enough for a scout to open with a free ship. */
const DECISIONS_TO_OPEN = 4;
const ARMY = 6;
const ARMY_RANK = 6;

function scoutContent(): ContentSet {
  return parseContentSet({
    ...aiContent(),
    vehicles: [
      {
        typeId: SHIP,
        id: 'ship_small',
        jobId: 52,
        stockSlots: 0,
        passengerSlots: SHIP_SEATS,
        logicSize: 2,
        passengerJobs: [SPEARMAN],
        commanderJob: 24,
        passengerVector: { direction: 2, distance: 4 },
        hitpoints: 5000,
      },
    ],
  });
}

function islands(): TerrainMap {
  const GRASS = 0;
  const WATER = 1;
  const { width, height } = MAP_CELLS;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let row = 0; row < height; row++)
    for (let col = STRAIT_FROM; col < STRAIT_TO; col++) typeIds[row * width + col] = WATER;
  return halfCellMapFromCells({ width, height, typeIds });
}

function militaryOnly(): Partial<ComputerModuleEnables> {
  const modules: Partial<ComputerModuleEnables> = {};
  for (const id of COMPUTER_MODULE_IDS) modules[id] = id === 'military';
  return modules;
}

/** The seat on the west island under fog with one ship moored and a few spearmen, the foe's headquarters
 *  on the east island. */
function scoutWorld(): { sim: Simulation; ship: Entity; army: Entity[] } {
  const sim = new Simulation({ seed: 7, content: scoutContent(), map: islands() });
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, modules: militaryOnly() });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: FOE, tribes: [VIKING] });
  const place = (buildingType: number, at: { x: number; y: number }, owner: number) =>
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType,
      ...at,
      tribe: VIKING,
      owner,
      force: true,
      underConstruction: false,
    });
  place(HQ_TYPE, SEAT_HQ, SEAT);
  place(BARRACKS_TYPE, BARRACKS, SEAT);
  place(HQ_TYPE, FOE_HQ, FOE);
  sim.step();
  const ship = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: SHIP,
    ...SHIP_AT,
    tribe: VIKING,
    owner: SEAT,
  });
  const army: Entity[] = [];
  for (let i = 0; i < ARMY; i++) {
    const at = { x: BARRACKS.x - 6 + 2 * (i % ARMY_RANK), y: BARRACKS.y + 8 + 2 * Math.floor(i / ARMY_RANK) };
    const man = spawnSettler(sim.world, ctxOf(sim), {
      kind: 'spawnSettler',
      jobType: SPEARMAN,
      ...at,
      tribe: VIKING,
      owner: SEAT,
    });
    if (man !== null) army.push(man);
  }
  if (ship === null) throw new Error('setup: the ship was not created');
  return { sim, ship, army };
}

function scouts(sim: Simulation): OperationView[] {
  return seatOperationsOf(sim.world, SEAT).filter((op) => op.kind === 'seaScout');
}

function seesFoeHeadquarters(sim: Simulation): boolean {
  return believedBuildings(sim.world, ctxOf(sim), SEAT, FOE).seen.length > 0;
}

describe('sea scouting', () => {
  it('sails one soldier round the rival island until the seat sees him, then brings him home', () => {
    const { sim, ship } = scoutWorld();
    const home = { ...sim.world.get(ship, Vehicle).mooring };
    expect(seesFoeHeadquarters(sim)).toBe(false);
    let seen: OperationView | undefined;
    let sighted = false;
    let mostAboard = 0;
    const end = sim.tick + 2 * SEA_SCOUT_TRIP_TIMEOUT_TICKS;
    while (sim.tick < end) {
      sim.step();
      seen = scouts(sim)[0] ?? seen;
      sighted ||= seesFoeHeadquarters(sim);
      mostAboard = Math.max(mostAboard, vehiclePassengers(sim.world.get(ship, Vehicle)).length);
      if (seen?.state === 'done') break;
    }
    expect(seen?.members).toHaveLength(1);
    expect(seen?.reason).toBe('arrivedHome');
    expect(sighted).toBe(true);
    expect(mostAboard).toBe(1);
    const state = sim.world.get(ship, Vehicle);
    expect(state.moored).toBe(true);
    expect(state.mooring).toEqual(home);
    expect(sim.world.get(ship, Owner).player).toBe(SEAT);
  });

  it('never takes a man off an errand to scout', () => {
    const { sim, army } = scoutWorld();
    const [drilled, next] = army;
    if (drilled === undefined || next === undefined) throw new Error('setup: no army');
    // The weakest man by id drills at the barracks, so the scout falls to the next one.
    const barracks = sim.world
      .canonicalQuery(Building)
      .find((e) => sim.world.get(e, Building).buildingType === BARRACKS_TYPE);
    if (barracks === undefined) throw new Error('setup: no barracks');
    const order = {
      house: barracks,
      drillTicksLeft: SEA_SCOUT_TRIP_TIMEOUT_TICKS,
      enrolled: 0,
      seated: false,
    };
    for (
      let t = 0;
      t < DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS && scouts(sim).length === 0;
      t++
    ) {
      if (!sim.world.has(drilled, TrainingOrder)) sim.world.add(drilled, TrainingOrder, order);
      sim.step();
    }
    expect(scouts(sim)[0]?.members).toEqual([next]);
  });

  it('keeps home the ship that completes the landing fleet, and sails once one more lies free', () => {
    const { sim } = scoutWorld();
    const fewest = landingFewestShips(landingFleetShips(sim.world, SEAT, computerProfileOf(sim.world, SEAT)));
    const moor = (i: number) =>
      createVehicle(sim.world, ctxOf(sim), {
        vehicleType: SHIP,
        x: MORE_SHIPS_AT.x,
        y: MORE_SHIPS_AT.y + SHIP_SPACING * i,
        tribe: VIKING,
        owner: SEAT,
      });
    for (let i = 1; i < fewest; i++) moor(i);
    const decide = () => {
      for (let t = 0; t < DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS; t++) sim.step();
    };
    decide();
    expect(scouts(sim)).toEqual([]);
    moor(fewest);
    decide();
    expect(scouts(sim)).toHaveLength(1);
  });

  it('numbers the octants clockwise from north', () => {
    const offsets = [
      [1, -9],
      [9, -1],
      [9, 1],
      [1, 9],
      [-1, 9],
      [-9, 1],
      [-9, -1],
      [-1, -9],
    ] as const;
    expect(offsets.map(([dx, dy]) => octantOf(dx, dy))).toEqual([...Array(SEA_SCOUT_SECTORS).keys()]);
  });

  it('loops round the coast from the side facing home, the outermost point per octant', () => {
    const terrain = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(64, 64) }).terrain;
    if (terrain === undefined) throw new Error('setup: no terrain');
    const ring = [
      { hx: 32, hy: 10 },
      { hx: 32, hy: 14 },
      { hx: 54, hy: 32 },
      { hx: 32, hy: 54 },
      { hx: 10, hy: 32 },
    ];
    // Home lies east: the loop starts in the east octant and runs clockwise; the inner north point loses.
    expect(scoutLoop(terrain, ring, { hx: 60, hy: 31 })).toEqual([
      { hx: 54, hy: 32 },
      { hx: 32, hy: 54 },
      { hx: 10, hy: 32 },
      { hx: 32, hy: 10 },
    ]);
  });
});
