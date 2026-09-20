import type { Entity, Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_WOMAN } from '../catalog/jobs.js';
import {
  BUILDING_DRUID_HUT,
  BUILDING_HOME_00,
  BUILDING_HOME_01,
  BUILDING_HOME_02,
  BUILDING_JOINERY_01,
  BUILDING_POTTERY_01,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import { buildingOfType, goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 42;
const MAP_H = 26;
const HOME_1 = { x: 21, y: 6 } as const;
const HOME_2 = { x: 21, y: 20 } as const;
const HOME_3 = { x: 28, y: 13 } as const;
const POTTERY = { x: 8, y: 8 } as const;
const JOINERY = { x: 8, y: 18 } as const;
const DRUID_HUT = { x: 36, y: 13 } as const;
const RUN_TICKS = 3600;

const { Building, HomeQuality, Residence, Stockpile, setStockAmount } = components;

function seed(sim: Simulation, building: Entity, slug: string, amount: number): void {
  setStockAmount(sim.world, building, goodBySlug(sim, slug), amount);
}

function output(sim: Simulation, buildingType: number, slug: string): number {
  const building = buildingOfType(sim, buildingType);
  if (building === null) return 0;
  return sim.world.get(building, Stockpile).amounts.get(goodBySlug(sim, slug)) ?? 0;
}

function quality(sim: Simulation, effect: 'cooking' | 'rest' | 'piety'): number {
  const home = buildingOfType(sim, BUILDING_HOME_02);
  return home === null ? 0 : (sim.world.tryGet(home, HomeQuality)?.[effect] ?? 0);
}

function build(sim: Simulation): void {
  const potteryEntity = placeBuiltSandboxBuilding(sim, BUILDING_POTTERY_01, POTTERY.x, POTTERY.y);
  const joineryEntity = placeBuiltSandboxBuilding(sim, BUILDING_JOINERY_01, JOINERY.x, JOINERY.y);
  const druidEntity = placeBuiltSandboxBuilding(sim, BUILDING_DRUID_HUT, DRUID_HUT.x, DRUID_HUT.y);
  placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, HOME_1.x, HOME_1.y);
  const home2Entity = placeBuiltSandboxBuilding(sim, BUILDING_HOME_01, HOME_2.x, HOME_2.y);
  sim.world.mut(home2Entity, Building).level = 1;
  const homeEntity = placeBuiltSandboxBuilding(sim, BUILDING_HOME_02, HOME_3.x, HOME_3.y);
  sim.world.mut(homeEntity, Building).level = 2;

  seed(sim, potteryEntity, 'mud', 10);
  seed(sim, potteryEntity, 'wood', 20);
  seed(sim, joineryEntity, 'wood', 20);
  seed(sim, druidEntity, 'mushroom', 10);
  spawnWorkersAtDoor(sim, potteryEntity, 2);
  spawnWorkersAtDoor(sim, joineryEntity, 2);
  spawnWorkersAtDoor(sim, druidEntity, 1);

  const homemaker = spawnSettlerDirect(sim, JOB_WOMAN, HOME_3.x - 2, HOME_3.y + 2);
  sim.world.add(homemaker, Residence, { home: homeEntity });
}

export const householdGoodsScene: SceneDefinition = {
  id: 'household-goods',
  seed: 41,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  needs: true,
  progression: false,
  checks: [
    {
      label: 'the upgraded pottery fired crockery from clay and wood',
      predicate: (sim) => output(sim, BUILDING_POTTERY_01, 'crockery') > 0 || quality(sim, 'cooking') > 0,
    },
    {
      label: 'the upgraded joinery made furniture from two wood',
      predicate: (sim) => output(sim, BUILDING_JOINERY_01, 'furniture') > 0 || quality(sim, 'rest') > 0,
    },
    {
      label: 'the druid brewed holy oil from mushrooms',
      predicate: (sim) => output(sim, BUILDING_DRUID_HUT, 'holy_oil') > 0 || quality(sim, 'piety') > 0,
    },
    {
      label: 'the homemaker stocked all three durable quality pools in the mature home',
      predicate: (sim) =>
        quality(sim, 'cooking') > 0 && quality(sim, 'rest') > 0 && quality(sim, 'piety') > 0,
    },
  ],
};
