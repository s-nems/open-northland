import {
  cellAnchorNode,
  components,
  type Entity,
  type MissionScript,
  type Simulation,
  SUCCESSFUL_IF,
  setupCommand,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_ARCHER, JOB_SOLDIER_SWORD, JOB_SOLDIER_UNARMED } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import { weaponEquipmentFor } from '../game/sandbox/ids/index.js';
import {
  BUILDING_BARRACKS,
  BUILDING_HEADQUARTERS,
  BUILDING_WATCHTOWER,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_CATAPULT,
  WEAPON_SWORD,
} from '../game/sandbox/index.js';
import type { SceneCheck, SceneDefinition } from './types.js';

// The red AI seat sends its first wave across the map: four catapults, the fewest that make a siege
// march, take the four bare-handed men as drivers, the wave marches east in legs with the catapults in
// front, and at the blue settlement the catapults and archers break the watchtower while the swordsmen
// wait, then everybody goes in on the HQ.
// The charge variant sends a blue band down the wave's path, big enough that the wave charges it once the
// band walks into it through the catapults' stones.

const MAP_W = 96;
const MAP_H = 36;

type Tile = readonly [number, number];

const BARRACKS = { x: 14, y: 18 } as const;
/** Inside the park band of the barracks door, so all four join the launching wave. */
const CATAPULTS: readonly Tile[] = [
  [18, 13],
  [18, 23],
  [21, 16],
  [21, 20],
];
/** One bare-handed man beside each catapult: the least kitted-out men are the ones drafted to drive. */
const DRIVERS: readonly Tile[] = [
  [16, 11],
  [16, 25],
  [23, 14],
  [23, 22],
];
/** West of the barracks, behind it from the objective: the men walk in to the door while the drivers
 *  board, so the catapults are crewed when the wave forms up. */
const SWORD_ROWS = [15, 17, 19, 21];
const SWORD_COLUMNS = [3, 4];
/** The charge variant's second band, so the red army still outweighs the blue one the wave meets. */
const RESERVE_SWORD_COLUMNS = [1, 2];
const ARCHER_STARTS: readonly Tile[] = [
  [6, 16],
  [6, 18],
  [6, 20],
];

/** 60 cells east of the barracks: a march of several legs. */
const TOWER = { x: 74, y: 18 } as const;
const HEADQUARTERS = { x: 86, y: 18 } as const;
const TOWER_ARCHER_STARTS: readonly Tile[] = [
  [77, 15],
  [77, 18],
  [77, 21],
];
/** Off to the side of the HQ and fewer than the charge floor, so the wave marches past them. */
const GUARD_STARTS: readonly Tile[] = [
  [88, 30],
  [89, 31],
  [90, 30],
];
/** Across the route halfway over: one man over the wave's charge floor (`CHARGE_MIN_ENEMIES`). */
const MIDFIELD_BAND: readonly Tile[] = [
  [46, 16],
  [46, 18],
  [46, 20],
  [47, 17],
  [47, 19],
  [48, 18],
];

/** Twice a swordsman's: tough enough to outlast the catapults' opening stones, so the band walks into the
 *  wave and it charges before they fall. */
const MIDFIELD_HITPOINTS = 10_000;

/** When the midfield band sets out on the red barracks: the wave is a leg or two out by then, so they meet
 *  halfway rather than at the door. */
const BAND_SETS_OUT_TICK = 600;

/** The scene's scripted orders take the last positions of their tick, counting down, after any player's. */
const SCRIPTED_SEQUENCE = Number.MAX_SAFE_INTEGER;

/** Between the barracks and the first leg, so the browser opens on the boarding and the launch. */
const CAMERA_AT = { hx: 40, hy: 36 } as const;

/** Past the HQ's fall: the boarding, the march, the tower and the assault. Short of the catapults' drive
 *  home once the wave is spent, which the check on how far they went in reads at the end. */
const RUN_TICKS = 3500;

/** Past the tower's fall: the charge costs the wave its time and some men. */
const CHARGE_RUN_TICKS = 5400;

const { Building, isAboardVehicle, Owner, Settler, Vehicle, vehicleCommander } = components;

interface SiegeSetup {
  readonly reserve: boolean;
  /** The blue men standing in the field beside the HQ. */
  readonly blueField: readonly Tile[];
  /** The band that sets out on the red barracks at {@link BAND_SETS_OUT_TICK}, instead of the field. */
  readonly band?: { readonly at: readonly Tile[]; readonly hitpoints: number };
}

function buildWith({ reserve, blueField, band }: SiegeSetup): (sim: Simulation) => void {
  return (sim) => {
    placeBuiltSandboxBuilding(sim, BUILDING_BARRACKS, BARRACKS.x, BARRACKS.y, ENEMY_PLAYER);
    for (const [x, y] of CATAPULTS) spawnVehicleDirect(sim, VEHICLE_CATAPULT, x, y, { owner: ENEMY_PLAYER });
    for (const [x, y] of DRIVERS) spawnSandboxSettler(sim, JOB_SOLDIER_UNARMED, x, y, ENEMY_PLAYER);
    const columns = reserve ? [...RESERVE_SWORD_COLUMNS, ...SWORD_COLUMNS] : SWORD_COLUMNS;
    for (const x of columns) {
      for (const y of SWORD_ROWS) swordsman(sim, x, y, ENEMY_PLAYER);
    }
    for (const [x, y] of ARCHER_STARTS) spawnSandboxSettler(sim, JOB_ARCHER, x, y, ENEMY_PLAYER);

    const tower = placeBuiltSandboxBuilding(sim, BUILDING_WATCHTOWER, TOWER.x, TOWER.y, HUMAN_PLAYER);
    placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HEADQUARTERS.x, HEADQUARTERS.y, HUMAN_PLAYER);
    for (const [x, y] of TOWER_ARCHER_STARTS) {
      const archer = spawnSettlerDirect(sim, JOB_ARCHER, x, y, HUMAN_PLAYER);
      sim.enqueueSetup({ kind: 'assignWorker', entity: archer, building: tower, jobPriority: [JOB_ARCHER] });
    }
    for (const [x, y] of blueField) swordsman(sim, x, y, HUMAN_PLAYER);
    if (band !== undefined) sendBand(sim, band);

    // Only the military module, and no peace: the wave launches as soon as it has formed up.
    sim.enqueueSetup({
      kind: 'setPlayerAi',
      player: ENEMY_PLAYER,
      enabled: true,
      modules: {
        collectResources: false,
        guideBuild: false,
        homeExpansion: false,
        houseBuild: false,
        houseUpgrade: false,
        military: true,
        roadBuild: false,
      },
    });
  };
}

function swordsman(sim: Simulation, x: number, y: number, owner: number): void {
  spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, y, owner, { weaponTypeId: WEAPON_SWORD });
}

/** The blue band, set out on an attack-move to the red barracks door at {@link BAND_SETS_OUT_TICK}. */
function sendBand(sim: Simulation, band: NonNullable<SiegeSetup['band']>): void {
  const door = cellAnchorNode(BARRACKS.x, BARRACKS.y);
  for (const [i, [x, y]] of band.at.entries()) {
    const entity = bandSwordsman(sim, x, y, band.hitpoints);
    const order = setupCommand({ kind: 'attackMoveUnit', entity, x: door.hx, y: door.hy });
    sim.enqueueAt(order, BAND_SETS_OUT_TICK, SCRIPTED_SEQUENCE - i);
  }
}

/** A blue swordsman spawned directly, so the scene can order him. */
function bandSwordsman(sim: Simulation, x: number, y: number, hitpoints: number): Entity {
  const node = cellAnchorNode(x, y);
  const equipment = weaponEquipmentFor(JOB_SOLDIER_SWORD, sim.content.goods);
  const e = systems.createSettler(sim.world, sim.content, sim.rng, {
    jobType: JOB_SOLDIER_SWORD,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    weaponTypeId: WEAPON_SWORD,
    hitpoints,
    ...(equipment === undefined ? {} : { equipment }),
  });
  if (e === null) throw new Error('ai-siege-charge: no swordsman job');
  return e;
}

function blueBuilding(sim: Simulation, buildingType: number): Entity | undefined {
  return [...sim.world.query(Building, Owner)].find(
    (e) =>
      sim.world.get(e, Owner).player === HUMAN_PLAYER &&
      sim.world.get(e, Building).buildingType === buildingType,
  );
}

/** The blue swordsmen: the midfield band, since the tower holds archers only. */
function blueSwords(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler, Owner)].filter(
    (e) =>
      sim.world.get(e, Owner).player === HUMAN_PLAYER &&
      sim.world.get(e, Settler).jobType === JOB_SOLDIER_SWORD,
  );
}

/** Every red catapult is driven by one of the bare-handed men, the least kitted-out and so drafted first. */
function catapultsCrewed(sim: Simulation): boolean {
  const catapults = sim.vehiclesOf(ENEMY_PLAYER).filter((v) => v.vehicleType === VEHICLE_CATAPULT);
  return (
    catapults.length === CATAPULTS.length &&
    catapults.every(({ entity }) => {
      const driver = vehicleCommander(sim.world.get(entity, Vehicle));
      return (
        driver !== null &&
        isAboardVehicle(sim.world, driver) &&
        sim.world.tryGet(driver, Settler)?.jobType === JOB_SOLDIER_UNARMED
      );
    })
  );
}

/** Some red catapult stands past the tower's site: it drove the march and went in. */
function catapultWentIn(sim: Simulation): boolean {
  const towerSite = cellAnchorNode(TOWER.x, TOWER.y).hx;
  return sim
    .vehiclesOf(ENEMY_PLAYER)
    .some((v) => v.vehicleType === VEHICLE_CATAPULT && v.at !== null && v.at.hx >= towerSite);
}

const CREWED_CHECK: SceneCheck = {
  label: 'every catapult is driven by a bare-handed man',
  predicate: catapultsCrewed,
};
const TOWER_CHECK: SceneCheck = {
  label: 'the watchtower fell',
  predicate: (sim) => blueBuilding(sim, BUILDING_WATCHTOWER) === undefined,
};

const CAMERA_SCRIPT: MissionScript = {
  missions: [
    {
      active: true,
      visible: false,
      successfullIf: SUCCESSFUL_IF.all,
      goals: [],
      results: [{ opcode: 'SetCameraPosition', point: CAMERA_AT }],
    },
  ],
};

export const aiSiegeMarchScene: SceneDefinition = {
  id: 'ai-siege-march',
  seed: 7,
  terrain: grassTerrain(MAP_W, MAP_H),
  build: buildWith({ reserve: false, blueField: GUARD_STARTS }),
  missions: CAMERA_SCRIPT,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    CREWED_CHECK,
    TOWER_CHECK,
    { label: 'a catapult went in past the tower', predicate: catapultWentIn },
    {
      label: 'the wave razed the headquarters',
      predicate: (sim) => blueBuilding(sim, BUILDING_HEADQUARTERS) === undefined,
    },
  ],
};

/** A seed whose opening wave draw sends the whole army out, so the wave outweighs the band it meets. */
const CHARGE_SEED = 3;

export const aiSiegeChargeScene: SceneDefinition = {
  id: 'ai-siege-charge',
  seed: CHARGE_SEED,
  terrain: grassTerrain(MAP_W, MAP_H),
  build: buildWith({
    reserve: true,
    blueField: [],
    band: { at: MIDFIELD_BAND, hitpoints: MIDFIELD_HITPOINTS },
  }),
  missions: CAMERA_SCRIPT,
  runTicks: CHARGE_RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    CREWED_CHECK,
    { label: 'the band in its path was cut down', predicate: (sim) => blueSwords(sim).length === 0 },
    TOWER_CHECK,
  ],
};
