import { components, type Entity, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_ARCHER, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { ENEMY_PLAYER } from '../../game/rules.js';
import {
  BUILDING_WATCHTOWER,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  spawnSettlerDirect,
  WEAPON_SWORD,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const { Building, Health } = components;

const MAP_W = 30;
const MAP_H = 16;
const TOWER = { x: 8, y: 8 } as const;
/** The defence wall's catalog id (`house-types` correction, logictype 56). */
const DEFENCE_WALL = 'defence_wall';
/** Two walls between the tower and the enemy, nearer to the enemy than the tower, with a gap at the centre. */
const WALLS: readonly { readonly x: number; readonly y: number }[] = [
  { x: 12, y: 4 },
  { x: 12, y: 12 },
];
const ARCHER_STARTS: readonly { readonly x: number; readonly y: number }[] = [
  { x: 5, y: 6 },
  { x: 5, y: 10 },
];
/** The tower stands within the party's sight, the walls nearer: before a wall ranked with the towers, the
 *  nearer wall won the pick. */
const ASSAULT_X = 16;
const ASSAULT_ROWS: readonly number[] = [6, 8, 10];
/** Over-tough on purpose, so the party lives to reach the tower under fire. */
const ENEMY_HITPOINTS = 200_000;
/** The party is at the tower and has battered it, which stands until about tick 400. */
const RUN_TICKS = 300;

function build(sim: Simulation): void {
  const tower = placeBuiltSandboxBuilding(sim, BUILDING_WATCHTOWER, TOWER.x, TOWER.y);
  for (const start of ARCHER_STARTS) {
    const archer = spawnSettlerDirect(sim, JOB_ARCHER, start.x, start.y);
    sim.enqueueSetup({ kind: 'assignWorker', entity: archer, building: tower, jobPriority: [JOB_ARCHER] });
  }
  for (const wall of WALLS) placeBuiltSandboxBuilding(sim, DEFENCE_WALL, wall.x, wall.y);
  for (const y of ASSAULT_ROWS) {
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, ASSAULT_X, y, ENEMY_PLAYER, {
      weaponTypeId: WEAPON_SWORD,
      hitpoints: ENEMY_HITPOINTS,
    });
  }
}

function buildingsOfType(sim: Simulation, buildingType: number): Entity[] {
  return [...sim.world.query(Building, Health)].filter(
    (e) => sim.world.get(e, Building).buildingType === buildingType,
  );
}

function wallType(sim: Simulation): number | undefined {
  return sim.content.buildings.find((b) => b.id === DEFENCE_WALL)?.typeId;
}

function unhurt(sim: Simulation, e: Entity): boolean {
  const h = sim.world.get(e, Health);
  return h.hitpoints === h.max;
}

export const defenceWallScene: SceneDefinition = {
  id: 'defence-wall',
  seed: 11,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the enemy party leaves the nearer defence walls standing untouched',
      predicate: (sim) => {
        const type = wallType(sim);
        const walls = type === undefined ? [] : buildingsOfType(sim, type);
        return walls.length === WALLS.length && walls.every((e) => unhurt(sim, e));
      },
    },
    {
      label: 'it walks through the gap and batters the tower that shoots at it',
      predicate: (sim) => buildingsOfType(sim, BUILDING_WATCHTOWER).some((e) => !unhurt(sim, e)),
    },
  ],
};
