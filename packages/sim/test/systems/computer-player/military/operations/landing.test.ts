import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  COMPUTER_MODULE_IDS,
  type ComputerModuleEnables,
  Owner,
  Position,
  Rider,
  Settler,
  Vehicle,
  vehiclePassengers,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import {
  halfCellMapFromCells,
  nodeOfPosition,
  Simulation,
  type TerrainMap,
} from '../../../../../src/index.js';
import type { TerrainGraph } from '../../../../../src/nav/terrain/index.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../../../../src/systems/ai-shared/cadence.js';
import { computerProfileOf } from '../../../../../src/systems/computer-player/difficulty.js';
import { type OperationView, seatOperationsOf } from '../../../../../src/systems/computer-player/index.js';
import {
  LANDING_FORM_TIMEOUT_TICKS,
  LANDING_SAIL_TIMEOUT_TICKS,
} from '../../../../../src/systems/computer-player/military/operations/landing.js';
import { landingFleetShips } from '../../../../../src/systems/computer-player/workforce/craft.js';
import { spawnSettler } from '../../../../../src/systems/spawn/index.js';
import { createVehicle } from '../../../../../src/systems/vehicles/index.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { ctxOf } from '../../../../fixtures/context.js';

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const BARRACKS_TYPE = 12;
const SPEARMAN = 32;
const SHIP = 3;
/** The ship's seats besides the commander's: each ship carries one more man than this. */
const SHIP_SEATS = 3;
const MEN_PER_SHIP = SHIP_SEATS + 1;

/** Cells: the west island, the strait, the east island. */
const MAP_CELLS = { width: 70, height: 60 };
const STRAIT_FROM = 22;
const STRAIT_TO = 42;
const SEAT_HQ = { x: 16, y: 20 };
const BARRACKS = { x: 22, y: 50 };
const FOE_HQ = { x: 120, y: 40 };
/** The strait column beside the west shore where the seat's ships lie moored, a ship every
 *  {@link SHIP_SPACING} rows from {@link FIRST_SHIP_ROW}. */
const SHIP_COLUMN = 46;
const FIRST_SHIP_ROW = 10;
const SHIP_SPACING = 10;
/** The foe's spearmen that wait at the first ship's shore, {@link GUARD_FACTOR} times the wave,
 *  {@link GUARD_RANK} abreast from {@link GUARD_OFFSET} nodes before it. */
const GUARD_FACTOR = 2;
const GUARD_RANK = 8;
const GUARD_OFFSET = 6;
const ARMY_RANK = 6;
/** The most a landing may take to board, cross and sail home: a run ending sooner stops at once. */
const LANDING_LIMIT_TICKS = LANDING_FORM_TIMEOUT_TICKS + 2 * LANDING_SAIL_TIMEOUT_TICKS;
/** Twice the decisions a full fleet with its full band takes to open its landing here. */
const DECISIONS_TO_OPEN = 8;

/** {@link aiContent} with a small ship that admits spearmen. */
function landingContent(): ContentSet {
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

/** Only the military module decides, so the seat's men are its army and nothing else orders them. */
function militaryOnly(): Partial<ComputerModuleEnables> {
  const modules: Partial<ComputerModuleEnables> = {};
  for (const id of COMPUTER_MODULE_IDS) modules[id] = id === 'military';
  return modules;
}

function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('setup: the fixture map builds no terrain graph');
  return sim.terrain;
}

interface LandingWorld {
  readonly sim: Simulation;
  /** The seat's landing fleet ({@link landingFleetShips}). */
  readonly fleet: number;
}

/** The seat on the west island with its landing fleet moored, `shipsShort` ships missing, and the men
 *  to fill it at the barracks door, `menShort` missing; the foe's headquarters on the east island. */
function landingWorld({ shipsShort = 0, menShort = 0 } = {}): LandingWorld {
  const sim = new Simulation({ seed: 7, content: landingContent(), map: islands() });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, modules: militaryOnly() });
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
  const fleet = landingFleetShips(sim.world, SEAT, computerProfileOf(sim.world, SEAT));
  for (let i = 0; i < fleet - shipsShort; i++) {
    const at = { x: SHIP_COLUMN, y: FIRST_SHIP_ROW + SHIP_SPACING * i };
    createVehicle(sim.world, ctxOf(sim), { vehicleType: SHIP, ...at, tribe: VIKING, owner: SEAT });
  }
  spawnBand(sim, fleet * MEN_PER_SHIP - menShort, { x: BARRACKS.x - 6, y: BARRACKS.y + 8 }, ARMY_RANK, SEAT);
  return { sim, fleet };
}

function spawnBand(
  sim: Simulation,
  count: number,
  from: { x: number; y: number },
  rank: number,
  owner: number,
): void {
  for (let i = 0; i < count; i++) {
    const at = { x: from.x + 2 * (i % rank), y: from.y + 2 * Math.floor(i / rank) };
    spawnSettler(sim.world, ctxOf(sim), {
      kind: 'spawnSettler',
      jobType: SPEARMAN,
      ...at,
      tribe: VIKING,
      owner,
    });
  }
}

function landings(sim: Simulation): OperationView[] {
  return seatOperationsOf(sim.world, SEAT).filter((op) => op.kind === 'landing');
}

function seatShips(sim: Simulation): Entity[] {
  return [...sim.world.query(Vehicle, Owner)].filter((e) => sim.world.get(e, Owner).player === SEAT);
}

/** The seat's men standing on the foe's island. */
function menAcross(sim: Simulation): Entity[] {
  const terrain = terrainOf(sim);
  const across = terrain.componentOf(terrain.nodeAtClamped(FOE_HQ.x, FOE_HQ.y + 10));
  return [...sim.world.query(Settler, Owner, Position)].filter((e) => {
    if (sim.world.get(e, Owner).player !== SEAT) return false;
    const p = sim.world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    return terrain.componentOf(terrain.nodeAtClamped(node.hx, node.hy)) === across;
  });
}

/** Step the sim at most `ticks`, calling `watch` after every tick, until it answers true. */
function runUntil(sim: Simulation, ticks: number, watch: () => boolean): void {
  const end = sim.tick + ticks;
  while (sim.tick < end) {
    sim.step();
    if (watch()) return;
  }
}

/** Whether every one of the seat's ships lies moored empty. */
function shipsHomeEmpty(sim: Simulation): boolean {
  return seatShips(sim).every((e) => {
    const state = sim.world.get(e, Vehicle);
    return state.moored && vehiclePassengers(state).length === 0;
  });
}

describe('landing operations', () => {
  it('lands the wave on the rival island and brings the empty ships home', () => {
    const { sim, fleet } = landingWorld();
    const homes = new Map(seatShips(sim).map((e) => [e, { ...sim.world.get(e, Vehicle).mooring }]));
    let landedMost = 0;
    let seen: OperationView | undefined;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      landedMost = Math.max(landedMost, menAcross(sim).length);
      seen = landings(sim)[0] ?? seen;
      return landedMost > 0 && shipsHomeEmpty(sim);
    });
    expect(seen?.landing?.startShips).toBe(fleet);
    // Every man but the commanders went ashore.
    expect(seen?.landing?.landed).toBe(fleet * SHIP_SEATS);
    expect(landedMost).toBe(fleet * SHIP_SEATS);
    for (const [ship, home] of homes) {
      const state = sim.world.get(ship, Vehicle);
      expect(state.moored).toBe(true);
      expect(state.mooring).toEqual(home);
      expect(vehiclePassengers(state)).toEqual([]);
    }
    for (const e of sim.world.query(Settler, Owner)) expect(sim.world.has(e, Rider)).toBe(false);
  });

  it('keeps a half-ready fleet home', () => {
    const { sim, fleet } = landingWorld({ shipsShort: 1 });
    expect(fleet).toBeGreaterThan(1);
    runUntil(sim, DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS, () => {
      expect(landings(sim)).toEqual([]);
      return false;
    });
  });

  it('never sails a band that leaves the fleet half empty', () => {
    const { sim, fleet } = landingWorld({ menShort: MEN_PER_SHIP + 1 });
    // The men left still fill all but one ship and part of it.
    expect((fleet - 1) * MEN_PER_SHIP).toBeGreaterThan(0);
    runUntil(sim, DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS, () => {
      expect(landings(sim)).toEqual([]);
      return false;
    });
  });

  it('turns back without landing when the enemy at the shore outweighs the wave', () => {
    const { sim, fleet } = landingWorld();
    let seen: OperationView | undefined;
    let guarded = false;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      seen = landings(sim)[0] ?? seen;
      if (seen?.state === 'done') return shipsHomeEmpty(sim);
      // The guards arrive once the ships are under way, so the launch never saw them.
      if (guarded || seen?.state !== 'moving') return false;
      guarded = true;
      const shore = seen.landing?.ships[0]?.shore;
      if (shore === undefined) throw new Error('a sailing landing has a ship');
      const post = { x: shore.hx + GUARD_OFFSET / 2, y: shore.hy - GUARD_OFFSET };
      spawnBand(sim, GUARD_FACTOR * fleet * MEN_PER_SHIP, post, GUARD_RANK, FOE);
      return false;
    });
    expect(guarded).toBe(true);
    expect(seen?.reason).toBe('outmatched');
    expect(seen?.landing?.landed).toBe(0);
    expect(menAcross(sim)).toEqual([]);
    for (const ship of seatShips(sim)) expect(vehiclePassengers(sim.world.get(ship, Vehicle))).toEqual([]);
  });
});
