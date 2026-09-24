import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CIVILIST, JOB_COLLECTOR, JOB_JOINER } from '../catalog/jobs.js';
import { placeBuiltSandboxBuilding, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const WIDTH = 24;
const HEIGHT = 16;
const SCHOOL_AT = { x: 12, y: 8 } as const;
const PUPIL_AT = { x: 10, y: 12 } as const;
const JOINER_AT = { x: 16, y: 12 } as const;
const BYSTANDER_AT = { x: 8, y: 12 } as const;
/** Long enough for the walk to the school and the whole course. */
const RUN_TICKS = 1000;

export const schoolScene: SceneDefinition = {
  id: 'school',
  seed: 63,
  terrain: grassTerrain(WIDTH, HEIGHT),
  build: (sim) => {
    const school = placeBuiltSandboxBuilding(sim, 'school', SCHOOL_AT.x, SCHOOL_AT.y);
    const pupil = spawnSettlerDirect(sim, JOB_COLLECTOR, PUPIL_AT.x, PUPIL_AT.y);
    spawnSettlerDirect(sim, JOB_JOINER, JOINER_AT.x, JOINER_AT.y);
    spawnSettlerDirect(sim, JOB_COLLECTOR, BYSTANDER_AT.x, BYSTANDER_AT.y);
    spawnSettlerDirect(sim, JOB_CIVILIST, BYSTANDER_AT.x - 2, BYSTANDER_AT.y);
    // This scene exercises the course itself; technology discovery has its own acceptance scene. The
    // override must precede `learn` in the setup queue so real content admits the lesson on tick one.
    sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
    sim.enqueueSetup({ kind: 'learn', entity: pupil, house: school, target: 'job', typeId: JOB_JOINER });
  },
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the first collector learns carpentry at school',
      predicate: (sim) =>
        [...sim.world.query(components.Settler)].some((entity) => {
          const learned = sim.world.get(entity, components.SettlerProgress).learned;
          return (
            sim.world.get(entity, components.Settler).jobType === JOB_JOINER &&
            learned?.job.includes(JOB_JOINER) === true
          );
        }),
    },
    {
      label: 'the other collector retains its own qualifications',
      predicate: (sim) =>
        [...sim.world.query(components.Settler)].some((entity) => {
          const learned = sim.world.get(entity, components.SettlerProgress).learned;
          return sim.world.get(entity, components.Settler).jobType === JOB_COLLECTOR && learned === undefined;
        }),
    },
  ],
};
