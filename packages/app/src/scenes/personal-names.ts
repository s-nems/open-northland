import { cellAnchorNode, components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CIVILIST, JOB_SOLDIER_UNARMED, JOB_WOMAN } from '../catalog/jobs.js';
import type { SceneDefinition } from './types.js';

const CIVILIZATIONS = [1, 2, 3, 4, 7] as const;
function build(sim: Simulation): void {
  for (const [row, tribe] of CIVILIZATIONS.entries()) {
    for (const [column, jobType] of [JOB_CIVILIST, JOB_WOMAN, JOB_CIVILIST, JOB_WOMAN].entries()) {
      const node = cellAnchorNode(6 + column * 4, 5 + row * 4);
      sim.enqueueSetup({ kind: 'spawnSettler', tribe, jobType, owner: 0, x: node.hx, y: node.hy });
    }
  }
  for (const [column, tribe] of [5, 6].entries()) {
    const node = cellAnchorNode(8 + column * 6, 25);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      tribe,
      jobType: JOB_SOLDIER_UNARMED,
      owner: 0,
      x: node.hx,
      y: node.hy,
    });
  }
}

export const personalNamesScene: SceneDefinition = {
  id: 'personal-names',
  seed: 731,
  terrain: grassTerrain(28, 32),
  build,
  graphicTribes: [...CIVILIZATIONS, 5, 6],
  initialZoom: 0.9,
  runTicks: 1,
  checks: [
    {
      label: 'all civilizations and both creature tribes have distinct personal identities',
      predicate: (sim) => {
        const people = [...sim.world.query(components.Person)];
        return (
          people.length === 22 &&
          people.every((e) => sim.world.has(e, components.NameIdentity)) &&
          new Set(people.map((e) => sim.world.get(e, components.NameIdentity).name)).size === 22
        );
      },
    },
  ],
};
