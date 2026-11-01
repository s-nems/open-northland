import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  COMPUTER_MODULE_IDS,
  type ComputerModuleEnables,
  Owner,
  Position,
  Rider,
  Settler,
  Vehicle,
  vehiclePassengers,
} from '../../../../../src/components/index.js';
import type { DeepReadonly, Entity } from '../../../../../src/ecs/world.js';
import {
  halfCellMapFromCells,
  nodeOfPosition,
  Simulation,
  type TerrainMap,
} from '../../../../../src/index.js';
import { type HalfCellNode, hexagonRing } from '../../../../../src/nav/halfcell.js';
import type { TerrainGraph } from '../../../../../src/nav/terrain/index.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../../../../src/systems/ai-shared/cadence.js';
import { computerProfileOf } from '../../../../../src/systems/computer-player/difficulty.js';
import { type OperationView, seatOperationsOf } from '../../../../../src/systems/computer-player/index.js';
import {
  LANDING_FORM_TIMEOUT_TICKS,
  LANDING_SAIL_TIMEOUT_TICKS,
} from '../../../../../src/systems/computer-player/military/operations/landing.js';
import {
  LANDING_BIG_SHIPS,
  LANDING_FLEET_MIN_SHIPS,
  landingFleetShips,
} from '../../../../../src/systems/computer-player/workforce/craft.js';
import { spawnSettler } from '../../../../../src/systems/spawn/index.js';
import { createVehicle } from '../../../../../src/systems/vehicles/index.js';
import { crewInside } from '../../../../../src/systems/vehicles/movement.js';
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
/** The ship's door distance: it moors this many hex steps off its shore point. */
const SHIP_DOOR_DISTANCE = 4;
const MEN_PER_SHIP = SHIP_SEATS + 1;

/** Cells: the west island, the strait, the east island. */
const MAP_CELLS = { width: 70, height: 60 };
const STRAIT_FROM = 22;
const STRAIT_TO = 42;
const SEAT_HQ = { x: 16, y: 20 };
const BARRACKS = { x: 22, y: 50 };
const FOE_HQ = { x: 120, y: 40 };
const TOWER_TYPE = 15;
const FARM_TYPE = 5;
/** A foe tower whose reach covers his headquarters, and a farm out of reach of both. */
const FOE_TOWER = { x: 120, y: 54 };
const FOE_FARM = { x: 104, y: 100 };
/** The farm's life pool here, so a landing can strike it. */
const FARM_HITPOINTS = 300;
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

/** {@link aiContent} with a small ship that admits spearmen and, unless `shelterFire`, no house bow, so
 *  the foe's headquarters shelters its people without the fire a landing weighs. */
function landingContent(shelterFire: boolean): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    weapons: shelterFire ? base.weapons : base.weapons.filter((w) => w.id !== 'house_bow'),
    buildings: base.buildings.map((b) => (b.typeId === FARM_TYPE ? { ...b, hitpoints: FARM_HITPOINTS } : b)),
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
        passengerVector: { direction: 2, distance: SHIP_DOOR_DISTANCE },
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

/** The seat on the west island with `ships` ships moored, its whole landing fleet by default, and `men`
 *  men at the barracks door, as many as fill the fleet by default; the foe's headquarters on the east
 *  island. */
function landingWorld({
  ships,
  men,
  shelterFire = false,
  foe = [],
}: {
  ships?: number;
  men?: number;
  shelterFire?: boolean;
  /** More foe buildings on the east island. */
  foe?: readonly { readonly buildingType: number; readonly at: { x: number; y: number } }[];
} = {}): LandingWorld {
  const sim = new Simulation({ seed: 7, content: landingContent(shelterFire), map: islands() });
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
  for (const b of foe) place(b.buildingType, b.at, FOE);
  sim.step();
  const fleet = landingFleetShips(sim.world, SEAT, computerProfileOf(sim.world, SEAT));
  for (let i = 0; i < (ships ?? fleet); i++) {
    const at = { x: SHIP_COLUMN, y: FIRST_SHIP_ROW + SHIP_SPACING * i };
    createVehicle(sim.world, ctxOf(sim), { vehicleType: SHIP, ...at, tribe: VIKING, owner: SEAT });
  }
  spawnBand(sim, men ?? fleet * MEN_PER_SHIP, { x: BARRACKS.x - 6, y: BARRACKS.y + 8 }, ARMY_RANK, SEAT);
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

function foeHeadquarters(sim: Simulation): Entity | null {
  for (const e of sim.world.query(Building, Owner)) if (sim.world.get(e, Owner).player === FOE) return e;
  return null;
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
  it('lands the wave on the rival island and takes it home once nothing is left to strike', () => {
    const { sim, fleet } = landingWorld();
    const terrain = terrainOf(sim);
    const landOf = (at: DeepReadonly<HalfCellNode> | null) =>
      at === null ? null : terrain.componentOf(terrain.nodeAt(at.hx, at.hy));
    const homes = new Map(seatShips(sim).map((e) => [e, landOf(sim.world.get(e, Vehicle).mooring)]));
    let landedMost = 0;
    let seen: OperationView | undefined;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      landedMost = Math.max(landedMost, menAcross(sim).length);
      // The foe's headquarters falls once the men are ashore.
      const hq = foeHeadquarters(sim);
      if (landedMost > 0 && hq !== null) sim.world.destroy(hq);
      seen = landings(sim)[0] ?? seen;
      return landedMost > 0 && shipsHomeEmpty(sim);
    });
    expect(seen?.landing?.startShips).toBe(fleet);
    // Every man but the commanders went ashore.
    expect(seen?.landing?.landed).toBe(fleet * SHIP_SEATS);
    expect(landedMost).toBe(fleet * SHIP_SEATS);
    // The headquarters gone, the men walked back aboard the waiting ships and came home.
    expect(seen?.reason).toBe('nothingToStrike');
    expect(menAcross(sim)).toEqual([]);
    for (const [ship, home] of homes) {
      const state = sim.world.get(ship, Vehicle);
      expect(state.moored).toBe(true);
      expect(landOf(state.mooring)).toBe(home);
      expect(vehiclePassengers(state)).toEqual([]);
    }
    for (const e of sim.world.query(Settler, Owner)) expect(sim.world.has(e, Rider)).toBe(false);
  });

  it('takes the survivors home once half the men set ashore fell', () => {
    const { sim, fleet } = landingWorld();
    let seen: OperationView | undefined;
    let struck = false;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      seen = landings(sim)[0] ?? seen;
      if (seen?.state === 'done') return shipsHomeEmpty(sim);
      const across = menAcross(sim);
      if (struck || seen?.state !== 'acting' || across.length < fleet * SHIP_SEATS) return false;
      struck = true;
      for (const e of across.slice(0, Math.ceil(across.length / 2))) sim.world.destroy(e);
      return false;
    });
    expect(struck).toBe(true);
    expect(seen?.reason).toBe('losses');
    expect(foeHeadquarters(sim)).not.toBeNull();
    expect(menAcross(sim)).toEqual([]);
    expect(shipsHomeEmpty(sim)).toBe(true);
    for (const e of sim.world.query(Settler, Owner)) expect(sim.world.has(e, Rider)).toBe(false);
  });

  it('casts the fleet off together and sets the wave ashore once every ship lies at its shore', () => {
    const { sim } = landingWorld();
    let castOff = false;
    let landedFirst = false;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      const op = landings(sim)[0];
      if (op?.landing == null) return false;
      const states = op.landing.ships.map((ship) => ({ ship, state: sim.world.get(ship.vehicle, Vehicle) }));
      if (!castOff && states.some(({ state }) => !state.moored)) {
        castOff = true;
        for (const { state } of states) expect(crewInside(state)).toBe(true);
      }
      if (menAcross(sim).length === 0) return false;
      landedFirst = true;
      for (const { ship, state } of states) {
        const atShore = state.mooring?.hx === ship.shore.hx && state.mooring.hy === ship.shore.hy;
        expect(ship.leg !== 'out' || (state.moored && atShore)).toBe(true);
      }
      return true;
    });
    expect(castOff).toBe(true);
    expect(landedFirst).toBe(true);
  });

  it('docks a returning ship at another shore of home once hulls took every berth of its own', () => {
    const { sim } = landingWorld();
    const terrain = terrainOf(sim);
    let home: HalfCellNode | null = null;
    let first: { readonly vehicle: Entity; readonly home: HalfCellNode } | null = null;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      const op = landings(sim)[0];
      const ship = op?.landing?.ships[0];
      if (ship === undefined) return false;
      const state = sim.world.get(ship.vehicle, Vehicle);
      // Home once moored at the shore it docked at, its commander let off there.
      if (first !== null) return ship.leg === 'home' && vehiclePassengers(state).length === 0;
      if (state.moored && state.mooring !== null) home = { ...state.mooring };
      else if (home !== null) {
        first = { vehicle: ship.vehicle, home };
        // New ships launched on every water node the first one could moor from at home.
        for (const { point } of hexagonRing(home, SHIP_DOOR_DISTANCE)) {
          if (!terrain.inBounds(point.hx, point.hy) || !terrain.isWater(terrain.nodeAt(point.hx, point.hy)))
            continue;
          createVehicle(sim.world, ctxOf(sim), {
            vehicleType: SHIP,
            x: point.hx,
            y: point.hy,
            tribe: VIKING,
            owner: SEAT,
          });
        }
      }
      return false;
    });
    const cast = first as { readonly vehicle: Entity; readonly home: HalfCellNode } | null;
    if (cast === null) throw new Error('the landing never cast off');
    const state = sim.world.get(cast.vehicle, Vehicle);
    expect(state.moored).toBe(true);
    expect(state.mooring).not.toEqual(cast.home);
    expect(terrain.componentOf(terrain.nodeAt(state.mooring?.hx ?? 0, state.mooring?.hy ?? 0))).toBe(
      terrain.componentOf(terrain.nodeAt(cast.home.hx, cast.home.hy)),
    );
    expect(vehiclePassengers(state)).toEqual([]);
  });

  it('sails every man in as few ships as seat him when they are fewer than the whole fleet', () => {
    const men = LANDING_BIG_SHIPS * MEN_PER_SHIP - 1;
    const { sim, fleet } = landingWorld({ men });
    expect(fleet).toBeGreaterThan(LANDING_BIG_SHIPS);
    let seen: OperationView | undefined;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      seen = landings(sim)[0] ?? seen;
      return (seen?.landing?.landed ?? 0) > 0;
    });
    expect(seen?.landing?.startShips).toBe(LANDING_BIG_SHIPS);
    expect(seen?.landing?.startMen).toBe(men);
  });

  it('holds the landing back while the fire of the shelters it believes the foe holds outweighs it', () => {
    const { sim } = landingWorld({ men: LANDING_BIG_SHIPS * MEN_PER_SHIP, shelterFire: true });
    runUntil(sim, DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS, () => {
      expect(landings(sim)).toEqual([]);
      return false;
    });
  });

  it('sails no landing while a tower covers the headquarters and nothing else lies clear', () => {
    const { sim } = landingWorld({ foe: [{ buildingType: TOWER_TYPE, at: FOE_TOWER }] });
    runUntil(sim, DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS, () => {
      expect(landings(sim)).toEqual([]);
      return false;
    });
  });

  it('lands on a building out of the reach of the tower that covers the headquarters', () => {
    const { sim } = landingWorld({
      foe: [
        { buildingType: TOWER_TYPE, at: FOE_TOWER },
        { buildingType: FARM_TYPE, at: FOE_FARM },
      ],
    });
    let seen: OperationView | undefined;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      seen = landings(sim)[0] ?? seen;
      return (seen?.landing?.landed ?? 0) > 0;
    });
    expect(seen?.landing?.landed).toBeGreaterThan(0);
  });

  it('keeps fewer ships than a big landing home', () => {
    const { sim } = landingWorld({ ships: LANDING_BIG_SHIPS - 1 });
    runUntil(sim, DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS, () => {
      expect(landings(sim)).toEqual([]);
      return false;
    });
  });

  it('never sails fewer men than fill its least ships', () => {
    const { sim } = landingWorld({ men: LANDING_FLEET_MIN_SHIPS * MEN_PER_SHIP - 1 });
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
      // The guards arrive with the first ship at its shore, so neither the launch nor the posture saw them.
      const ashore = seen?.landing?.ships.find((ship) => {
        const state = sim.world.get(ship.vehicle, Vehicle);
        return state.moored && state.mooring?.hx === ship.shore.hx && state.mooring.hy === ship.shore.hy;
      });
      if (guarded || seen?.state !== 'moving' || ashore === undefined) return false;
      guarded = true;
      const shore = ashore.shore;
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
