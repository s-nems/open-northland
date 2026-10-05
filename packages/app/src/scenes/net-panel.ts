import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_BUILDER, JOB_CIVILIST, JOB_WOMAN } from '../catalog/jobs.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 24;
const MAP_H = 20;
const RUN_TICKS = 40;
/** A small camp for the HUD to stand over: the panel's figures are scripted, not this world's. */
const CAMP = [
  { job: JOB_CIVILIST, x: 10, y: 8 },
  { job: JOB_BUILDER, x: 12, y: 8 },
  { job: JOB_WOMAN, x: 11, y: 10 },
] as const;

export const netPanelScene: SceneDefinition = {
  id: 'net-panel',
  seed: 31,
  terrain: grassTerrain(MAP_W, MAP_H),
  build: (sim) => {
    for (const settler of CAMP) spawnSettlerDirect(sim, settler.job, settler.x, settler.y);
  },
  runTicks: RUN_TICKS,
  netPanelPreview: true,
  checks: [
    {
      label: 'the camp stands under the HUD the preview draws over',
      predicate: (sim) => [...sim.world.query(components.Settler)].length === CAMP.length,
    },
  ],
};
