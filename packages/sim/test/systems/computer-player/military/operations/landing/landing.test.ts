import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  Building,
  COMPUTER_MODULE_IDS,
  ComputerColony,
  ComputerIntel,
  type ComputerModuleEnables,
  FOG_MODE,
  Owner,
  PlayerOrder,
  Position,
  Rider,
  Settler,
  Vehicle,
  vehiclePassengers,
} from '../../../../../../src/components/index.js';
import type { DeepReadonly, Entity } from '../../../../../../src/ecs/world.js';
import {
  halfCellMapFromCells,
  nodeOfPosition,
  Simulation,
  type TerrainMap,
} from '../../../../../../src/index.js';
import { type HalfCellNode, hexagonRing, nodeManhattan } from '../../../../../../src/nav/halfcell.js';
import type { TerrainGraph } from '../../../../../../src/nav/terrain/index.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../../../../../src/systems/ai-shared/cadence.js';
import { computerProfileOf } from '../../../../../../src/systems/computer-player/difficulty.js';
import { type OperationView, seatOperationsOf } from '../../../../../../src/systems/computer-player/index.js';
import {
  COLONY_RAID_LEAST_MEN,
  LANDING_EDGE,
} from '../../../../../../src/systems/computer-player/military/operations/landing/aim.js';
import {
  LANDING_ASHORE_ALONE_TICKS,
  LANDING_COOLDOWN_TICKS,
  LANDING_FORM_TIMEOUT_TICKS,
  LANDING_SHORE_STAY_TICKS,
  landingHandler,
} from '../../../../../../src/systems/computer-player/military/operations/landing/landing.js';
import {
  nodeOfEntity,
  RAID_TOWER_CLEARANCE_NODES,
  RAID_TOWER_DEFENCE,
} from '../../../../../../src/systems/computer-player/military/operations/raid-target.js';
import { everyFighterPoints } from '../../../../../../src/systems/computer-player/military/points.js';
import { SHIP_SAIL_TIMEOUT_TICKS } from '../../../../../../src/systems/computer-player/sea-ships.js';
import { militaryOrdersOf } from '../../../../../../src/systems/computer-player/strategy/military.js';
import {
  LANDING_BIG_SHIPS,
  LANDING_FLEET_MIN_SHIPS,
  landingFleetShips,
  SOLDIERS_PER_SHIP,
} from '../../../../../../src/systems/computer-player/workforce/craft.js';
import { ownedFightersOf } from '../../../../../../src/systems/movement/collision/owned-fighters.js';
import { spawnSettler } from '../../../../../../src/systems/spawn/index.js';
import { createVehicle } from '../../../../../../src/systems/vehicles/index.js';
import { crewInside } from '../../../../../../src/systems/vehicles/movement.js';
import { aiContent } from '../../../../../fixtures/ai-content.js';
import { blankColony } from '../../../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../../../fixtures/context.js';

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
/** A second rival, whose headquarters stands on the colony island south of the foe's. */
const SECOND_FOE = 4;
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
/** A foe tower that covers his headquarters from far enough off that the men's rings round the two do not
 *  meet. */
const FOE_FAR_TOWER = { x: 120, y: 68 };
/** Foe towers whose reach, with his headquarters' shelter, covers every shore of his land north of the
 *  channel. */
const COAST_TOWERS = [
  { x: 96, y: 14 },
  { x: 96, y: 50 },
  { x: 126, y: 52 },
];
/** A foe tower on the colony island that covers the farm, far enough off that the men's rings round the two
 *  do not meet. */
const COLONY_TOWER = { x: 128, y: 106 };
/** A farm of the foe's on his own start land, out of his headquarters' reach. */
const FOE_HOME_FARM = { x: 104, y: 16 };
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
/** The foe's band that lands on the seat's colony. */
const RAIDERS = 6;
/** The seat's building on its colony island, by its west shore. */
const COLONY_STORE = { x: 96, y: 108 };
/** Where an enemy ship lies off the colony island and its men stand ashore: in the strait by the colony,
 *  and in the channel at the island's far corner. */
const NEAR_BERTH = { water: { x: 80, y: 104 }, landed: { x: 92, y: 100 } };
const FAR_BERTH = { water: { x: 134, y: 72 }, landed: { x: 130, y: 82 } };
/** A tick just before the decision a full fleet's landing opens on here. */
const BOTH_OPEN_AT = 200;
/** The ships beyond the landing fleet a rescue may sail in. */
const RESCUE_SHIPS = 3;
/** The seat's own men standing on the colony a rescue sails for, at a post out of the band's reach. */
const GARRISON = 5;
const GARRISON_POST = { x: 130, y: 114 };
/** A foe army that outweighs the seat's whole fleet load several times over. */
const OUTMATCHING_FOES = 120;
const FOE_ARMY = { x: 110, y: 0 };
/** The most a landing may take to board, cross and sail home: a run ending sooner stops at once. */
const LANDING_LIMIT_TICKS = LANDING_FORM_TIMEOUT_TICKS + 2 * SHIP_SAIL_TIMEOUT_TICKS;
/** The most a landing may take besides to walk on each building it strikes. */
const STRIKE_LIMIT_TICKS = 2 * LANDING_LIMIT_TICKS;
/** Twice the decisions a full fleet with its full band takes to open its landing here. */
const DECISIONS_TO_OPEN = 8;

/** A spear's blow on every armour, so an armed spearman weighs his share of a fight. */
const SPEAR_DAMAGE = 100;
const ARMOUR_MATERIALS = ['0', '1', '2', '3', '4'];
/** A ship's seats for a wave big enough to storm one tower. */
const STORM_SHIP_SEATS = 9;

interface ContentOptions {
  /** Keep the house bow, so the foe's headquarters fires on a landing. */
  readonly shelterFire: boolean;
  /** Give the spear its blow ({@link SPEAR_DAMAGE}); else every man weighs a bare man's point. */
  readonly armed: boolean;
  readonly seats: number;
}

/** {@link aiContent} with a small ship of `seats` that admits spearmen and, unless `shelterFire`, no house
 *  bow, so the foe's headquarters shelters its people without the fire a landing weighs. */
function landingContent({ shelterFire, armed, seats }: ContentOptions): ContentSet {
  const base = aiContent();
  const damage = Object.fromEntries(ARMOUR_MATERIALS.map((m) => [m, SPEAR_DAMAGE]));
  return parseContentSet({
    ...base,
    weapons: base.weapons
      .filter((w) => shelterFire || w.id !== 'house_bow')
      .map((w) => (armed && w.jobType === SPEARMAN ? { ...w, damage } : w)),
    buildings: base.buildings.map((b) => (b.typeId === FARM_TYPE ? { ...b, hitpoints: FARM_HITPOINTS } : b)),
    vehicles: [
      {
        typeId: SHIP,
        id: 'ship_small',
        jobId: 52,
        stockSlots: 0,
        passengerSlots: seats,
        logicSize: 2,
        passengerJobs: [SPEARMAN],
        commanderJob: 24,
        passengerVector: { direction: 2, distance: SHIP_DOOR_DISTANCE },
        hitpoints: 5000,
      },
    ],
  });
}

/** Cell rows of the channel that, with `colony`, cuts the east island in two: the foe's headquarters north
 *  of it, his farm on a colony island south of it. */
const CHANNEL_FROM = 30;
const CHANNEL_TO = 38;

function islands(colony: boolean): TerrainMap {
  const GRASS = 0;
  const WATER = 1;
  const { width, height } = MAP_CELLS;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let row = 0; row < height; row++)
    for (let col = STRAIT_FROM; col < STRAIT_TO; col++) typeIds[row * width + col] = WATER;
  if (colony)
    for (let row = CHANNEL_FROM; row < CHANNEL_TO; row++)
      for (let col = STRAIT_TO; col < width; col++) typeIds[row * width + col] = WATER;
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
  armed = false,
  seats = SHIP_SEATS,
  colony = false,
  fog = FOG_MODE.OFF,
  foe = [],
}: {
  /** A `FOG_MODE` id. */
  fog?: number;
  ships?: number;
  men?: number;
  shelterFire?: boolean;
  armed?: boolean;
  /** Each ship's seats besides the commander's. */
  seats?: number;
  /** Cut the east island in two ({@link islands}). */
  colony?: boolean;
  /** More foe buildings on the east island. */
  foe?: readonly {
    readonly buildingType: number;
    readonly at: { x: number; y: number };
    /** {@link FOE} by default. */
    readonly owner?: number;
  }[];
} = {}): LandingWorld {
  const sim = new Simulation({
    seed: 7,
    content: landingContent({ shelterFire, armed, seats }),
    map: islands(colony),
  });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.enqueueSetup({ kind: 'setFogMode', mode: fog });
  sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: true, modules: militaryOnly() });
  for (const player of [SEAT, FOE, SECOND_FOE])
    sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player, tribes: [VIKING] });
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
  for (const b of foe) place(b.buildingType, b.at, b.owner ?? FOE);
  sim.step();
  const fleet = landingFleetShips(sim.world, SEAT, computerProfileOf(sim.world, SEAT));
  launchShips(sim, ships ?? fleet);
  spawnBand(sim, men ?? fleet * (seats + 1), { x: BARRACKS.x - 6, y: BARRACKS.y + 8 }, ARMY_RANK, SEAT);
  return { sim, fleet };
}

/** `count` of the seat's ships moored down the strait beside the west shore. */
function launchShips(sim: Simulation, count: number): void {
  for (let i = 0; i < count; i++) {
    const at = { x: SHIP_COLUMN, y: FIRST_SHIP_ROW + SHIP_SPACING * i };
    createVehicle(sim.world, ctxOf(sim), { vehicleType: SHIP, ...at, tribe: VIKING, owner: SEAT });
  }
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

function rescues(sim: Simulation): OperationView[] {
  return seatOperationsOf(sim.world, SEAT).filter((op) => op.kind === 'rescue');
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

/** `owner`'s live men standing on `land`. */
function menOf(sim: Simulation, owner: number, land: number): Entity[] {
  const terrain = terrainOf(sim);
  return [...sim.world.query(Settler, Owner, Position)].filter((e) => {
    if (sim.world.get(e, Owner).player !== owner) return false;
    const node = nodeOfEntity(sim.world, e);
    return node !== null && terrain.componentOf(terrain.nodeAtClamped(node.hx, node.hy)) === land;
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

/** The men's worth of the foe's garrison the seat remembers on his colony, more than its least raid
 *  outweighs half again. */
const REMEMBERED_GARRISON = 12;
/** A foe tower on his island's west coast, by the shores nearest the seat. */
const COAST_TOWER = { x: 90, y: 30 };
/** A foe tower on his island far from his headquarters, covering none of it. */
const FOE_FAR_OFF_TOWER = { x: 128, y: 110 };
/** The towers' weight a clear landing's men ashore make: past one tower, short of the storm's twice. */
const CLEAR_WAVE_TOWERS = { num: 3, den: 2 };
/** The towers' weight the storm wave's men ashore make: past twice one tower, short of twice two. */
const STORM_WAVE_TOWERS = 3;
/** How many times the fleet's seats the army in the cooldown test is, and how many men it spawns abreast. */
const OUTGROWN = 2;
const WIDE_RANK = 16;
/** The fighter points the seat remembers seeing of the foe's army at once: a token band. */
const SEEN_FOE_POINTS = 1;

/** What the seat remembers seeing of the foe's army: `most` points at once, `on` lands the most seen on
 *  each, `faded` when the aged peak has worn off since. */
interface FoeMemory {
  readonly most: number;
  /** The aged peak's points, `most` by default. */
  readonly recent?: number;
  readonly lands?: readonly { readonly land: number; readonly points: number }[];
  readonly faded?: boolean;
}

/** Give the seat the memory `memory` of the foe's army, its own army as it stands. */
function rememberFoeArmy(
  sim: Simulation,
  { most, recent = most, lands = [], faded = false }: FoeMemory,
): void {
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null) throw new Error('setup: no AI seat');
  runUntil(sim, COMPUTER_DECISION_INTERVAL_TICKS, () => sim.world.has(carrier, ComputerIntel));
  const own = everyFighterPoints(sim.world, ctxOf(sim), SEAT);
  sim.world.mut(carrier, ComputerIntel).forces.push({
    player: FOE,
    peak: faded ? 0 : 1,
    peakAt: sim.tick,
    peakPoints: faded ? 0 : recent,
    peakPointsAt: sim.tick,
    mostPoints: most,
    ownPointsAtMost: own,
    lands: lands.map((l) => ({ ...l })),
    lastSeenAt: sim.tick,
    lastZone: 0,
  });
}

/** The points of one of the seat's men: every man of the fixture weighs the same. */
function manPoints(sim: Simulation): number {
  const own = ownedFightersOf(sim.world, sim.content, SEAT);
  return everyFighterPoints(sim.world, ctxOf(sim), SEAT) / own.length;
}

/** How far a placed building's anchor may lie from the spot it was placed at. */
const PLACED_SLACK_NODES = 4;

/** The foe's building standing at `at`, or null once it fell. */
function foeBuildingAt(sim: Simulation, at: { x: number; y: number }): Entity | null {
  let best: { readonly e: Entity; readonly distance: number } | null = null;
  for (const e of sim.world.query(Building, Owner)) {
    if (sim.world.get(e, Owner).player !== FOE) continue;
    const node = nodeOfEntity(sim.world, e);
    if (node === null) continue;
    const distance = Math.abs(node.hx - at.x) + Math.abs(node.hy - at.y);
    if (distance <= PLACED_SLACK_NODES && (best === null || distance < best.distance)) best = { e, distance };
  }
  return best?.e ?? null;
}

/**
 * Run the seat's landing through to its end while its landed men strike `targets`, the foe's buildings
 * nearest each spot: once a landed man walks on the ring round the one of them his attack-move aims nearest
 * (the men here fell no building themselves), it falls by hand. Returns the targets in the order the men
 * marched on them and the landing as last seen.
 */
function strikeInTurn(
  sim: Simulation,
  targets: readonly { x: number; y: number }[],
): { readonly order: { x: number; y: number }[]; readonly seen: OperationView | undefined } {
  const terrain = terrainOf(sim);
  const order: { x: number; y: number }[] = [];
  let seen: OperationView | undefined;
  runUntil(sim, STRIKE_LIMIT_TICKS, () => {
    seen = landings(sim)[0] ?? seen;
    if (seen?.state === 'done') return shipsHomeEmpty(sim);
    for (const e of seen?.members ?? []) {
      const goal = sim.world.tryGet(e, PlayerOrder)?.attackMove?.goal;
      if (goal === undefined) continue;
      const { x, y } = terrain.coordsOf(goal);
      const standing = targets.filter((t) => !order.includes(t) && foeBuildingAt(sim, t) !== null);
      const aimed = standing.reduce<{ x: number; y: number } | null>(
        (best, t) =>
          best === null || Math.abs(t.x - x) + Math.abs(t.y - y) < Math.abs(best.x - x) + Math.abs(best.y - y)
            ? t
            : best,
        null,
      );
      if (aimed === null) continue;
      order.push(aimed);
      const building = foeBuildingAt(sim, aimed);
      if (building !== null) sim.world.destroy(building);
      break;
    }
    return false;
  });
  return { order, seen };
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

  it('lets its men go where they stand once they fought on alone past their time, the ships home', () => {
    // The men fell no building here, so the headquarters outlasts them.
    const { sim } = landingWorld();
    let seen: OperationView | undefined;
    runUntil(sim, LANDING_LIMIT_TICKS + LANDING_SHORE_STAY_TICKS + LANDING_ASHORE_ALONE_TICKS, () => {
      seen = landings(sim)[0] ?? seen;
      return seen?.state === 'done';
    });
    expect(seen?.reason).toBe('timedOut');
    expect(seen?.members).toEqual([]);
    expect(foeHeadquarters(sim)).not.toBeNull();
    expect(shipsHomeEmpty(sim)).toBe(true);
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

  it('holds the landing back on the shelter fire it believes even once the shelter fell out of its sight', () => {
    const { sim } = landingWorld({
      men: LANDING_BIG_SHIPS * MEN_PER_SHIP,
      shelterFire: true,
      fog: FOG_MODE.CLASSIC_FOG_OF_WAR,
    });
    rememberFoeArmy(sim, { most: SEEN_FOE_POINTS });
    const hq = foeHeadquarters(sim);
    if (hq === null) throw new Error('setup: no foe headquarters');
    sim.world.destroy(hq);
    runUntil(sim, DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS, () => {
      expect(landings(sim)).toEqual([]);
      return false;
    });
    expect(militaryOrdersOf(sim.world, SEAT).launchRatio).not.toBeNull();
  });

  it('sails no landing while a tower covers the headquarters, nothing else lies clear and the wave cannot storm it', () => {
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

  it('sails and moors out of the reach of the tower it believes guards the coast', () => {
    const { sim } = landingWorld({ foe: [{ buildingType: TOWER_TYPE, at: COAST_TOWER }] });
    const tower = foeBuildingAt(sim, COAST_TOWER);
    const at = tower === null ? null : nodeOfEntity(sim.world, tower);
    if (at === null) throw new Error('setup: no coast tower');
    let seen: OperationView | undefined;
    let nearest = Number.POSITIVE_INFINITY;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      seen = landings(sim)[0] ?? seen;
      for (const ship of seen?.landing?.ships ?? []) {
        const node = nodeOfEntity(sim.world, ship.vehicle);
        if (node !== null) nearest = Math.min(nearest, nodeManhattan(node, at));
      }
      return (seen?.landing?.landed ?? 0) > 0;
    });
    expect(seen?.landing?.landed).toBeGreaterThan(0);
    for (const ship of seen?.landing?.ships ?? [])
      expect(nodeManhattan(ship.shore, at)).toBeGreaterThan(RAID_TOWER_CLEARANCE_NODES);
    expect(nearest).toBeGreaterThan(RAID_TOWER_CLEARANCE_NODES);
  });

  it('holds the landing back against the most it ever saw of the army, though it saw only a few since', () => {
    const { sim } = landingWorld({ fog: FOG_MODE.CLASSIC_FOG_OF_WAR });
    // Lately it saw a token band; once it saw an army that outweighs its own.
    rememberFoeArmy(sim, { most: OUTMATCHING_FOES * manPoints(sim), recent: SEEN_FOE_POINTS });
    runUntil(sim, DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS, () => {
      expect(landings(sim)).toEqual([]);
      return false;
    });
    expect(militaryOrdersOf(sim.world, SEAT).launchRatio).not.toBeNull();
  });

  it('starts no storm ashore with a wave that launched on a clear objective and falls short of the storm edge', () => {
    const { sim } = landingWorld({
      armed: true,
      men: 0,
      foe: [
        { buildingType: TOWER_TYPE, at: FOE_TOWER },
        { buildingType: FARM_TYPE, at: FOE_FARM },
      ],
    });
    // Men ashore that outweigh the covering tower at parity, short of twice.
    const one = { x: BARRACKS.x - 6, y: BARRACKS.y + 8 };
    spawnBand(sim, 1, one, ARMY_RANK, SEAT);
    const tower = (CLEAR_WAVE_TOWERS.num * RAID_TOWER_DEFENCE) / CLEAR_WAVE_TOWERS.den;
    const ashore = Math.ceil(tower / manPoints(sim));
    const men = ashore + Math.ceil(ashore / SHIP_SEATS);
    spawnBand(sim, men - 1, { x: one.x, y: one.y + 2 }, ARMY_RANK, SEAT);
    const struck = strikeInTurn(sim, [FOE_FARM]);
    expect(struck.order).toEqual([FOE_FARM]);
    expect(struck.seen?.reason).toBe('nothingToStrike');
    expect(foeHeadquarters(sim)).not.toBeNull();
  });

  it('storms past a tower that does not cover its objective, weighing only the one that does', () => {
    const { sim } = landingWorld({
      armed: true,
      seats: STORM_SHIP_SEATS,
      men: 0,
      foe: [
        { buildingType: TOWER_TYPE, at: FOE_TOWER },
        { buildingType: TOWER_TYPE, at: FOE_FAR_OFF_TOWER },
      ],
    });
    // A wave that outweighs one tower twice ashore but not two, each ship's helm staying aboard.
    const one = { x: BARRACKS.x - 6, y: BARRACKS.y + 8 };
    spawnBand(sim, 1, one, ARMY_RANK, SEAT);
    const ashore = Math.ceil((STORM_WAVE_TOWERS * RAID_TOWER_DEFENCE) / manPoints(sim));
    const men = ashore + Math.ceil(ashore / STORM_SHIP_SEATS);
    spawnBand(sim, men - 1, { x: one.x, y: one.y + 2 }, ARMY_RANK, SEAT);
    let seen: OperationView | undefined;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      seen = landings(sim)[0] ?? seen;
      return (seen?.landing?.landed ?? 0) > 0;
    });
    expect(seen?.target.entity).toBe(foeHeadquarters(sim));
    expect(seen?.landing?.landed).toBeGreaterThan(0);
  });

  it('waits less between landings the more its army outgrows the seats of its landing fleet', () => {
    const { sim, fleet } = landingWorld({ ships: 0, men: 0 });
    const fleetSeats = fleet * SOLDIERS_PER_SHIP;
    spawnBand(sim, OUTGROWN * fleetSeats, { x: 4, y: 60 }, WIDE_RANK, SEAT);
    const terrain = terrainOf(sim);
    const env = {
      world: sim.world,
      ctx: ctxOf(sim),
      terrain,
      seat: SEAT,
      home: terrain.nodeAtClamped(BARRACKS.x, BARRACKS.y),
      orders: militaryOrdersOf(sim.world, SEAT),
    };
    expect(landingHandler.cooldownTicks(env)).toBe(LANDING_COOLDOWN_TICKS / OUTGROWN);
  });

  it.each([
    ['in plain sight', FOG_MODE.OFF],
    ['under fog, knowing only the start layout and the small army it saw', FOG_MODE.CLASSIC_FOG_OF_WAR],
  ])('storms the headquarters a tower covers once the wave outweighs the tower twice, %s', (_, fog) => {
    const { sim } = landingWorld({
      fog,
      armed: true,
      seats: STORM_SHIP_SEATS,
      foe: [{ buildingType: TOWER_TYPE, at: FOE_TOWER }],
    });
    if (fog !== FOG_MODE.OFF) rememberFoeArmy(sim, { most: SEEN_FOE_POINTS });
    let seen: OperationView | undefined;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      seen = landings(sim)[0] ?? seen;
      return (seen?.landing?.landed ?? 0) > 0;
    });
    expect(seen?.target.entity).toBe(foeHeadquarters(sim));
    expect(seen?.landing?.landed).toBeGreaterThan(0);
  });

  it('storms the headquarters first, then the tower covering it, and sails home once both fell', () => {
    const { sim } = landingWorld({
      armed: true,
      seats: STORM_SHIP_SEATS,
      foe: [{ buildingType: TOWER_TYPE, at: FOE_FAR_TOWER }],
    });
    const struck = strikeInTurn(sim, [FOE_HQ, FOE_FAR_TOWER]);
    expect(struck.order).toEqual([FOE_HQ, FOE_FAR_TOWER]);
    expect(struck.seen?.reason).toBe('nothingToStrike');
    expect(menAcross(sim)).toEqual([]);
    expect(shipsHomeEmpty(sim)).toBe(true);
  });

  it.each([
    ['a clear headquarters', false],
    ['a headquarters a tower covers', true],
  ])('sails no landing on %s of a rival whose army it never saw, knowing no other', (_, covered) => {
    const { sim } = landingWorld({
      fog: FOG_MODE.CLASSIC_FOG_OF_WAR,
      armed: true,
      seats: STORM_SHIP_SEATS,
      foe: covered ? [{ buildingType: TOWER_TYPE, at: FOE_TOWER }] : [],
    });
    runUntil(sim, DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS, () => {
      expect(landings(sim)).toEqual([]);
      return false;
    });
  });

  it('raids a rival colony with a band sized to it while too few ships lie free for his headquarters, and comes home', () => {
    const ships = LANDING_BIG_SHIPS - 1;
    const { sim } = landingWorld({ ships, colony: true, foe: [{ buildingType: FARM_TYPE, at: FOE_FARM }] });
    const terrain = terrainOf(sim);
    const colonyLand = terrain.componentOf(terrain.nodeAtClamped(FOE_FARM.x, FOE_FARM.y));
    const struck = strikeInTurn(sim, [FOE_FARM]);
    const target = struck.seen?.target;
    expect(
      target === undefined ? null : terrain.componentOf(terrain.nodeAtClamped(target.hx, target.hy)),
    ).toBe(colonyLand);
    expect(struck.seen?.landing?.startMen).toBe(COLONY_RAID_LEAST_MEN);
    // The band strikes the farm, and with nothing left there comes home.
    expect(struck.order).toEqual([FOE_FARM]);
    expect(struck.seen?.reason).toBe('nothingToStrike');
    expect(menOf(sim, SEAT, colonyLand)).toEqual([]);
    expect(shipsHomeEmpty(sim)).toBe(true);
  });

  it("raids a rival colony while every shore of his headquarters' land lies under his towers' fire", () => {
    const { sim } = landingWorld({
      armed: true,
      seats: STORM_SHIP_SEATS,
      colony: true,
      foe: [
        ...COAST_TOWERS.map((at) => ({ buildingType: TOWER_TYPE, at })),
        { buildingType: FARM_TYPE, at: FOE_FARM },
      ],
    });
    const terrain = terrainOf(sim);
    const colonyLand = terrain.componentOf(terrain.nodeAtClamped(FOE_FARM.x, FOE_FARM.y));
    let seen: OperationView | undefined;
    runUntil(sim, DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS, () => {
      seen = landings(sim)[0] ?? seen;
      return seen !== undefined;
    });
    const target = seen?.target;
    expect(
      target === undefined ? null : terrain.componentOf(terrain.nodeAtClamped(target.hx, target.hy)),
    ).toBe(colonyLand);
  });

  it('sizes a colony raid on the most it ever saw of the garrison there, out of sight now', () => {
    const { sim } = landingWorld({
      ships: LANDING_BIG_SHIPS - 1,
      seats: STORM_SHIP_SEATS,
      colony: true,
      foe: [{ buildingType: FARM_TYPE, at: FOE_FARM }],
    });
    const terrain = terrainOf(sim);
    const colonyLand = terrain.componentOf(terrain.nodeAtClamped(FOE_FARM.x, FOE_FARM.y));
    const points = REMEMBERED_GARRISON * manPoints(sim);
    rememberFoeArmy(sim, { most: points, lands: [{ land: colonyLand, points }] });
    let seen: OperationView | undefined;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      seen = landings(sim)[0] ?? seen;
      return (seen?.landing?.landed ?? 0) > 0;
    });
    // The fewest men set ashore that outweigh the remembered garrison half again, every man weighing the
    // same and each ship's helm staying aboard.
    const ashore = Math.ceil((REMEMBERED_GARRISON * LANDING_EDGE.num) / LANDING_EDGE.den);
    expect(ashore).toBeGreaterThan(COLONY_RAID_LEAST_MEN);
    expect(seen?.landing?.landed).toBe(ashore);
    expect(seen?.landing?.startMen).toBe(ashore + (seen?.landing?.startShips ?? 0));
  });

  it('storms a covered colony on the men it sets ashore, the tower first, and sails home once all fell', () => {
    const { sim } = landingWorld({
      ships: LANDING_BIG_SHIPS - 1,
      armed: true,
      seats: STORM_SHIP_SEATS,
      colony: true,
      foe: [
        { buildingType: FARM_TYPE, at: FOE_FARM },
        { buildingType: TOWER_TYPE, at: COLONY_TOWER },
      ],
    });
    const struck = strikeInTurn(sim, [COLONY_TOWER, FOE_FARM]);
    expect(struck.order).toEqual([COLONY_TOWER, FOE_FARM]);
    expect(struck.seen?.reason).toBe('nothingToStrike');
    expect(shipsHomeEmpty(sim)).toBe(true);
  });

  it("weighs a rival's start land as his army once it believes his headquarters fell", () => {
    const { sim } = landingWorld({
      fog: FOG_MODE.CLASSIC_FOG_OF_WAR,
      ships: LANDING_BIG_SHIPS - 1,
      // Seats enough for the least raid beside the ship a sea scout takes.
      seats: STORM_SHIP_SEATS,
      colony: true,
      foe: [
        { buildingType: FARM_TYPE, at: FOE_HOME_FARM },
        { buildingType: HQ_TYPE, at: FOE_FARM, owner: SECOND_FOE },
      ],
    });
    const hq = foeHeadquarters(sim);
    const carrier = aiControlEntity(sim.world, SEAT);
    if (hq === null || carrier === null) throw new Error('setup: no foe headquarters or AI seat');
    // His army, seen long ago, outweighs the seat's whole army; the seat believes his headquarters fell.
    rememberFoeArmy(sim, { most: OUTMATCHING_FOES * manPoints(sim), faded: true });
    const intel = sim.world.mut(carrier, ComputerIntel);
    intel.buildings = intel.buildings.filter((b) => b.entity !== hq);
    runUntil(sim, DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS, () => {
      expect(landings(sim)).toEqual([]);
      return false;
    });
    // The seat would land: its posture attacks the second rival.
    expect(militaryOrdersOf(sim.world, SEAT).launchRatio).not.toBeNull();
  });

  it.each([
    ['', 0],
    [' beside its garrison', GARRISON],
  ])(
    'rescues its colony%s with men ashore that outweigh the band, beats it and sails home',
    (_, garrison) => {
      const { sim } = landingWorld({ colony: true, armed: true });
      const terrain = terrainOf(sim);
      const colonyLand = terrain.componentOf(terrain.nodeAtClamped(FOE_FARM.x, FOE_FARM.y));
      const carrier = aiControlEntity(sim.world, SEAT);
      if (carrier === null) throw new Error('setup: no AI seat');
      // The colony's garrison saw the band land, as its own defence notes it.
      const threat = { men: RAIDERS, at: { hx: FOE_FARM.x, hy: FOE_FARM.y }, since: sim.tick };
      const colony = blankColony(colonyLand, { threat });
      sim.world.add(carrier, ComputerColony, { colonies: [colony], rejected: [], retryAt: 0 });
      spawnBand(sim, RAIDERS, FOE_FARM, GUARD_RANK, FOE);
      spawnBand(sim, garrison, GARRISON_POST, GUARD_RANK, SEAT);
      let seen: OperationView | undefined;
      let joined = false;
      runUntil(sim, LANDING_LIMIT_TICKS, () => {
        seen = rescues(sim)[0] ?? seen;
        // The garrison, posted out of the band's reach, comes up beside the rescue as it lands.
        if (!joined && (seen?.landing?.landed ?? 0) > 0) {
          joined = true;
          const posted = menOf(sim, SEAT, colonyLand).filter((e) => !seen?.members.includes(e));
          for (const e of posted) sim.world.destroy(e);
          spawnBand(sim, posted.length, { x: FOE_FARM.x, y: FOE_FARM.y + GUARD_OFFSET }, GUARD_RANK, SEAT);
        }
        return seen?.state === 'done' && shipsHomeEmpty(sim);
      });
      const target = seen?.target;
      expect(
        target === undefined ? null : terrain.componentOf(terrain.nodeAtClamped(target.hx, target.hy)),
      ).toBe(colonyLand);
      // Every man weighs the same: the fewest set ashore that, with the garrison, outweigh the band by the
      // landing's edge.
      const ashore = Math.max(0, Math.ceil((RAIDERS * LANDING_EDGE.num) / LANDING_EDGE.den) - garrison);
      expect(seen?.landing?.landed).toBe(ashore);
      expect(seen?.reason).toBe('nothingToStrike');
      expect(menOf(sim, FOE, colonyLand)).toEqual([]);
      expect(menOf(sim, SEAT, colonyLand).length).toBeLessThanOrEqual(garrison);
    },
  );

  it('takes its rescue back aboard once its stay at the colony runs out with the band still there', () => {
    // Bare men fell nobody, so the band outlasts the stay.
    const { sim } = landingWorld({ colony: true });
    const terrain = terrainOf(sim);
    const colonyLand = terrain.componentOf(terrain.nodeAtClamped(FOE_FARM.x, FOE_FARM.y));
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI seat');
    const threat = { men: RAIDERS, at: { hx: FOE_FARM.x, hy: FOE_FARM.y }, since: sim.tick };
    sim.world.add(carrier, ComputerColony, {
      colonies: [blankColony(colonyLand, { threat })],
      rejected: [],
      retryAt: 0,
    });
    spawnBand(sim, RAIDERS, FOE_FARM, GUARD_RANK, FOE);
    let seen: OperationView | undefined;
    runUntil(sim, LANDING_LIMIT_TICKS + LANDING_SHORE_STAY_TICKS, () => {
      seen = rescues(sim)[0] ?? seen;
      return seen?.state === 'done' && shipsHomeEmpty(sim);
    });
    expect(seen?.landing?.landed).toBeGreaterThan(0);
    expect(seen?.reason).toBe('timedOut');
    expect(menOf(sim, FOE, colonyLand).length).toBe(RAIDERS);
    expect(menOf(sim, SEAT, colonyLand)).toEqual([]);
  });

  it('rescues its colony while its posture holds the army home, and raids nothing', () => {
    const { sim } = landingWorld({ colony: true, foe: [{ buildingType: FARM_TYPE, at: FOE_FARM }] });
    const terrain = terrainOf(sim);
    const colonyLand = terrain.componentOf(terrain.nodeAtClamped(FOE_FARM.x, FOE_FARM.y));
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI seat');
    // A foe army far stronger than the seat's, beyond his headquarters from the colony, keeps the seat
    // defending at home.
    spawnBand(sim, OUTMATCHING_FOES, FOE_ARMY, GUARD_RANK, FOE);
    let seen: OperationView | undefined;
    runUntil(sim, DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS, () => {
      seen = landings(sim)[0] ?? seen;
      return seen !== undefined;
    });
    // Holding home, the seat raids no colony of the foe's.
    expect(seen).toBeUndefined();
    expect(militaryOrdersOf(sim.world, SEAT).launchRatio).toBeNull();
    const threat = { men: RAIDERS, at: { hx: FOE_FARM.x, hy: FOE_FARM.y }, since: sim.tick };
    sim.world.add(carrier, ComputerColony, {
      colonies: [blankColony(colonyLand, { threat })],
      rejected: [],
      retryAt: 0,
    });
    spawnBand(sim, RAIDERS, FOE_FARM, GUARD_RANK, FOE);
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      seen = rescues(sim)[0] ?? seen;
      return (seen?.landing?.landed ?? 0) > 0;
    });
    expect(seen?.kind).toBe('rescue');
    expect(seen?.landing?.landed).toBeGreaterThan(0);
  });

  it('crews a rescue and a landing that open on one decision with ships and men of their own', () => {
    const { sim, fleet } = landingWorld({ colony: true, armed: true, ships: 0 });
    const terrain = terrainOf(sim);
    const colonyLand = terrain.componentOf(terrain.nodeAtClamped(FOE_FARM.x, FOE_FARM.y));
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI seat');
    launchShips(sim, fleet + RESCUE_SHIPS);
    spawnBand(sim, RESCUE_SHIPS * MEN_PER_SHIP, { x: BARRACKS.x - 6, y: BARRACKS.y - 8 }, ARMY_RANK, SEAT);
    // The band lands on the colony just before the decision the landing opens on.
    runUntil(sim, BOTH_OPEN_AT, () => sim.tick >= BOTH_OPEN_AT);
    const threat = { men: RAIDERS, at: { hx: FOE_FARM.x, hy: FOE_FARM.y }, since: sim.tick };
    sim.world.add(carrier, ComputerColony, {
      colonies: [blankColony(colonyLand, { threat })],
      rejected: [],
      retryAt: 0,
    });
    spawnBand(sim, RAIDERS, FOE_FARM, GUARD_RANK, FOE);
    let attack: OperationView | undefined;
    let rescue: OperationView | undefined;
    runUntil(sim, DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS, () => {
      attack = landings(sim)[0] ?? attack;
      rescue = rescues(sim)[0] ?? rescue;
      return attack !== undefined || rescue !== undefined;
    });
    if (attack === undefined || rescue === undefined) throw new Error('both must open on one decision');
    expect(attack.since).toBe(rescue.since);
    const rescueShips = new Set(rescue.landing?.ships.map((ship) => ship.vehicle));
    expect(attack.landing?.ships.filter((ship) => rescueShips.has(ship.vehicle))).toEqual([]);
    expect(attack.members.filter((e) => rescue?.members.includes(e))).toEqual([]);
  });

  it.each([
    ['by the colony', true],
    ['far off on its land', false],
  ])('rescues its colony from an enemy ship moored %s only within its watch', (_, near) => {
    // The house bow gives the colony's buildings their watch, and the seats carry men enough to outweigh
    // the load the seat reckons the ship still holds.
    const { sim } = landingWorld({ colony: true, armed: true, shelterFire: true, seats: STORM_SHIP_SEATS });
    const terrain = terrainOf(sim);
    const colonyLand = terrain.componentOf(terrain.nodeAtClamped(COLONY_STORE.x, COLONY_STORE.y));
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI seat');
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: FARM_TYPE,
      ...COLONY_STORE,
      tribe: VIKING,
      owner: SEAT,
      force: true,
      underConstruction: false,
    });
    sim.step();
    // No band noted by the colony's garrison: the ship and the men off it are all the seat sees.
    sim.world.add(carrier, ComputerColony, { colonies: [blankColony(colonyLand)], rejected: [], retryAt: 0 });
    const berth = near ? NEAR_BERTH : FAR_BERTH;
    createVehicle(sim.world, ctxOf(sim), { vehicleType: SHIP, ...berth.water, tribe: VIKING, owner: FOE });
    spawnBand(sim, RAIDERS, berth.landed, GUARD_RANK, FOE);
    let seen: OperationView | undefined;
    runUntil(sim, DECISIONS_TO_OPEN * COMPUTER_DECISION_INTERVAL_TICKS, () => {
      seen = rescues(sim)[0] ?? seen;
      return seen !== undefined;
    });
    expect(seen !== undefined).toBe(near);
  });

  it('rescues its colony while a landing of its own is out at the rival, on ships left free', () => {
    const { sim, fleet } = landingWorld({ colony: true, armed: true, ships: 0 });
    const terrain = terrainOf(sim);
    const colonyLand = terrain.componentOf(terrain.nodeAtClamped(FOE_FARM.x, FOE_FARM.y));
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI seat');
    // Ships beyond the landing fleet lie free at home once the landing has taken its own.
    launchShips(sim, fleet + RESCUE_SHIPS);
    spawnBand(sim, RESCUE_SHIPS * MEN_PER_SHIP, { x: BARRACKS.x - 6, y: BARRACKS.y - 8 }, ARMY_RANK, SEAT);
    let attack: OperationView | undefined;
    let rescue: OperationView | undefined;
    let raided = false;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      attack = landings(sim)[0] ?? attack;
      rescue = rescues(sim)[0] ?? rescue;
      if (!raided && attack?.state === 'moving') {
        raided = true;
        const threat = { men: RAIDERS, at: { hx: FOE_FARM.x, hy: FOE_FARM.y }, since: sim.tick };
        sim.world.add(carrier, ComputerColony, {
          colonies: [blankColony(colonyLand, { threat })],
          rejected: [],
          retryAt: 0,
        });
        spawnBand(sim, RAIDERS, FOE_FARM, GUARD_RANK, FOE);
      }
      return rescue !== undefined;
    });
    expect(raided).toBe(true);
    expect(rescue?.landing?.startShips).toBeGreaterThan(0);
    expect(attack?.state).not.toBe('done');
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

  it('sails on and lands when its posture turns to defence against a far army while the fleet is out', () => {
    const { sim } = landingWorld();
    let seen: OperationView | undefined;
    let mustered = false;
    let defending = false;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      seen = landings(sim)[0] ?? seen;
      if (!mustered && seen?.state === 'moving') {
        mustered = true;
        spawnBand(sim, OUTMATCHING_FOES, FOE_ARMY, GUARD_RANK, FOE);
      }
      if (mustered && militaryOrdersOf(sim.world, SEAT).launchRatio === null) defending = true;
      return (seen?.landing?.landed ?? 0) > 0 || seen?.state === 'withdrawing' || seen?.state === 'done';
    });
    expect(defending).toBe(true);
    expect(seen?.reason).toBeNull();
    expect(seen?.landing?.landed).toBeGreaterThan(0);
  });

  it('turns the fleet home without landing once a band raids home', () => {
    const { sim } = landingWorld();
    let seen: OperationView | undefined;
    let raided = false;
    runUntil(sim, LANDING_LIMIT_TICKS, () => {
      seen = landings(sim)[0] ?? seen;
      if (seen?.state === 'done') return shipsHomeEmpty(sim);
      if (!raided && seen?.state === 'moving') {
        raided = true;
        spawnBand(sim, RAIDERS, { x: SEAT_HQ.x + GUARD_OFFSET, y: SEAT_HQ.y }, GUARD_RANK, FOE);
      }
      return false;
    });
    expect(raided).toBe(true);
    expect(seen?.reason).toBe('defenceMode');
    expect(seen?.landing?.landed).toBe(0);
    expect(menAcross(sim)).toEqual([]);
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
