import { components, type Entity, type Simulation } from '@open-northland/sim';
import { grassTerrain, VIKING } from '../../catalog/buildings.js';
import { FRANK, SARACEN } from '../../catalog/civilizations.js';
import { JOB_ARCHER } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_WATCHTOWER,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const { Building, Garrison } = components;

const MAP_W = 26;
const MAP_H = 14;
const TOWER_ROW = 8;
const ARCHER_ROW = 12;
/** Each civilization's tower twice, manned on the left and bare on the right. */
const TOWERS = [
  { tribe: FRANK, x: 4, manned: true },
  { tribe: FRANK, x: 9, manned: false },
  { tribe: SARACEN, x: 15, manned: true },
  { tribe: SARACEN, x: 20, manned: false },
] as const;
const RUN_TICKS = 300;

function build(sim: Simulation): void {
  for (const { tribe, x, manned } of TOWERS) {
    const tower = placeBuiltSandboxBuilding(sim, BUILDING_WATCHTOWER, x, TOWER_ROW, HUMAN_PLAYER, { tribe });
    if (!manned) continue;
    const archer = spawnSettlerDirect(sim, JOB_ARCHER, x, ARCHER_ROW);
    sim.enqueueSetup({ kind: 'assignWorker', entity: archer, building: tower, jobPriority: [JOB_ARCHER] });
  }
}

/** How many of `tribe`'s towers an archer holds. */
function heldTowers(sim: Simulation, tribe: number): number {
  const posts = new Set<Entity>();
  for (const e of sim.world.query(Garrison)) posts.add(sim.world.get(e, Garrison).post);
  let held = 0;
  for (const e of sim.world.query(Building))
    if (sim.world.get(e, Building).tribe === tribe && posts.has(e)) held++;
  return held;
}

/** The frank tower's pennant and the saracen tower's crescent give way to the garrison flag. */
export const towerFinialsScene: SceneDefinition = {
  id: 'tower-finials',
  seed: 12,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  graphicTribes: [VIKING, FRANK, SARACEN],
  initialZoom: 0.9,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'an archer holds one tower of each civilization, the other stands bare',
      predicate: (sim) => heldTowers(sim, FRANK) === 1 && heldTowers(sim, SARACEN) === 1,
    },
  ],
};
