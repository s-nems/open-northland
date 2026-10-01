import { components, type Entity, fx, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_JOINER } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { placeBuiltSandboxBuilding, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const WIDTH = 28;
const HEIGHT = 18;
const SCHOOL_AT = { x: 12, y: 8 } as const;
const JOINERY_AT = { x: 22, y: 8 } as const;
const PUPILS_AT = [
  { x: 10, y: 13 },
  { x: 14, y: 13 },
] as const;
/** Long enough for the walk to the school, the course, and the walk out to the joinery. */
const RUN_TICKS = 1200;
/** How far from the school's anchor a waiting graduate may stand: its footprint plus the yard, in cells. */
const SCHOOL_YARD_CELLS = 5;

const SCHOOL_TYPE = 'school';
const JOINERY_TYPE = 'work_joinery_00';

export function graduateJoiners(sim: Simulation): Entity[] {
  return [...sim.world.query(components.Settler)].filter(
    (e) => sim.world.get(e, components.Settler).jobType === JOB_JOINER,
  );
}

function schoolOf(sim: Simulation): Entity | undefined {
  return [...sim.world.query(components.Building)].find(
    (e) =>
      sim.world.get(e, components.Building).buildingType ===
      sim.content.buildings.find((b) => b.id === SCHOOL_TYPE)?.typeId,
  );
}

/**
 * Two collectors learn carpentry with the assistant's "send graduates to work" switch on: on real content
 * the first to finish takes the joinery's one joiner slot and the second finds none and waits by the
 * school. The sandbox joinery employs a rebased joiner id the school does not teach, so headless both wait;
 * the posting is checked over real content.
 */
export const schoolGraduatesScene: SceneDefinition = {
  id: 'school-graduates',
  seed: 64,
  terrain: grassTerrain(WIDTH, HEIGHT),
  build: (sim) => {
    const school = placeBuiltSandboxBuilding(sim, SCHOOL_TYPE, SCHOOL_AT.x, SCHOOL_AT.y);
    placeBuiltSandboxBuilding(sim, JOINERY_TYPE, JOINERY_AT.x, JOINERY_AT.y);
    // The course itself is the school scene's subject; technology discovery has its own scene.
    sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
    sim.enqueueSetup({ kind: 'setAssistantPostGraduates', player: HUMAN_PLAYER, enabled: true });
    for (const at of PUPILS_AT) {
      const pupil = spawnSettlerDirect(sim, JOB_COLLECTOR, at.x, at.y);
      sim.enqueueSetup({ kind: 'learn', entity: pupil, house: school, target: 'job', typeId: JOB_JOINER });
    }
  },
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'a graduate without a free joiner slot waits by the school',
      predicate: (sim) => {
        const school = schoolOf(sim);
        if (school === undefined) return false;
        const at = sim.world.get(school, components.Position);
        return graduateJoiners(sim).some((e) => {
          if (sim.world.tryGet(e, components.GraduateWait)?.school !== school) return false;
          const p = sim.world.get(e, components.Position);
          return (
            Math.abs(fx.toInt(p.x) - fx.toInt(at.x)) <= SCHOOL_YARD_CELLS &&
            Math.abs(fx.toInt(p.y) - fx.toInt(at.y)) <= SCHOOL_YARD_CELLS
          );
        });
      },
    },
  ],
};
