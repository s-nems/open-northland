import type { Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_BUILDER } from '../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_DRUID_HUT,
  BUILDING_WAREHOUSE_00,
  GOOD_STONE,
  placeBuiltSandboxBuilding,
  placeBuiltSandboxBuildingAtNode,
  spawnSettlerDirect,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Upgrade ground under the road and wall tools: a level-1 druid hut still being built beside a finished
 * one, a store of stone and two builders. Both huts keep the ground their level 2 grows over, so a road
 * or wall line skirts it, and with either tool held that ground takes its own tint. The site stays a
 * site: its brick and pillar are nowhere on the map.
 */

const MAP_W = 30;
const MAP_H = 24;
const STORE_CELL = { x: 4, y: 6 } as const;
const BUILDER_CELLS = [
  { x: 7, y: 8 },
  { x: 8, y: 8 },
] as const;
const DRUID_SITE_NODE = { hx: 32, hy: 24 } as const;
const DRUID_HUT_NODE = { hx: 14, hy: 32 } as const;
const STORED_STONE = 30;
const RUN_TICKS = 600;

const { Building, Stockpile, UnderConstruction } = components;

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
  placeBuiltSandboxBuildingAtNode(sim, BUILDING_DRUID_HUT, DRUID_HUT_NODE.hx, DRUID_HUT_NODE.hy);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BUILDING_DRUID_HUT,
    x: DRUID_SITE_NODE.hx,
    y: DRUID_SITE_NODE.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    underConstruction: true,
    force: true,
  });
}

export const roadUpgradeScene: SceneDefinition = {
  id: 'road-upgrade',
  seed: 72,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 2,
  checks: [
    {
      label: 'one druid hut stands finished and one is still a level-1 site',
      predicate: (sim) => {
        const huts = [...sim.world.query(Building)].filter(
          (e) => sim.world.get(e, Building).buildingType === BUILDING_DRUID_HUT,
        );
        const sites = huts.filter((e) => sim.world.has(e, UnderConstruction));
        return huts.length === 2 && sites.length === 1;
      },
    },
  ],
};
