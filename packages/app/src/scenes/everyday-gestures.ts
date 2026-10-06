import { cellAnchorNode, components, type Simulation, systems } from '@open-northland/sim';
import { JOB_BABY_FEMALE, JOB_BABY_MALE, JOB_FISHER } from '../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../catalog/terrain.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import { alchemyScene } from './alchemy.js';
import type { SceneDefinition } from './types.js';

const WIDTH = 40;
const HEIGHT = 24;
const FISH_COUNT = 30;

function build(sim: Simulation): void {
  alchemyScene.build(sim);
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('Everyday gestures needs a map');
  const water = cellAnchorNode(7, 4);
  systems.addFishSwarms(sim.world, terrain, [{ ...water, count: FISH_COUNT, continent: 1 }]);
  const fisher = spawnSettlerDirect(sim, JOB_FISHER, 13, 4);
  const delivery = cellAnchorNode(13, 4);
  sim.enqueueSetup({ kind: 'setWorkFlag', entity: fisher, x: delivery.hx, y: delivery.hy });
  // Unhoused babies stay outdoors and idle; no animation or action is forced onto them.
  spawnSettlerDirect(sim, JOB_BABY_FEMALE, 20, 5);
  spawnSettlerDirect(sim, JOB_BABY_MALE, 22, 5);
}

export const everydayGesturesScene: SceneDefinition = {
  id: 'everyday-gestures',
  seed: 30,
  terrain: {
    width: WIDTH,
    height: HEIGHT,
    typeIds: Array.from({ length: WIDTH * HEIGHT }, (_, i) => {
      const x = i % WIDTH;
      const y = Math.floor(i / WIDTH);
      return x >= 3 && x < 9 && y >= 2 && y < 7 ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
    }),
  },
  build,
  progression: false,
  runTicks: 1500,
  initialZoom: 0.85,
  checks: [
    ...alchemyScene.checks,
    {
      label: 'the fisher walked to the pond and caught fish',
      predicate: (sim) =>
        [...sim.world.query(components.FishSwarm)].some(
          (e) => sim.world.get(e, components.FishSwarm).count < FISH_COUNT,
        ),
    },
  ],
};
