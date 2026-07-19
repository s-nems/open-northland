import type { Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, ONE } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_BAKERY,
  BUILDING_HOME_00,
  BUILDING_WAREHOUSE_00,
  GOOD_STONE,
  GOOD_WOOD,
  JOB_BUILDER,
  JOB_CARRIER,
  placeSandboxBuilding,
  spawnSandboxSettler,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The construction-rise scene: buildings placed as foundations and raised the normal way (carriers
 * haul wood + stone from a stocked depot, builders hammer the site up — the ConstructionSystem). Its
 * point is the visual reveal, not a new mechanic: a site draws its stacked construction-stage bobs
 * (foundation → scaffold → roof scaffold → body), each revealing per-pixel in its own `[fromPct,toPct]`
 * window, and a scaffold now stays drawn under the body that covers it instead of vanishing the instant
 * its own window ends (so the bakery's roof grows on the roof scaffold rather than the scaffold blinking
 * out at ~64%). Sites rise in parallel around a central depot so a human can catch the roof phase.
 *
 * Headless proves the sites finish (the crew loop converges); the browser is where a human watches each
 * site rise and confirms the scaffold hands off to the body smoothly (root AGENTS.md: pixels need a
 * human). The depot is seeded with wood + stone only (no production goods exist in the world), so a
 * finished bakery has nothing to pull and the whole crew stays on construction hauling.
 */

const MAP_W = 30;
const MAP_H = 22;
/** The material depot at map centre, seeded with plenty of wood + stone (nothing else). */
const DEPOT = { x: 15, y: 11 } as const;
const DEPOT_WOOD = 400;
const DEPOT_STONE = 400;
/** Foundations at equal distance from the depot so no site is perpetually out-prioritised. Bakeries
 *  foreground the reported roof-scaffold case; homes add another roof shape. */
const SITES: readonly { ref: number; x: number; y: number }[] = [
  { ref: BUILDING_BAKERY, x: 9, y: 7 },
  { ref: BUILDING_BAKERY, x: 21, y: 7 },
  { ref: BUILDING_HOME_00, x: 9, y: 15 },
  { ref: BUILDING_HOME_00, x: 21, y: 15 },
];
/** Spare crew beside the depot: builders hammer the sites, carriers haul each bill from the depot. */
const BUILDERS = 8;
const CARRIERS = 12;
const CREW = { x: 15, y: 13 } as const;
/** Headroom over the measured full-rise run — the shared crew raises all four foundations by ~tick
 *  4400 (deterministic, seed 7); 8000 keeps ~1.8× slack. */
const RUN_TICKS = 8_000;

const { Building, UnderConstruction } = components;

function build(sim: Simulation): void {
  // A built warehouse seeded with construction material only — raw command so `initialGoods` seeds
  // exactly wood + stone (fillStock would also stock production goods a finished bakery would then pull).
  const depot = cellAnchorNode(DEPOT.x, DEPOT.y);
  sim.enqueue({
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
    placeSandboxBuilding(sim, s.ref, s.x, s.y, HUMAN_PLAYER, { underConstruction: true });
  }
  for (let i = 0; i < BUILDERS; i++) {
    spawnSandboxSettler(sim, JOB_BUILDER, CREW.x - 2 + (i % 5), CREW.y, HUMAN_PLAYER);
  }
  for (let i = 0; i < CARRIERS; i++) {
    spawnSandboxSettler(sim, JOB_CARRIER, CREW.x - 3 + (i % 6), CREW.y + 1, HUMAN_PLAYER);
  }
}

/** Every construction site that has not yet finished (still carries the builder-work marker). */
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
      label: 'every foundation was raised to a finished building — the crew loop converged',
      predicate: (sim) => unfinishedSites(sim) === 0,
    },
    {
      label: 'all four commanded sites are present as finished buildings',
      predicate: (sim) => {
        let built = 0;
        for (const e of sim.world.query(Building)) {
          if (sim.world.get(e, Building).built >= ONE) built++;
        }
        // the four sites + the depot warehouse
        return built === SITES.length + 1;
      },
    },
  ],
};
