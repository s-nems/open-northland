import { components, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_BUILDER, JOB_CARRIER } from '../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  GOOD_STONE,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Road acceptance field: a store holding stone, two builders beside it, and a laid line of road sites
 * across open grass with a branch off its middle. The builders fetch a stone per claimed site, and each
 * stone paves its own node and the unclaimed neighbours no stone is bound for, so the plots turn into road
 * faster than one per stone. The store's carrier has nothing to bring in: a site's delivered stone is the
 * site's, not a ground pile. The road tool, a road site's panel and the builder pick all work here too.
 */

const MAP_W = 30;
const MAP_H = 20;
const ROAD_ROW = 18;
const ROAD_FROM_HX = 18;
const ROAD_TO_HX = 40;
const BRANCH_HX = 27;
const BRANCH_TO_HY = 30;
const STORE_CELL = { x: 5, y: 9 } as const;
const BUILDER_CELLS = [
  { x: 8, y: 11 },
  { x: 9, y: 11 },
] as const;
/** More than the line needs, so the run ends on laid road rather than an empty store. */
const STORED_STONE = 30;
export const ROADS_RUN_TICKS = 3_000;

const { RoadSite, Stockpile } = components;

/** The line's nodes: a row of half-cell nodes, then a column running down from its middle. */
export function roadSceneNodes(): readonly { readonly hx: number; readonly hy: number }[] {
  const nodes: { hx: number; hy: number }[] = [];
  for (let hx = ROAD_FROM_HX; hx <= ROAD_TO_HX; hx++) nodes.push({ hx, hy: ROAD_ROW });
  for (let hy = ROAD_ROW + 1; hy <= BRANCH_TO_HY; hy++) nodes.push({ hx: BRANCH_HX, hy });
  return nodes;
}

function build(sim: Simulation): void {
  const store = placeBuiltSandboxBuilding(
    sim,
    BUILDING_WAREHOUSE_00,
    STORE_CELL.x,
    STORE_CELL.y,
    HUMAN_PLAYER,
  );
  sim.world.mut(store, Stockpile).amounts.set(GOOD_STONE, STORED_STONE);
  for (const cell of BUILDER_CELLS) spawnSettlerDirect(sim, JOB_BUILDER, cell.x, cell.y, HUMAN_PLAYER);
  spawnWorkersAtDoor(sim, store, 1, { jobType: JOB_CARRIER });
  for (const node of roadSceneNodes()) {
    sim.enqueueSetup({
      kind: 'placeRoadSite',
      x: node.hx,
      y: node.hy,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
    });
  }
}

export function roadSitesLeft(sim: Simulation): number {
  return [...sim.world.query(RoadSite)].length;
}

export function roadNodesLaid(sim: Simulation): number {
  return systems.roadNodeCount(sim.world);
}

export const roadsScene: SceneDefinition = {
  id: 'roads',
  seed: 71,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: ROADS_RUN_TICKS,
  initialZoom: 2,
  checks: [
    {
      label: 'every ordered road site was paved',
      predicate: (sim) => roadSitesLeft(sim) === 0 && roadNodesLaid(sim) === roadSceneNodes().length,
    },
    {
      label: 'the stones paved more nodes than they numbered',
      predicate: (sim) => {
        const store = [...sim.world.query(Stockpile)].reduce(
          (left, e) => left + (sim.world.get(e, Stockpile).amounts.get(GOOD_STONE) ?? 0),
          0,
        );
        return STORED_STONE - store < roadNodesLaid(sim);
      },
    },
  ],
};
