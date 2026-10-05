import { components, systems, TICKS_PER_SECOND } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CHILD_MALE, JOB_CIVILIST } from '../catalog/jobs.js';
import { BUILDING_BARRACKS, placeBuiltSandboxBuilding, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const { Age, Settler } = components;

const WIDTH = 24;
const HEIGHT = 16;
const SCHOOL_AT = { x: 7, y: 8 } as const;
const BARRACKS_AT = { x: 17, y: 8 } as const;
const BOY_AT = { x: 12, y: 12 } as const;
/** The boy comes of age a few seconds in, so the grown-up note rises in front of the player. */
const GROWS_UP_IN_TICKS = 3 * TICKS_PER_SECOND;
const RUN_TICKS = 2 * GROWS_UP_IN_TICKS;
/** Frames the boy with both houses in view. */
const INITIAL_ZOOM = 1.2;

/** A boy about to grow up between a school and a barracks: sending the new civilian to either retires
 *  his grown-up note as he sets off, not when the course ends. */
export const grownUpTrainingScene: SceneDefinition = {
  id: 'grown-up-training',
  seed: 71,
  terrain: grassTerrain(WIDTH, HEIGHT),
  build: (sim) => {
    placeBuiltSandboxBuilding(sim, 'school', SCHOOL_AT.x, SCHOOL_AT.y);
    placeBuiltSandboxBuilding(sim, BUILDING_BARRACKS, BARRACKS_AT.x, BARRACKS_AT.y);
    const boy = spawnSettlerDirect(sim, JOB_CHILD_MALE, BOY_AT.x, BOY_AT.y);
    sim.world.add(boy, Age, { ticks: systems.ADULT_AGE_TICKS - GROWS_UP_IN_TICKS, asOf: null });
  },
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the boy grew up into a civilian',
      predicate: (sim) =>
        [...sim.world.query(Settler)].some(
          (e) => sim.world.get(e, Settler).jobType === JOB_CIVILIST && !sim.world.has(e, Age),
        ),
    },
  ],
};
