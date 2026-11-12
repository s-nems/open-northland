import {
  cellAnchorNode,
  components,
  type Entity,
  hexDistanceBetween,
  nodeOfPosition,
  playerCommand,
  type Simulation,
  SUCCESSFUL_IF,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_ARCHER, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
import {
  placeBuiltSandboxBuilding,
  spawnSandboxSettlerDirect,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_CATAPULT,
  WEAPON_SHORT_BOW,
  WEAPON_SWORD,
} from '../../game/sandbox/index.js';
import { enemyBuildings, labelledSceneSettler, labelSceneSettler } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

/**
 * What a catapult shoots first: a crewed catapult in its attack stance has an archer inside its band and
 * an enemy tower just past it, while two swordsmen run in and batter its hull. It shoots the archer in
 * its band first, then rolls a few steps up to the tower and razes it; the swordsmen at its side are too
 * close for a stone, and two of them are a crowd it does not try to drive away from.
 */

const MAP_W = 26;
const MAP_H = 20;

const CATAPULT_AT = { x: 6, y: 10 } as const;
/** The commander stands beside the catapult, off its footprint. */
const COMMANDER_AT = { x: 3, y: 10 } as const;
/** A commander this practised never scatters, so every stone lands on its mark. */
const MASTER_CATAPULT_SKILL = 100;
/** A hull the swordsmen cannot break inside the run, so the catapult is still standing to check. */
const TOUGH_HULL_HITPOINTS = 1_000_000;
/** East, just past the far reach but inside the reach a military target draws the catapult from. */
const ENEMY_TOWER: readonly [string, number, number] = ['tower_00', 20, 8];
/** Two stones' worth, so the tower falls inside the run once the archer is down. */
const TOWER_HITPOINTS = 7_000;
/** About 14 map points south-east: inside the band and nearer than the tower. */
const ENEMY_ARCHER_AT = { x: 11, y: 13 } as const;
/** A few cells off the catapult: they reach its hull within seconds. */
const ENEMY_SWORDSMEN: readonly [number, number][] = [
  [9, 8],
  [9, 12],
];
/** Enough to outlast the run while they batter the hull. */
const SWORDSMAN_HITPOINTS = 100_000;
const ARCHER_LABEL = 'archer';
const RUN_TICKS = 450;
/** Between the catapult and the tower, so the browser opens on the whole exchange. */
const CAMERA_AT = { hx: 26, hy: 20 } as const;

const { Health, Position, SettlerProgress } = components;

function build(sim: Simulation): void {
  const catapult = spawnVehicleDirect(sim, VEHICLE_CATAPULT, CATAPULT_AT.x, CATAPULT_AT.y);
  sim.world.mut(catapult, Health).hitpoints = TOUGH_HULL_HITPOINTS;
  sim.world.mut(catapult, Health).max = TOUGH_HULL_HITPOINTS;
  const commander = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, COMMANDER_AT.x, COMMANDER_AT.y);
  sim.world
    .mut(commander, SettlerProgress)
    .experience.set(systems.FIGHT_EXPERIENCE_TYPE.CATAPULT, MASTER_CATAPULT_SKILL);
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: commander, vehicle: catapult }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'setVehicleStance', vehicle: catapult, stance: 'attack' }));
  const tower = placeBuiltSandboxBuilding(sim, ENEMY_TOWER[0], ENEMY_TOWER[1], ENEMY_TOWER[2], ENEMY_PLAYER);
  sim.world.mut(tower, Health).hitpoints = TOWER_HITPOINTS;
  sim.world.mut(tower, Health).max = TOWER_HITPOINTS;
  const archer = spawnSandboxSettlerDirect(
    sim,
    JOB_ARCHER,
    ENEMY_ARCHER_AT.x,
    ENEMY_ARCHER_AT.y,
    ENEMY_PLAYER,
    {
      weaponTypeId: WEAPON_SHORT_BOW,
    },
  );
  labelSceneSettler(sim, ARCHER_LABEL, archer);
  for (const [x, y] of ENEMY_SWORDSMEN) {
    spawnSandboxSettlerDirect(sim, JOB_SOLDIER_SWORD, x, y, ENEMY_PLAYER, {
      weaponTypeId: WEAPON_SWORD,
      hitpoints: SWORDSMAN_HITPOINTS,
    });
  }
}

function ownCatapult(sim: Simulation): Entity | undefined {
  return sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === VEHICLE_CATAPULT)?.entity;
}

export const vehicleCatapultTargetsScene: SceneDefinition = {
  id: 'vehicle-catapult-targets',
  seed: 37,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  missions: {
    missions: [
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [],
        results: [{ opcode: 'SetCameraPosition', point: CAMERA_AT }],
      },
    ],
  },
  runTicks: RUN_TICKS,
  initialZoom: 1,
  checks: [
    {
      label: 'the catapult drove up toward the tower, never away from the swordsmen',
      predicate: (sim) => {
        const e = ownCatapult(sim);
        const at = e === undefined ? undefined : sim.world.tryGet(e, Position);
        if (at === undefined) return false;
        const node = nodeOfPosition(at.x, at.y);
        const start = cellAnchorNode(CATAPULT_AT.x, CATAPULT_AT.y);
        const tower = cellAnchorNode(ENEMY_TOWER[1], ENEMY_TOWER[2]);
        const toTower = (p: { hx: number; hy: number }) => hexDistanceBetween(p.hx, p.hy, tower.hx, tower.hy);
        return toTower(node) < toTower(start);
      },
    },
    {
      label: 'the stones razed the tower',
      predicate: (sim) => enemyBuildings(sim).length === 0,
    },
    {
      label: 'the stones killed the archer',
      predicate: (sim) => {
        const archer = labelledSceneSettler(sim, ARCHER_LABEL);
        return archer !== undefined && (sim.world.tryGet(archer, Health)?.hitpoints ?? 0) <= 0;
      },
    },
  ],
};
