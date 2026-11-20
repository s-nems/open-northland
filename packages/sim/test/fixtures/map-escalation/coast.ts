import type { ContentSet, MapAiSeat, MapModulesInput, MapNotice } from '@open-northland/data';
import { MapModules, parseContentSet } from '@open-northland/data';
import { Owner, Position, Settler, Vehicle } from '../../../src/components/index.js';
import { TICKS_PER_SECOND } from '../../../src/core/loop.js';
import type { Entity } from '../../../src/ecs/world.js';
import { halfCellMapFromCells, Simulation, type TerrainMap } from '../../../src/index.js';
import { hexDistanceBetween, nodeOfPosition } from '../../../src/nav/halfcell.js';
import { CONDITION_ALWAYS } from '../../../src/systems/map-ai/index.js';
import { aiContent } from '../ai-content.js';

/**
 * A synthetic coast for a siege: open sea in the west, a fortress keep and one player seat with
 * two houses and a villager on land, and a raider whose wave brings a sea landing.
 */

const VIKING = 1;
const HQ_TYPE = 1;
const SPEARMAN = 32;
const BOWMAN = 40;
const HQ_SLUG = 'headquarters';
const VIKING_SLUG = 'viking';
const SPEARMAN_SLUG = 'soldier_spear_wooden';
const BOWMAN_SLUG = 'soldier_bow_short';
const SHIP = 3;
/** The ship's seats besides the commander's: the landing carries one more man than this. */
export const SHIP_SEATS = 3;
/** More than a ship seats, so each ship sails full. */
const MEN_PER_SHIP = 6;

const FORTRESS = 6;
export const PLAYER = 0;
const RAIDER = 7;

/** Cells: open sea in the west columns, land from {@link SHORE_CELL} east. */
const MAP_CELLS = { width: 50, height: 30 };
const SHORE_CELL = 10;
const KEEP = { x: 90, y: 30 };
export const TARGET = { x: 60, y: 30 };
export const SECOND_HOUSE = { x: 60, y: 46 };
const VILLAGER = { x: 66, y: 36 };
export const LANDING = { spawnX: 4, spawnY: 30, x: 21, y: 30 };
/** A second stretch of the same coast, for a wave's second ship. */
export const SECOND_LANDING = { spawnX: 4, spawnY: 50, x: 21, y: 50 };

export const LAUNCH_SECONDS = 10;
/** The landing notice, by map string id. */
export const NOTICE: MapNotice = { title: 7 };

/** {@link aiContent} with a small ship that admits the attack's trades. */
function landingContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    vehicles: [
      {
        typeId: SHIP,
        id: 'ship_small',
        jobId: 52,
        stockSlots: 0,
        passengerSlots: SHIP_SEATS,
        logicSize: 2,
        passengerJobs: [SPEARMAN, BOWMAN],
        commanderJob: 24,
        passengerVector: { direction: 2, distance: 4 },
        hitpoints: 5000,
      },
    ],
  });
}

/** Cells of an inland lake no sea route reaches, north of the houses; {@link LAKE} is its middle node. */
const LAKE_CELLS = { col: 30, row: 2, size: 7 };
export const LAKE = { x: 67, y: 10 };

/** The coast; `lake` adds the inland lake. */
export function coast(lake = false): TerrainMap {
  const GRASS = 0;
  const WATER = 1;
  const { width, height } = MAP_CELLS;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let row = 0; row < height; row++)
    for (let col = 0; col < SHORE_CELL; col++) typeIds[row * width + col] = WATER;
  if (lake) {
    const { col, row, size } = LAKE_CELLS;
    for (let r = row; r < row + size; r++)
      for (let c = col; c < col + size; c++) typeIds[r * width + c] = WATER;
  }
  return halfCellMapFromCells({ width, height, typeIds });
}

export const LANDINGS = { vehicle: 'ship_small', menPerShip: MEN_PER_SHIP, notice: NOTICE };

export const SIEGE: NonNullable<MapModulesInput['siege']> = {
  version: 1,
  stronghold: { seat: FORTRESS, building: HQ_SLUG, ...KEEP, range: 4 },
  tribe: VIKING_SLUG,
  jobMix: [
    { job: SPEARMAN_SLUG, weight: 2 },
    { job: BOWMAN_SLUG, weight: 1 },
  ],
  attacks: {
    launches: [{ atSeconds: LAUNCH_SECONDS, landMen: 1, ships: 1 }],
    repeat: { everySeconds: 600, waves: [{ landMen: 0, ships: 0 }] },
    endDeadPct: 100,
    endAfterSeconds: 300,
    targets: [{ seat: PLAYER, raider: RAIDER, ...TARGET, landings: [LANDING, SECOND_LANDING] }],
  },
  guard: {
    base: 0,
    perSeatStep: 0,
    stepSeconds: 60,
    perSeatMax: 0,
    refill: { everySeconds: 60, baseMen: 0, stepMen: 0, stepSeconds: 60, maxMen: 0 },
  },
  landings: LANDINGS,
};

export const SCRIPT: MapAiSeat[] = [
  {
    player: RAIDER,
    allDisabled: false,
    computerDisabled: true,
    disabledComputerModules: [],
    conditions: [],
    tasks: [
      {
        kind: 'attack',
        priority: 100,
        condition: CONDITION_ALWAYS,
        ...TARGET,
        range: 20,
        min: 0,
        max: 0,
        rallyX: 75,
        rallyY: 30,
        stance: 1,
      },
    ],
  },
];

/** The coast world after its setup tick. */
export function coastWorld(
  siege: NonNullable<MapModulesInput['siege']> = SIEGE,
  map: TerrainMap = coast(),
): Simulation {
  const sim = new Simulation({
    seed: 5,
    content: landingContent(),
    map,
    mapAiScript: SCRIPT,
    mapModules: MapModules.parse({ siege }),
  });
  for (const player of [FORTRESS, RAIDER]) {
    sim.enqueueSetup({ kind: 'setAiControl', player, enabled: true, modules: { military: false } });
  }
  sim.enqueueSetup({ kind: 'setDiplomacy', from: FORTRESS, to: RAIDER, state: 'friend' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: RAIDER, to: FORTRESS, state: 'friend' });
  const house = (owner: number, at: { x: number; y: number }) =>
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      ...at,
      tribe: VIKING,
      owner,
      force: true,
      underConstruction: false,
    });
  house(FORTRESS, KEEP);
  house(PLAYER, TARGET);
  house(PLAYER, SECOND_HOUSE);
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: 0, ...VILLAGER, tribe: VIKING, owner: PLAYER });
  sim.step();
  return sim;
}

export function raiderShips(sim: Simulation): Entity[] {
  return [...sim.world.query(Vehicle, Owner)].filter((e) => sim.world.get(e, Owner).player === RAIDER);
}

export function raiderMen(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler, Owner)].filter((e) => sim.world.get(e, Owner).player === RAIDER);
}

export function distance(sim: Simulation, e: Entity, to: { x: number; y: number }): number {
  const at = sim.world.get(e, Position);
  const node = nodeOfPosition(at.x, at.y);
  return hexDistanceBetween(node.hx, node.hy, to.x, to.y);
}

/** Step until `done` holds, at most `seconds`; false when it never did. */
export function runUntil(sim: Simulation, seconds: number, done: () => boolean): boolean {
  const end = sim.tick + seconds * TICKS_PER_SECOND;
  while (sim.tick < end) {
    sim.step();
    if (done()) return true;
  }
  return false;
}
