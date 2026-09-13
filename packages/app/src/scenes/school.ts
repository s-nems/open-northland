import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_JOINER } from '../catalog/jobs.js';
import { placeBuiltSandboxBuilding, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

export const schoolScene: SceneDefinition = {
  id: 'school',
  seed: 63,
  terrain: grassTerrain(24, 16),
  build: (sim) => {
    const school = placeBuiltSandboxBuilding(sim, 'school', 12, 8);
    const pupil = spawnSettlerDirect(sim, JOB_COLLECTOR, 10, 12);
    spawnSettlerDirect(sim, JOB_JOINER, 16, 12);
    spawnSettlerDirect(sim, JOB_COLLECTOR, 8, 12);
    sim.enqueueSetup({ kind: 'learn', entity: pupil, house: school, target: 'job', typeId: JOB_JOINER });
  },
  runTicks: 1000,
  checks: [
    {
      label: 'the first collector learns carpentry at school',
      predicate: (sim) =>
        [...sim.world.query(components.Settler)].some((entity) => {
          const worker = sim.world.get(entity, components.Settler);
          return worker.jobType === JOB_JOINER && worker.learned?.job.includes(JOB_JOINER) === true;
        }),
    },
    {
      label: 'the other collector retains its own qualifications',
      predicate: (sim) =>
        [...sim.world.query(components.Settler)].some((entity) => {
          const worker = sim.world.get(entity, components.Settler);
          return worker.jobType === JOB_COLLECTOR && worker.learned === undefined;
        }),
    },
  ],
};
