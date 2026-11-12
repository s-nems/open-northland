import { components, ONE, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { CIVILIZATIONS } from '../../catalog/civilizations.js';
import { JOB_CIVILIST } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { placeBuiltSandboxBuilding, spawnSettlerDirect } from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const { Position, SettlerNeeds } = components;

/** One temple per civilization along a row, so their auras compare side by side. */
const TEMPLE_ROW_Y = 30;
const TEMPLE_FIRST_X = 12;
const TEMPLE_STEP_X = 12;

function build(sim: Simulation): void {
  CIVILIZATIONS.forEach((tribe, i) => {
    const x = TEMPLE_FIRST_X + i * TEMPLE_STEP_X;
    placeBuiltSandboxBuilding(sim, 'work_temple', x, TEMPLE_ROW_Y, HUMAN_PLAYER, { tribe });
  });
  for (const [x, y] of [
    [34, 34],
    [36, 64],
  ] as const) {
    const settler = spawnSettlerDirect(sim, JOB_CIVILIST, x, y);
    sim.world.mut(settler, SettlerNeeds).piety = ONE;
  }
}

/** Select a temple to inspect the pale-blue blessing range; neither civilian has a prayer drive. */
export const templeAuraScene: SceneDefinition = {
  id: 'temple-aura',
  seed: 41,
  terrain: grassTerrain(80, 80),
  graphicTribes: CIVILIZATIONS,
  build,
  runTicks: 120,
  initialZoom: 0.4,
  needs: true,
  progression: false,
  checks: [
    {
      label: 'the nearby civilian gains religion without leaving for prayer',
      predicate: (sim) =>
        [...sim.world.query(SettlerNeeds, Position)].some(
          (e) => sim.world.get(e, Position).y < ONE * 50 && sim.world.get(e, SettlerNeeds).piety < ONE,
        ),
    },
    {
      label: 'the distant civilian stays outside the blessing',
      predicate: (sim) =>
        [...sim.world.query(SettlerNeeds, Position)].some(
          (e) => sim.world.get(e, Position).y > ONE * 50 && sim.world.get(e, SettlerNeeds).piety === ONE,
        ),
    },
  ],
};
