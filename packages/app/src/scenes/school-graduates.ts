import { components, type Entity, fx, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_JOINER, JOB_SMITH } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { placeBuiltSandboxBuilding, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const WIDTH = 28;
const HEIGHT = 24;
const SCHOOL_AT = { x: 12, y: 8 } as const;
const JOINERY_AT = { x: 22, y: 8 } as const;
/** The near smithy cannot make plate armour; the far upgraded one can. */
const SMITHY_AT = { x: 4, y: 12 } as const;
const UPGRADED_SMITHY_AT = { x: 20, y: 19 } as const;
const PUPILS_AT = [
  { x: 10, y: 13 },
  { x: 14, y: 13 },
] as const;
const SMITH_AT = { x: 8, y: 16 } as const;
/** Long enough for the walk to the school, the course, and the walk out to the joinery. */
const RUN_TICKS = 1200;
/** How far from the school's anchor a waiting graduate may stand: its footprint plus the yard, in cells. */
const SCHOOL_YARD_CELLS = 5;

const SCHOOL_TYPE = 'school';
const JOINERY_TYPE = 'work_joinery_00';
const SMITHY_TYPE = 'work_smithy_00';
const UPGRADED_SMITHY_TYPE = 'work_smithy_01';
export const PLATE_ARMOR_GOOD = 'armor_plate';

export function graduateJoiners(sim: Simulation): Entity[] {
  return [...sim.world.query(components.Settler)].filter(
    (e) => sim.world.get(e, components.Settler).jobType === JOB_JOINER,
  );
}

/** The scene's smith, who learns the plate armour method. */
export function methodSmith(sim: Simulation): Entity | undefined {
  return [...sim.world.query(components.Settler)].find(
    (e) => sim.world.get(e, components.Settler).jobType === JOB_SMITH,
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
 * school. A smith learns plate armour and passes the near smithy, which cannot make it, for the far
 * upgraded one, where it forges plate. The sandbox workshops employ rebased trade ids the school does not
 * teach, so headless the graduates wait; the posting is checked over real content.
 */
export const schoolGraduatesScene: SceneDefinition = {
  id: 'school-graduates',
  seed: 64,
  terrain: grassTerrain(WIDTH, HEIGHT),
  build: (sim) => {
    const school = placeBuiltSandboxBuilding(sim, SCHOOL_TYPE, SCHOOL_AT.x, SCHOOL_AT.y);
    placeBuiltSandboxBuilding(sim, JOINERY_TYPE, JOINERY_AT.x, JOINERY_AT.y);
    placeBuiltSandboxBuilding(sim, SMITHY_TYPE, SMITHY_AT.x, SMITHY_AT.y);
    placeBuiltSandboxBuilding(sim, UPGRADED_SMITHY_TYPE, UPGRADED_SMITHY_AT.x, UPGRADED_SMITHY_AT.y);
    // The course itself is the school scene's subject; technology discovery has its own scene.
    sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
    sim.enqueueSetup({ kind: 'setAssistantPostGraduates', player: HUMAN_PLAYER, enabled: true });
    for (const at of PUPILS_AT) {
      const pupil = spawnSettlerDirect(sim, JOB_COLLECTOR, at.x, at.y);
      sim.enqueueSetup({ kind: 'learn', entity: pupil, house: school, target: 'job', typeId: JOB_JOINER });
    }
    const plate = sim.content.goods.find((g) => g.id === PLATE_ARMOR_GOOD)?.typeId;
    const smith = spawnSettlerDirect(sim, JOB_SMITH, SMITH_AT.x, SMITH_AT.y);
    if (plate !== undefined)
      sim.enqueueSetup({ kind: 'learn', entity: smith, house: school, target: 'good', typeId: plate });
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
