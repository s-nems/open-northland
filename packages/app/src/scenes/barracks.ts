import { components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CIVILIST, JOB_SOLDIER } from '../catalog/jobs.js';
import { jobUnlockedFor } from '../game/profession-unlocks.js';
import {
  BUILDING_BARRACKS,
  BUILDING_HEADQUARTERS,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnSettlerDirect,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Barracks training: a colonist right-clicked onto the barracks walks in, drills, and comes back out a
 * soldier (see the sim's `schoolingMet` for why that is the only route). Three settlers hold the
 * contrast: the recruit, a serving soldier sent in after him (who only drills - his trade is already
 * his), and a bystander who stays a colonist and stays refused.
 */

const { Settler } = components;

/** The TRAINING bucket a drill banks into - the veteran's proof that he really did drill. */
const TRAINING_TRACK = systems.TRAINING_EXPERIENCE_TYPE;

const HEADQUARTERS = { x: 6, y: 12 } as const;
const BARRACKS = { x: 14, y: 10 } as const;
/** The three settlers' start row, clear of both footprints under the approximate and real geometries. */
const START_ROW_Y = 6;
const RECRUIT_X = 10;
const VETERAN_X = 12;
const BYSTANDER_X = 8;

/** Walk to the door plus the whole drill, with room for the last repetition to play out. */
const RUN_TICKS = 400;

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, HEADQUARTERS.x, HEADQUARTERS.y);
  const barracks = placeBuiltSandboxBuilding(sim, BUILDING_BARRACKS, BARRACKS.x, BARRACKS.y);
  const recruit = spawnSettlerDirect(sim, JOB_CIVILIST, RECRUIT_X, START_ROW_Y);
  const veteran = spawnSettlerDirect(sim, JOB_SOLDIER, VETERAN_X, START_ROW_Y);
  spawnSettlerDirect(sim, JOB_CIVILIST, BYSTANDER_X, START_ROW_Y);
  sim.enqueue({ kind: 'trainSoldier', entity: recruit, house: barracks });
  sim.enqueue({ kind: 'trainSoldier', entity: veteran, house: barracks });
}

/** The three settlers by role. Query order is spawn order, which {@link build} fixes just above - the one
 *  place the mapping lives, so a reordered build changes it here rather than silently in each check. */
function cast(sim: Simulation): {
  recruit: Entity | undefined;
  veteran: Entity | undefined;
  bystander: Entity | undefined;
} {
  const [recruit, veteran, bystander] = sim.world.query(Settler);
  return { recruit, veteran, bystander };
}

/** Whether the settler would now be accepted for the soldier trade - the picker's filter, which mirrors
 *  the `setJob` gate, so a passing check means the row really is offered. */
function soldierOffered(sim: Simulation, e: Entity): boolean {
  const settler = sim.world.get(e, Settler);
  return jobUnlockedFor(sim.content, true, settler.tribe, settler.experience, JOB_SOLDIER);
}

export const barracksScene: SceneDefinition = {
  id: 'barracks',
  seed: 11,
  terrain: grassTerrain(24, 16),
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the recruit walks out of the barracks a soldier',
      predicate: (sim) => {
        const { recruit } = cast(sim);
        return recruit !== undefined && sim.world.get(recruit, Settler).jobType === JOB_SOLDIER;
      },
    },
    {
      label: 'his drill unlocked the soldier trade for good',
      predicate: (sim) => {
        const { recruit } = cast(sim);
        return recruit !== undefined && soldierOffered(sim, recruit);
      },
    },
    {
      label: 'the serving soldier sent in after him drills, and keeps the trade he had',
      predicate: (sim) => {
        const { veteran } = cast(sim);
        if (veteran === undefined) return false;
        const settler = sim.world.get(veteran, Settler);
        return settler.jobType === JOB_SOLDIER && (settler.experience.get(TRAINING_TRACK) ?? 0) > 0;
      },
    },
    {
      label: 'the colonist who never drilled is still refused the soldier trade',
      predicate: (sim) => {
        const { bystander } = cast(sim);
        return (
          bystander !== undefined &&
          sim.world.get(bystander, Settler).jobType === JOB_CIVILIST &&
          !soldierOffered(sim, bystander)
        );
      },
    },
  ],
};
