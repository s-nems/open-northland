import { cellAnchorNode, components, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { GATHERERS, GOOD_MUD, placeFlag, placeResourceNode } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const CIVILIZATIONS = [1, 2, 3, 4, 7] as const;
const CLAY = GATHERERS.find((gatherer) => gatherer.good === GOOD_MUD);
const DEPOSIT_SCALE = 100;

function build(sim: Simulation): void {
  if (CLAY === undefined) throw new Error('clay-gatherers: missing clay gatherer');
  for (const [row, tribe] of CIVILIZATIONS.entries()) {
    const y = 5 + row * 4;
    placeResourceNode(sim, CLAY, 12, y, { unitsScale: DEPOSIT_SCALE });
    const flag = placeFlag(sim, 8, y);
    // A pair shows both byzantine civilian heads while the shared deposit turns the workers.
    for (let i = 0; i < 2; i++) {
      const node = cellAnchorNode(9, y + i);
      const e = systems.createSettler(
        sim.world,
        sim.content,
        sim.rng,
        { tribe, jobType: CLAY.job, owner: 0, x: node.hx, y: node.hy },
        sim.names,
      );
      if (e === null) throw new Error('clay-gatherers: missing collector job');
      sim.world.add(e, components.WorkFlag, {
        flag,
        radius: 8,
      });
    }
  }
}

export const clayGatherersScene: SceneDefinition = {
  id: 'clay-gatherers',
  seed: 79,
  terrain: grassTerrain(22, 27),
  graphicTribes: CIVILIZATIONS,
  build,
  progression: false,
  initialZoom: 0.95,
  runTicks: 800,
  checks: [
    {
      label: 'the collectors of every civilization have dug clay from their deposit',
      predicate: (sim) => {
        const deposits = [...sim.world.query(components.Resource)];
        return (
          deposits.length === CIVILIZATIONS.length &&
          deposits.every(
            (e) =>
              sim.world.get(e, components.Resource).remaining < (CLAY?.depositUnits ?? 0) * DEPOSIT_SCALE,
          )
        );
      },
    },
  ],
};
