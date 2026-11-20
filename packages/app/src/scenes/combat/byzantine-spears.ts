import { cellAnchorNode, components, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { BYZANTINE } from '../../catalog/civilizations.js';
import { JOB_SOLDIER_SPEAR, JOB_SOLDIER_SPEAR_WOODEN } from '../../catalog/jobs.js';
import type { SceneDefinition } from '../types.js';

const HUMAN_SEAT = 0;
const MACHINE_SEAT = 1;

/** Two columns of Byzantine spears, a human seat's and a machine seat's, wood above iron in each. */
const COLUMNS = [HUMAN_SEAT, MACHINE_SEAT] as const;

function build(sim: Simulation): void {
  sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN_SEAT, to: MACHINE_SEAT, state: 'friend' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: MACHINE_SEAT, to: HUMAN_SEAT, state: 'friend' });
  sim.enqueueSetup({ kind: 'setAiControl', player: MACHINE_SEAT, enabled: true, mapAiEnabled: false });
  for (const [column, owner] of COLUMNS.entries()) {
    for (const [row, jobType] of [JOB_SOLDIER_SPEAR_WOODEN, JOB_SOLDIER_SPEAR].entries()) {
      const node = cellAnchorNode(4 + column * 5, 5 + row * 5);
      sim.enqueueSetup({ kind: 'spawnSettler', tribe: BYZANTINE, jobType, owner, x: node.hx, y: node.hy });
    }
  }
}

export const byzantineSpearsScene: SceneDefinition = {
  id: 'byzantine-spears',
  seed: 37,
  terrain: grassTerrain(14, 16),
  graphicTribes: [1, BYZANTINE],
  initialZoom: 1.5,
  runTicks: 60,
  build,
  checks: [
    {
      label: 'every Byzantine spearman is a soldier of the common pool, whichever seat holds him',
      predicate: (sim) => {
        const units = [...sim.world.query(components.Settler, components.Owner, components.Health)];
        return (
          units.length === COLUMNS.length * 2 &&
          units.every((e) => sim.world.get(e, components.Health).max === systems.HUMAN_HITPOINTS)
        );
      },
    },
  ],
};
