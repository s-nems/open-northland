import {
  cellAnchorNode,
  components,
  type Entity,
  type MissionScript,
  type Simulation,
  SUCCESSFUL_IF,
} from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_ARCHER, JOB_SOLDIER_SWORD, JOB_SOLDIER_UNARMED } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
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

// The red AI seat sends its first wave across the map: two catapults take the two bare-handed men as
// drivers, the wave marches east in legs with the catapults in front, and at the blue settlement the
// catapults and archers break the watchtower while the swordsmen wait, then everybody goes in on the HQ.
// The charge variant stands a blue band in the wave's path, big enough that the wave charges it.

const MAP_W = 96;
const MAP_H = 36;

type Tile = readonly [number, number];

const BARRACKS = { x: 14, y: 18 } as const;
/** Inside the park band of the barracks door, so both join the launching wave. */
const CATAPULTS: readonly Tile[] = [
  [18, 13],
  [18, 23],
];
/** One bare-handed man beside each catapult: the least kitted-out men are the ones drafted to drive. */
const DRIVERS: readonly Tile[] = [
  [16, 11],
  [16, 25],
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

/** Four times a swordsman's: tough enough to outlast the catapults' opening stones, so the wave closes in
 *  and charges before they fall. */
const MIDFIELD_HITPOINTS = 20_000;

/** Between the barracks and the first leg, so the browser opens on the boarding and the launch. */
const CAMERA_AT = { hx: 40, hy: 36 } as const;

/** Past the HQ's fall: the boarding, the march, the tower and the assault. */
const RUN_TICKS = 4500;

const { Building, isAboardVehicle, Owner, Settler, Vehicle, vehicleCommander } = components;

interface SiegeSetup {
  readonly reserve: boolean;
  /** The blue men standing in the field: the HQ guards, or the band the wave charges. */
  readonly blueField: readonly Tile[];
  readonly blueFieldHitpoints?: number;
}

function buildWith({ reserve, blueField, blueFieldHitpoints }: SiegeSetup): (sim: Simulation) => void {
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
    for (const [x, y] of blueField) swordsman(sim, x, y, HUMAN_PLAYER, blueFieldHitpoints);

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

function swordsman(sim: Simulation, x: number, y: number, owner: number, hitpoints?: number): void {
  spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, y, owner, {
    weaponTypeId: WEAPON_SWORD,
    ...(hitpoints === undefined ? {} : { hitpoints }),
  });
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
  label: 'both catapults are driven by the bare-handed men',
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

export const aiSiegeChargeScene: SceneDefinition = {
  id: 'ai-siege-charge',
  seed: 7,
  terrain: grassTerrain(MAP_W, MAP_H),
  build: buildWith({ reserve: true, blueField: MIDFIELD_BAND, blueFieldHitpoints: MIDFIELD_HITPOINTS }),
  missions: CAMERA_SCRIPT,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    CREWED_CHECK,
    { label: 'the band in its path was cut down', predicate: (sim) => blueSwords(sim).length === 0 },
    TOWER_CHECK,
  ],
};
