import {
  cellAnchorNode,
  components,
  type Entity,
  type MissionScript,
  type Simulation,
  SUCCESSFUL_IF,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_ARCHER, JOB_SOLDIER_SWORD, JOB_SOLDIER_UNARMED } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
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
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

// The red AI seat sends its first wave across the map: four catapults, the fewest that make a siege
// march, take the four bare-handed men as drivers, and the wave walks to a gathering point short of the
// blue base. Once most of the men stand there they go in on the HQ as one attack-move without waiting for
// the slower catapults, which come up behind, break the watchtower beside the base and then drive in on
// the HQ themselves.
// The band variant stands a blue band across the route: the catapults at home shell it and so stay behind
// as the settlement's defence, the men's attack-move to the gathering point runs into it and cuts it down,
// and they go on to gather and take the HQ.

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
 *  board, so the catapults are crewed when the wave launches. */
const SWORD_ROWS = [15, 17, 19, 21];
const SWORD_COLUMNS = [3, 4];
const ARCHER_STARTS: readonly Tile[] = [
  [6, 16],
  [6, 18],
  [6, 20],
];

const HEADQUARTERS = { x: 86, y: 18 } as const;
/** North of the HQ, off the men's way in but within the siege radius around it, so the catapults go for
 *  it while the men are busy at the HQ. */
const TOWER = { x: 88, y: 3 } as const;
const TOWER_ARCHER_STARTS: readonly Tile[] = [
  [90, 2],
  [90, 4],
  [91, 3],
];

/** Twenty times the HQ's own: the men are still breaking it when the catapults have come up and broken
 *  the tower, so the scene shows the catapults go in on the HQ after it. */
const SIEGE_HEADQUARTERS_HITPOINTS = 2_000_000;

/** Across the route a third of the way over, where the wave walks to its gathering point. */
const ROUTE_BAND: readonly Tile[] = [
  [40, 16],
  [40, 18],
  [40, 20],
  [41, 17],
  [41, 19],
  [42, 18],
];

/** Between the barracks and the gathering point, so the browser opens on the boarding and the launch. */
const CAMERA_AT = { hx: 40, hy: 36 } as const;

/** A catapult this near the HQ's site (Manhattan half-cell nodes) has driven in on it: nearer than the
 *  gathering point, which stands 40 nodes short of the objective, and than where it stood on the tower. */
const AT_HEADQUARTERS_NODES = 32;

/** The tower has fallen to the catapults and every catapult fires at the HQ the men are still breaking.
 *  Measured: every check holds from tick 3245 to 3685. */
const RUN_TICKS = 3500;

/** Past the HQ's fall. Measured: every check holds from tick 1679 through at least 6000. */
const BAND_RUN_TICKS = 2400;

const { Building, Health, isAboardVehicle, Owner, Settler, Vehicle, vehicleCommander } = components;

interface SiegeSetup {
  /** Overrides the HQ's hitpoints, so it outlasts the men's first blows. */
  readonly headquartersHitpoints?: number;
  /** Blue swordsmen standing across the route. */
  readonly band?: readonly Tile[];
}

function buildWith({ headquartersHitpoints, band = [] }: SiegeSetup): (sim: Simulation) => void {
  return (sim) => {
    placeBuiltSandboxBuilding(sim, BUILDING_BARRACKS, BARRACKS.x, BARRACKS.y, ENEMY_PLAYER);
    for (const [x, y] of CATAPULTS) spawnVehicleDirect(sim, VEHICLE_CATAPULT, x, y, { owner: ENEMY_PLAYER });
    for (const [x, y] of DRIVERS) spawnSandboxSettler(sim, JOB_SOLDIER_UNARMED, x, y, ENEMY_PLAYER);
    for (const x of SWORD_COLUMNS) {
      for (const y of SWORD_ROWS) swordsman(sim, x, y, ENEMY_PLAYER);
    }
    for (const [x, y] of ARCHER_STARTS) spawnSandboxSettler(sim, JOB_ARCHER, x, y, ENEMY_PLAYER);

    const tower = placeBuiltSandboxBuilding(sim, BUILDING_WATCHTOWER, TOWER.x, TOWER.y, HUMAN_PLAYER);
    const hq = placeBuiltSandboxBuilding(
      sim,
      BUILDING_HEADQUARTERS,
      HEADQUARTERS.x,
      HEADQUARTERS.y,
      HUMAN_PLAYER,
    );
    if (headquartersHitpoints !== undefined) {
      const health = sim.world.mut(hq, Health);
      health.hitpoints = headquartersHitpoints;
      health.max = headquartersHitpoints;
    }
    for (const [x, y] of TOWER_ARCHER_STARTS) {
      const archer = spawnSettlerDirect(sim, JOB_ARCHER, x, y, HUMAN_PLAYER);
      sim.enqueueSetup({ kind: 'assignWorker', entity: archer, building: tower, jobPriority: [JOB_ARCHER] });
    }
    for (const [x, y] of band) swordsman(sim, x, y, HUMAN_PLAYER);

    // Only the military module, and no peace: the wave launches as soon as it is worth sending.
    sim.enqueueSetup({
      kind: 'setAiControl',
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

function blueBuilding(sim: Simulation, buildingType: number): Entity | undefined {
  return [...sim.world.query(Building, Owner)].find(
    (e) =>
      sim.world.get(e, Owner).player === HUMAN_PLAYER &&
      sim.world.get(e, Building).buildingType === buildingType,
  );
}

/** The blue swordsmen: the band, since the tower holds archers only. */
function blueSwords(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler, Owner)].filter(
    (e) =>
      sim.world.get(e, Owner).player === HUMAN_PLAYER &&
      sim.world.get(e, Settler).jobType === JOB_SOLDIER_SWORD,
  );
}

function redCatapults(sim: Simulation) {
  return sim.vehiclesOf(ENEMY_PLAYER).filter((v) => v.vehicleType === VEHICLE_CATAPULT);
}

/** Every red catapult is driven by one of the bare-handed men, the least kitted-out and so drafted first. */
function catapultsCrewed(sim: Simulation): boolean {
  const catapults = redCatapults(sim);
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

/** Every red catapult has driven up to the standing HQ and fires at it. */
function catapultsOnHeadquarters(sim: Simulation): boolean {
  const hq = blueBuilding(sim, BUILDING_HEADQUARTERS);
  if (hq === undefined) return false;
  const site = cellAnchorNode(HEADQUARTERS.x, HEADQUARTERS.y);
  return redCatapults(sim).every(({ at, attackTarget }) => {
    if (at === null || attackTarget?.kind !== 'entity' || attackTarget.entity !== hq) return false;
    return Math.abs(at.hx - site.hx) + Math.abs(at.hy - site.hy) <= AT_HEADQUARTERS_NODES;
  });
}

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
  build: buildWith({ headquartersHitpoints: SIEGE_HEADQUARTERS_HITPOINTS }),
  missions: CAMERA_SCRIPT,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    { label: 'every catapult is driven by a bare-handed man', predicate: catapultsCrewed },
    {
      label: 'the watchtower fell',
      predicate: (sim) => blueBuilding(sim, BUILDING_WATCHTOWER) === undefined,
    },
    { label: 'every catapult drove in on the headquarters', predicate: catapultsOnHeadquarters },
  ],
};

export const aiSiegeBandScene: SceneDefinition = {
  id: 'ai-siege-band',
  seed: 7,
  terrain: grassTerrain(MAP_W, MAP_H),
  build: buildWith({ band: ROUTE_BAND }),
  missions: CAMERA_SCRIPT,
  runTicks: BAND_RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    { label: 'the band across the route was cut down', predicate: (sim) => blueSwords(sim).length === 0 },
    {
      label: 'the wave razed the headquarters',
      predicate: (sim) => blueBuilding(sim, BUILDING_HEADQUARTERS) === undefined,
    },
  ],
};
