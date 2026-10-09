import { cellAnchorNode, components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SPEAR, JOB_SOLDIER_SPEAR_WOODEN } from '../catalog/jobs.js';
import type { SceneDefinition } from './types.js';

/** Three columns: human, replacement AI, map-only AI. Wood stands above iron in each column. */
function build(sim: Simulation): void {
  components.seedScenarioPlayers(sim.world, [2]);
  for (const player of [0, 1, 2]) {
    for (const other of [0, 1, 2]) {
      if (player !== other)
        sim.enqueueSetup({ kind: 'setDiplomacy', from: player, to: other, state: 'friend' });
    }
    if (player !== 0) sim.enqueueSetup({ kind: 'setPlayerAi', player, enabled: true, scripted: false });
    for (const [row, jobType] of [JOB_SOLDIER_SPEAR_WOODEN, JOB_SOLDIER_SPEAR].entries()) {
      const node = cellAnchorNode(4 + player * 5, 5 + row * 5);
      sim.enqueueSetup({ kind: 'spawnSettler', tribe: 3, jobType, owner: player, x: node.hx, y: node.hy });
    }
  }
}

export const byzantineSpearsScene: SceneDefinition = {
  id: 'byzantine-spears',
  seed: 37,
  terrain: grassTerrain(19, 16),
  graphicTribes: [1, 3],
  initialZoom: 1.5,
  runTicks: 60,
  build,
  checks: [
    {
      label: 'only the map-only seat carries scenario units alongside both playable seats',
      predicate: (sim) => {
        const units = [...sim.world.query(components.Settler, components.Owner)];
        return (
          units.length === 6 &&
          units.every(
            (e) =>
              (sim.world.get(e, components.Settler).scenario === true) ===
              (sim.world.get(e, components.Owner).player === 2),
          )
        );
      },
    },
  ],
};
