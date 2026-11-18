import { components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain, VIKING } from '../../catalog/buildings.js';
import { SARACEN } from '../../catalog/civilizations.js';
import { JOB_COLLECTOR } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  assignmentPriority,
  BUILDING_POTTERY,
  buildingDef,
  GOOD_WOOD,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const { Building, JobAssignment, Stockpile } = components;

const MAP_W = 20;
const MAP_H = 12;
const POTTERY = { x: 6, y: 4 } as const;
const POTTER = { x: 6, y: 9 } as const;
/** Half-cell nodes around the saracen pottery's sign post, which stands far out beside its door. */
const HEAPS = [
  { hx: 14, hy: 9 },
  { hx: 15, hy: 9 },
  { hx: 16, hy: 9 },
  { hx: 15, hy: 10 },
  { hx: 16, hy: 10 },
] as const;
const RUN_TICKS = 40;

function build(sim: Simulation): void {
  const pottery = placeBuiltSandboxBuilding(sim, BUILDING_POTTERY, POTTERY.x, POTTERY.y, HUMAN_PLAYER, {
    tribe: SARACEN,
  });
  for (const { hx, hy } of HEAPS) {
    systems.createGroundGoods(sim.world, {
      goodType: GOOD_WOOD,
      amount: systems.MAX_GROUND_STACK,
      x: hx,
      y: hy,
    });
  }
  const potter = spawnSettlerDirect(sim, JOB_COLLECTOR, POTTER.x, POTTER.y, HUMAN_PLAYER, SARACEN);
  const jobPriority = assignmentPriority(buildingDef(sim, BUILDING_POTTERY)?.workers);
  sim.enqueueSetup({ kind: 'assignWorker', entity: potter, building: pottery, jobPriority });
}

function potteryOf(sim: Simulation): Entity | undefined {
  for (const e of sim.world.query(Building)) return e;
  return undefined;
}

function staffed(sim: Simulation): boolean {
  const pottery = potteryOf(sim);
  for (const e of sim.world.query(JobAssignment)) {
    if (sim.world.get(e, JobAssignment).workplace === pottery) return true;
  }
  return false;
}

function woodHeaps(sim: Simulation): number {
  let heaps = 0;
  for (const e of sim.world.query(Stockpile)) {
    if (!sim.world.has(e, Building) && (sim.world.get(e, Stockpile).amounts.get(GOOD_WOOD) ?? 0) > 0) heaps++;
  }
  return heaps;
}

/** Wood heaps lie around a staffed saracen workshop's sign post; the sign chain stays in view over them. */
export const doorSignHeapsScene: SceneDefinition = {
  id: 'door-sign-heaps',
  seed: 31,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  graphicTribes: [VIKING, SARACEN],
  progression: false,
  initialZoom: 1.2,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the pottery is staffed and the wood heaps still lie around its sign post',
      predicate: (sim) => staffed(sim) && woodHeaps(sim) === HEAPS.length,
    },
  ],
};
