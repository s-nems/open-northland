import { components, type Entity, type Simulation } from '@open-northland/sim';
import { ANIMAL_TRIBE_CATTLE } from '../../catalog/animal-tribes.js';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_WOMAN } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_ANIMAL_FARM,
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_01,
  placeBuiltSandboxBuilding,
  spawnAnimalHerdDirect,
  spawnSettlerDirect,
  spawnWorkersAtDoor,
} from '../../game/sandbox/index.js';
import { buildingStock, goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

/**
 * Housewives empty a full animal farm: three homes stand beside a stocked headquarters in the west, the
 * farm further east with its meat shelf at the cap. The women walk past the headquarters to fetch the
 * farm's meat, so the breeder keeps butchering cattle for leather instead of carrying meat out.
 */

const MAP_W = 40;
const MAP_H = 24;
const HEADQUARTERS = { x: 8, y: 12 } as const;
const HOMES = [
  { x: 14, y: 6 },
  { x: 14, y: 18 },
  { x: 18, y: 12 },
] as const;
const FARM = { x: 30, y: 10 } as const;
const CATTLE = { x: 28, y: 16 } as const;
/** Grown cattle past the breeding pair, so the breeder has animals to butcher from the first tick. */
const HERD_SIZE = 6;
const HEADQUARTERS_FOOD = 40;
/** The sandbox animal farm's meat slot cap, filled so the shelf starts blocked. */
const FARM_MEAT_CAP = 30;
/** Stuffed past the 10-unit slot caps so breeding never waits on a supply chain. */
const STARTER_WATER = 40;
const STARTER_WHEAT = 80;
/** Three slaughters' leather, two hides a cow; a breeder carrying the meat out banks two slaughters'. */
const LEATHER_BANKED = 6;
const RUN_TICKS = 1500;

const { Residence, setStockAmount, Stockpile, FarmAnimal } = components;

function build(sim: Simulation): void {
  const hq = placeBuiltSandboxBuilding(
    sim,
    BUILDING_HEADQUARTERS,
    HEADQUARTERS.x,
    HEADQUARTERS.y,
    HUMAN_PLAYER,
  );
  setStockAmount(sim.world, hq, goodBySlug(sim, 'food_simple'), HEADQUARTERS_FOOD);
  for (const at of HOMES) {
    const home = placeBuiltSandboxBuilding(sim, BUILDING_HOME_01, at.x, at.y, HUMAN_PLAYER);
    setStockAmount(sim.world, home, goodBySlug(sim, 'food_simple'), 0);
    const woman = spawnSettlerDirect(sim, JOB_WOMAN, at.x - 2, at.y + 2, HUMAN_PLAYER);
    sim.world.add(woman, Residence, { home, since: 0 });
  }

  const farm = placeBuiltSandboxBuilding(sim, BUILDING_ANIMAL_FARM, FARM.x, FARM.y, HUMAN_PLAYER);
  const stock = sim.world.mut(farm, Stockpile).amounts;
  stock.set(goodBySlug(sim, 'water'), STARTER_WATER);
  stock.set(goodBySlug(sim, 'wheat'), STARTER_WHEAT);
  stock.set(goodBySlug(sim, 'meat'), FARM_MEAT_CAP);
  const herd = spawnAnimalHerdDirect(sim, ANIMAL_TRIBE_CATTLE, CATTLE.x, CATTLE.y, {
    count: HERD_SIZE,
    owner: HUMAN_PLAYER,
  });
  for (const animal of herd) sim.world.add(animal, FarmAnimal, { farm, summoner: null });
  spawnWorkersAtDoor(sim, farm, 1);
}

function larderFood(sim: Simulation): number {
  let food = 0;
  for (const e of sim.world.query(Residence)) {
    const home: Entity = sim.world.get(e, Residence).home;
    food += sim.world.tryGet(home, Stockpile)?.amounts.get(goodBySlug(sim, 'food_simple')) ?? 0;
  }
  return food;
}

export const farmLarderScene: SceneDefinition = {
  id: 'farm-larder',
  seed: 23,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.7,
  checks: [
    {
      label: "the women stocked their larders from the farm and left the nearer headquarters' food alone",
      predicate: (sim) =>
        larderFood(sim) > 0 && buildingStock(sim, BUILDING_HEADQUARTERS, 'food_simple') >= HEADQUARTERS_FOOD,
    },
    {
      label: 'the breeder kept butchering cattle and banked their leather',
      predicate: (sim) => buildingStock(sim, BUILDING_ANIMAL_FARM, 'leather') >= LEATHER_BANKED,
    },
  ],
};
