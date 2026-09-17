import type { Entity, Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import {
  BUILDING_DRUID_HUT,
  BUILDING_DRUID_HUT_01,
  placeBuiltSandboxBuilding,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import { buildingOfType, goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 40;
const MAP_H = 24;
// Far enough apart that the level-2 hut's wider footprint never touches the first hut's yard.
const HUT = { x: 11, y: 12 } as const;
const HUT_01 = { x: 28, y: 12 } as const;

/** Crew from the extracted `logicworker 30` slots: one druid downstairs, two in the potion hut. */
const DRUIDS = 1;
const DRUIDS_01 = 2;

/** One filled input slot per ingredient (`logicstock <good> 10`), so every recipe can start at once. */
const INGREDIENTS = 10;

/** A batch is one `DEFAULT_RECIPE_TICKS` cycle from the door, so this covers several per hut. */
const RUN_TICKS = 1500;
/** Not 1, so `cameraFor` frames both huts. */
const INITIAL_ZOOM = 0.7;

const { Stockpile, setStockAmount } = components;

const POTION_SLUGS = [
  'potion_food_small',
  'potion_food_big',
  'potion_stamina_small',
  'potion_stamina_big',
  'potion_heal_small',
  'potion_heal_big',
] as const;

function stock(sim: Simulation, building: Entity, slugs: readonly string[]): void {
  for (const slug of slugs) setStockAmount(sim.world, building, goodBySlug(sim, slug), INGREDIENTS);
}

function build(sim: Simulation): void {
  const hut = placeBuiltSandboxBuilding(sim, BUILDING_DRUID_HUT, HUT.x, HUT.y);
  const hut01 = placeBuiltSandboxBuilding(sim, BUILDING_DRUID_HUT_01, HUT_01.x, HUT_01.y);
  stock(sim, hut, ['mushroom']);
  stock(sim, hut01, ['mushroom', 'water', 'herb', 'coin']);
  spawnWorkersAtDoor(sim, hut, DRUIDS);
  spawnWorkersAtDoor(sim, hut01, DRUIDS_01);
}

function stocked(sim: Simulation, buildingType: number, slug: string): number {
  const building = buildingOfType(sim, buildingType);
  if (building === null) return 0;
  return sim.world.get(building, Stockpile).amounts.get(goodBySlug(sim, slug)) ?? 0;
}

export const alchemyScene: SceneDefinition = {
  id: 'alchemy',
  seed: 30,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  // The potions sit behind `needforgood` experience gates in real content; the scene shows the huts at
  // work, not the druid's schooling.
  progression: false,
  checks: [
    {
      label: 'the level-1 hut brewed holy oil from its mushrooms',
      predicate: (sim) => stocked(sim, BUILDING_DRUID_HUT, 'holy_oil') > 0,
    },
    {
      label: 'the level-2 hut brewed at least one potion from water, mushroom, herb and coin',
      predicate: (sim) => POTION_SLUGS.some((slug) => stocked(sim, BUILDING_DRUID_HUT_01, slug) > 0),
    },
  ],
};
