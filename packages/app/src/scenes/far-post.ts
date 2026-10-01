import { components, type Entity, fx, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CIVILIST, JOB_SCOUT, JOB_WOMAN } from '../catalog/jobs.js';
import {
  assignmentPriority,
  BUILDING_BAKERY,
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  buildingDef,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 96;
const MAP_H = 20;
const HEADQUARTERS = { x: 8, y: 10 } as const;
/** 52 tiles east of the camp: past the 25-tile walk range, with no signpost between. */
const FAR_BAKERY = { x: 60, y: 6 } as const;
const FAR_HOME = { x: 60, y: 14 } as const;
const POSTED = { x: 12, y: 8 } as const;
const CIVILIANS = [
  { x: 12, y: 11 },
  { x: 13, y: 13 },
] as const;
const WOMAN = { x: 11, y: 14 } as const;
const SCOUT = { x: 14, y: 10 } as const;
const POSTED_NAME = 'Olaf';
const RUN_TICKS = 300;
const INITIAL_ZOOM = 0.6;

const { GivenName, JobAssignment, LostWay, Position } = components;

function named(sim: Simulation, name: string): Entity | undefined {
  for (const e of sim.world.query(GivenName)) {
    if (sim.world.get(e, GivenName).name === name) return e;
  }
  return undefined;
}

function build(sim: Simulation): void {
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HEADQUARTERS.x, HEADQUARTERS.y);
  const bakery = placeBuiltSandboxBuilding(sim, BUILDING_BAKERY, FAR_BAKERY.x, FAR_BAKERY.y);
  placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, FAR_HOME.x, FAR_HOME.y);
  const posted = spawnSettlerDirect(sim, JOB_CIVILIST, POSTED.x, POSTED.y);
  sim.world.add(posted, GivenName, { name: POSTED_NAME });
  for (const at of CIVILIANS) spawnSettlerDirect(sim, JOB_CIVILIST, at.x, at.y);
  spawnSettlerDirect(sim, JOB_WOMAN, WOMAN.x, WOMAN.y);
  spawnSettlerDirect(sim, JOB_SCOUT, SCOUT.x, SCOUT.y);
  // The runtime turns progression off only after the build, too late for this tick-0 order. The job list
  // is the player's right-click's.
  sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
  const jobPriority = assignmentPriority(buildingDef(sim, BUILDING_BAKERY)?.workers);
  sim.enqueueSetup({ kind: 'assignWorker', entity: posted, building: bakery, jobPriority });
}

export const farPostScene: SceneDefinition = {
  id: 'far-post',
  seed: 85,
  terrain: grassTerrain(MAP_W, MAP_H),
  initialZoom: INITIAL_ZOOM,
  progression: false,
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'Olaf keeps his post at the far bakery',
      predicate: (sim) => {
        const olaf = named(sim, POSTED_NAME);
        return olaf !== undefined && sim.world.has(olaf, JobAssignment);
      },
    },
    {
      label: 'Olaf stands lost by the camp, his status naming the workplace beyond signpost reach',
      predicate: (sim) => {
        const olaf = named(sim, POSTED_NAME);
        return (
          olaf !== undefined &&
          sim.world.has(olaf, LostWay) &&
          fx.toInt(sim.world.get(olaf, Position).x) < FAR_BAKERY.x / 2 &&
          sim.workStatus(olaf)?.kind === 'workplaceOutOfReach'
        );
      },
    },
  ],
};
