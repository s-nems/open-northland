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
import { TICKS_PER_SECOND } from '../../../../../src/core/loop.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import {
  halfCellMapFromCells,
  nodeOfPosition,
  Simulation,
  type TerrainMap,
} from '../../../../../src/index.js';
import type { TerrainGraph } from '../../../../../src/nav/terrain/index.js';
import { type OperationView, seatOperationsOf } from '../../../../../src/systems/computer-player/index.js';
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
const SHIPS = 2;

/** Cells: the west island, the strait, the east island. */
const MAP_CELLS = { width: 70, height: 40 };
const STRAIT_FROM = 22;
const STRAIT_TO = 42;
const SEAT_HQ = { x: 16, y: 20 };
const BARRACKS = { x: 22, y: 50 };
const FOE_HQ = { x: 120, y: 40 };
/** Strait nodes beside the west shore, where the seat's ships lie moored. */
const SHIP_SPOTS = [
  { x: 46, y: 30 },
  { x: 46, y: 50 },
];
/** The foe's spearmen that wait at the east shore nearest his headquarters, three times the wave. */
const GUARD_POST = { x: 88, y: 36 };
const GUARDS = 3 * SHIPS * MEN_PER_SHIP;
/** Long enough for the men to board, the crossing, the landing and the voyage home. */
const RUN_SECONDS = 900;

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

/** The seat on the west island with its army at the barracks door and its ships moored, and the foe's
 *  headquarters on the east island. */
function landingWorld(ships = SHIPS): Simulation {
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
  for (let i = 0; i < ships * MEN_PER_SHIP; i++) {
    const at = { x: BARRACKS.x - 6 + 2 * (i % 6), y: BARRACKS.y + 8 + 2 * Math.floor(i / 6) };
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: SPEARMAN, ...at, tribe: VIKING, owner: SEAT });
  }
  sim.step();
  for (const at of SHIP_SPOTS.slice(0, ships))
    createVehicle(sim.world, ctxOf(sim), { vehicleType: SHIP, ...at, tribe: VIKING, owner: SEAT });
  return sim;
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

/** Step the sim `seconds`, calling `watch` after every tick. */
function run(sim: Simulation, seconds: number, watch: () => void): void {
  const end = sim.tick + seconds * TICKS_PER_SECOND;
  while (sim.tick < end) {
    sim.step();
    watch();
  }
}

describe('landing operations', () => {
  it('lands the wave on the rival island and brings the empty ships home', () => {
    const sim = landingWorld();
    const homes = new Map(seatShips(sim).map((e) => [e, { ...sim.world.get(e, Vehicle).mooring }]));
    let landedMost = 0;
    let seen: OperationView | undefined;
    run(sim, RUN_SECONDS, () => {
      landedMost = Math.max(landedMost, menAcross(sim).length);
      seen = landings(sim)[0] ?? seen;
    });
    expect(seen?.landing?.startShips).toBe(SHIPS);
    // Every man but the commanders went ashore.
    expect(seen?.landing?.landed).toBe(SHIPS * SHIP_SEATS);
    expect(landedMost).toBe(SHIPS * SHIP_SEATS);
    for (const [ship, home] of homes) {
      const state = sim.world.get(ship, Vehicle);
      expect(state.moored).toBe(true);
      expect(state.mooring).toEqual(home);
      expect(vehiclePassengers(state)).toEqual([]);
    }
    for (const e of sim.world.query(Settler, Owner)) expect(sim.world.has(e, Rider)).toBe(false);
  });

  it('waits for a second ship', () => {
    const sim = landingWorld(1);
    run(sim, RUN_SECONDS / 4, () => {
      expect(landings(sim)).toEqual([]);
    });
  });

  it('turns back without landing when the enemy at the shore outweighs the wave', () => {
    const sim = landingWorld();
    let seen: OperationView | undefined;
    let guarded = false;
    run(sim, RUN_SECONDS, () => {
      seen = landings(sim)[0] ?? seen;
      // The guards arrive once the ships are under way, so the launch never saw them.
      if (guarded || seen?.state !== 'moving') return;
      guarded = true;
      for (let i = 0; i < GUARDS; i++) {
        const at = { x: GUARD_POST.x + 2 * (i % 4), y: GUARD_POST.y + 2 * Math.floor(i / 4) };
        spawnSettler(sim.world, ctxOf(sim), {
          kind: 'spawnSettler',
          jobType: SPEARMAN,
          ...at,
          tribe: VIKING,
          owner: FOE,
        });
      }
    });
    expect(guarded).toBe(true);
    expect(seen?.reason).toBe('outmatched');
    expect(seen?.landing?.landed).toBe(0);
    expect(menAcross(sim)).toEqual([]);
    for (const ship of seatShips(sim)) expect(vehiclePassengers(sim.world.get(ship, Vehicle))).toEqual([]);
  });
});
