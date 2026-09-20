import type { Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, ONE } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_BUILDER, JOB_CARRIER } from '../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_ANIMAL_FARM,
  BUILDING_BAKERY,
  BUILDING_HOME_00,
  BUILDING_WAREHOUSE_00,
  GOOD_STONE,
  GOOD_WOOD,
  placeSandboxSite,
  spawnSandboxSettler,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 30;
const MAP_H = 22;
const DEPOT = { x: 15, y: 11 } as const;
const DEPOT_WOOD = 400;
const DEPOT_STONE = 400;
/** Equal distance from the depot, so no site is perpetually out-prioritised. */
const SITES: readonly { ref: number; x: number; y: number }[] = [
  { ref: BUILDING_BAKERY, x: 9, y: 7 },
  { ref: BUILDING_BAKERY, x: 21, y: 7 },
  { ref: BUILDING_HOME_00, x: 9, y: 15 },
  { ref: BUILDING_HOME_00, x: 21, y: 15 },
  { ref: BUILDING_ANIMAL_FARM, x: 15, y: 4 },
];
/** Loose crew beside the depot; idle builders move between sites with available work. */
const BUILDERS = 8;
const CREW = { x: 15, y: 13 } as const;
/** Posted to each bakery foundation before it stands; a home employs nobody. */
const SITE_BAKERS = 1;
const SITE_CARRIERS = 1;
const SITE_BREEDERS = 1;
/** Includes the longer northern supply route to the animal farm. */
const RUN_TICKS = 8_000;

const { Building, JobAssignment, Settler, UnderConstruction } = components;

function build(sim: Simulation): void {
  // Raw command so `initialGoods` seeds exactly wood + stone; `fillStock` would also stock production
  // goods that a finished bakery would then pull.
  const depot = cellAnchorNode(DEPOT.x, DEPOT.y);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BUILDING_WAREHOUSE_00,
    x: depot.hx,
    y: depot.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    force: true,
    initialGoods: [
      { good: GOOD_WOOD, amount: DEPOT_WOOD },
      { good: GOOD_STONE, amount: DEPOT_STONE },
    ],
  });
  for (const s of SITES) {
    const site = placeSandboxSite(sim, s.ref, s.x, s.y, HUMAN_PLAYER);
    if (s.ref === BUILDING_ANIMAL_FARM) spawnWorkersAtDoor(sim, site, SITE_BREEDERS);
    if (s.ref !== BUILDING_BAKERY) continue;
    spawnWorkersAtDoor(sim, site, SITE_BAKERS);
    spawnWorkersAtDoor(sim, site, SITE_CARRIERS, { jobType: JOB_CARRIER });
  }
  for (let i = 0; i < BUILDERS; i++) {
    spawnSandboxSettler(sim, JOB_BUILDER, CREW.x - 2 + (i % 5), CREW.y, HUMAN_PLAYER);
  }
}

/** A posting survives the rise, and nothing in the scene re-employs anyone. */
function staffOnFinished(sim: Simulation): number {
  let posted = 0;
  for (const e of sim.world.query(Settler, JobAssignment)) {
    const workplace = sim.world.get(e, JobAssignment).workplace;
    const building = sim.world.tryGet(workplace, Building);
    if (building !== undefined && building.built >= ONE) posted++;
  }
  return posted;
}

function unfinishedSites(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Building, UnderConstruction)) {
    if (sim.world.get(e, Building).built < ONE) n++;
  }
  return n;
}

export const constructionScene: SceneDefinition = {
  id: 'construction',
  seed: 7,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.9,
  checks: [
    {
      label: 'every foundation was raised to a finished building - the crew loop converged',
      predicate: (sim) => unfinishedSites(sim) === 0,
    },
    {
      label: 'every worker posted to a foundation still staffs the building it became',
      predicate: (sim) =>
        staffOnFinished(sim) ===
        SITES.filter((s) => s.ref === BUILDING_BAKERY).length * (SITE_BAKERS + SITE_CARRIERS) + SITE_BREEDERS,
    },
    {
      label: 'all five sites are present as finished buildings',
      predicate: (sim) => {
        let built = 0;
        for (const e of sim.world.query(Building)) {
          if (sim.world.get(e, Building).built >= ONE) built++;
        }
        // the sites + the depot warehouse
        return built === SITES.length + 1;
      },
    },
  ],
};
