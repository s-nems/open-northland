import type { Entity, Simulation } from '@open-northland/sim';
import { components, ONE, PRODUCTION_UNLIMITED, productionCountOf } from '@open-northland/sim';
import { grassTerrain, resolveVikingBuilding } from '../catalog/buildings.js';
import { JOB_BUILDER, JOB_COLLECTOR } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  assignmentPriority,
  BUILDING_HEADQUARTERS,
  buildingDef,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnSettlerDirect,
  workerRoleOf,
} from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 30;
const MAP_H = 18;
/** Between the two potteries, where the camera opens, so both are in view. */
const HQ = { x: 14, y: 6 } as const;
/** Hired into straight away: three products on offer. */
const HIRED_POTTERY = { x: 6, y: 6 } as const;
/** Hired into while it makes bricks alone, then upgraded to the three-product tier. */
const UPGRADED_POTTERY = { x: 22, y: 6 } as const;
const HIRE_POTTER = { x: 4, y: 12 } as const;
const UPGRADE_POTTER = { x: 20, y: 12 } as const;
const BUILDER = { x: 16, y: 13 } as const;
/** Real content gates the upgraded pottery on a collector's presence, as it does the home tiers. */
const COLLECTOR = { x: 12, y: 13 } as const;
/** Past the upgrade's fetch and hammering and several batches of each pottery. */
const RUN_TICKS = 10_000;
const INITIAL_ZOOM = 0.8;

const { Building, CompletedCycles, JobAssignment, ProductionCounters, Settler } = components;

const POTTERY_TYPE = resolveVikingBuilding('work_pottery_00').typeId;
const UPGRADED_POTTERY_TYPE = resolveVikingBuilding('work_pottery_01').typeId;

/** Hire `settler` into `building` as its craftsman, as the player's right-click does. */
function hire(sim: Simulation, settler: Entity, building: Entity, buildingType: number): void {
  const jobPriority = assignmentPriority(buildingDef(sim, buildingType)?.workers);
  sim.enqueueSetup({ kind: 'assignWorker', entity: settler, building, jobPriority });
}

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ.x, HQ.y, HUMAN_PLAYER, { fillStock: true });
  const hired = placeBuiltSandboxBuilding(sim, UPGRADED_POTTERY_TYPE, HIRED_POTTERY.x, HIRED_POTTERY.y);
  const upgraded = placeBuiltSandboxBuilding(sim, POTTERY_TYPE, UPGRADED_POTTERY.x, UPGRADED_POTTERY.y);
  sim.world.add(hired, CompletedCycles, { byGood: new Map() });
  const hirePotter = spawnSettlerDirect(sim, JOB_COLLECTOR, HIRE_POTTER.x, HIRE_POTTER.y);
  const upgradePotter = spawnSettlerDirect(sim, JOB_COLLECTOR, UPGRADE_POTTER.x, UPGRADE_POTTER.y);
  spawnSettlerDirect(sim, JOB_BUILDER, BUILDER.x, BUILDER.y);
  spawnSettlerDirect(sim, JOB_COLLECTOR, COLLECTOR.x, COLLECTOR.y);
  // Every product is open to the potters, so only their production counters hold them to bricks.
  sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
  hire(sim, hirePotter, hired, UPGRADED_POTTERY_TYPE);
  hire(sim, upgradePotter, upgraded, POTTERY_TYPE);
  sim.enqueueSetup({ kind: 'upgradeBuilding', building: upgraded });
}

/** The upgraded-tier potteries, lowest id first: the hired one, then the upgraded one once its upgrade
 *  has finished. */
function potteries(sim: Simulation): Entity[] {
  return [...sim.world.query(Building)]
    .filter((e) => sim.world.get(e, Building).buildingType === UPGRADED_POTTERY_TYPE)
    .sort((a, b) => a - b);
}

function potterOf(sim: Simulation, pottery: Entity | undefined): Entity | null {
  if (pottery === undefined) return null;
  for (const e of sim.world.query(Settler, JobAssignment)) {
    const jobType = sim.world.get(e, Settler).jobType;
    if (sim.world.get(e, JobAssignment).workplace !== pottery || jobType === null) continue;
    if (workerRoleOf(jobType) === 'craftsman') return e;
  }
  return null;
}

/** Whether `potter` makes bricks without limit and every other product of the upgraded tier not at all. */
function makesOnlyBricks(sim: Simulation, potter: Entity | null): boolean {
  const products = buildingDef(sim, UPGRADED_POTTERY_TYPE)?.recipes.map((r) => r.outputs[0]?.goodType) ?? [];
  if (potter === null || products.length < 2) return false;
  const selection = sim.world.tryGet(potter, ProductionCounters);
  const brick = goodBySlug(sim, 'brick');
  return products.every(
    (good) =>
      good === undefined ||
      productionCountOf(selection, good) === (good === brick ? PRODUCTION_UNLIMITED : 0),
  );
}

export const workshopProductsScene: SceneDefinition = {
  id: 'workshop-products',
  seed: 7,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'a potter hired into the three-product pottery makes only bricks, its first product',
      predicate: (sim) => makesOnlyBricks(sim, potterOf(sim, potteries(sim)[0])),
    },
    {
      label: 'that pottery fired bricks and nothing else',
      predicate: (sim) => {
        const pottery = potteries(sim)[0];
        const fired = pottery === undefined ? undefined : sim.world.tryGet(pottery, CompletedCycles)?.byGood;
        if (fired === undefined) return false;
        const brick = goodBySlug(sim, 'brick');
        return (fired.get(brick) ?? 0) > 0 && [...fired.keys()].every((good) => good === brick);
      },
    },
    {
      label: 'the upgraded pottery finished, and its potter still makes only bricks',
      predicate: (sim) => {
        const pottery = potteries(sim)[1];
        if (pottery === undefined || sim.world.get(pottery, Building).built < ONE) return false;
        return makesOnlyBricks(sim, potterOf(sim, pottery));
      },
    },
  ],
};
