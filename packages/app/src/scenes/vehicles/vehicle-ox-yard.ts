import { cellAnchorNode, components, type Entity, type Simulation } from '@open-northland/sim';
import { ANIMAL_TRIBE_CATTLE } from '../../catalog/animal-tribes.js';
import { grassTerrain } from '../../catalog/buildings.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import {
  BUILDING_ANIMAL_FARM,
  BUILDING_JOINERY_02,
  BUILDING_WAREHOUSE_00,
  placeBuiltSandboxBuilding,
  spawnAnimalHerdDirect,
  spawnWorkersAtDoor,
  VEHICLE_CART_NO_OX,
  VEHICLE_OXCART,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

const { Building, FarmAnimal, JobAssignment, ReleasedFrom, Settler, Stockpile } = components;

function build(sim: Simulation): void {
  const joinery = placeBuiltSandboxBuilding(sim, BUILDING_JOINERY_02, 9, 12);
  sim.world.mut(joinery, Stockpile).amounts.set(goodBySlug(sim, 'wood'), 10);
  const depot = cellAnchorNode(4, 20);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BUILDING_WAREHOUSE_00,
    x: depot.hx,
    y: depot.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    force: true,
    initialGoods: [{ good: goodBySlug(sim, 'wood'), amount: 60 }],
  });
  spawnWorkersAtDoor(sim, joinery, 1);
  for (const worker of sim.world.query(JobAssignment)) {
    if (sim.world.get(worker, JobAssignment).workplace !== joinery) continue;
    const good = goodBySlug(sim, 'oxcart');
    sim.enqueueSetup({ kind: 'setProductionGoods', entity: worker, goods: [good] });
  }
  // Only the first farm has a spare adult. Both must retain two cows after the first cart harnesses. The
  // farms employ no breeder, so they let their herds go, and each pair keeps to the farm it left.
  for (const [x, y, count] of [
    [23, 7, 3],
    [23, 17, 2],
  ] as const) {
    const farm = placeBuiltSandboxBuilding(sim, BUILDING_ANIMAL_FARM, x, y);
    const herd = spawnAnimalHerdDirect(sim, ANIMAL_TRIBE_CATTLE, x - 3, y + 3, {
      count,
      owner: HUMAN_PLAYER,
    });
    for (const animal of herd) sim.world.add(animal, FarmAnimal, { farm, summoner: null });
  }
}

/** Construction through the normal joinery orders, followed by a cow's walk from a farm. */
export const vehicleOxYardScene: SceneDefinition = {
  id: 'vehicle-ox-yard',
  seed: 17,
  terrain: grassTerrain(32, 24),
  build,
  progression: false,
  initialZoom: 0.7,
  runTicks: 10000,
  checks: [
    {
      label: 'the joiner keeps building while earlier carts wait for oxen',
      predicate: (sim) => {
        const carts = sim.vehiclesOf(HUMAN_PLAYER);
        return (
          carts.length >= 3 &&
          carts.filter((v) => v.vehicleType === VEHICLE_OXCART && v.harnessed).length === 1 &&
          carts.filter((v) => v.vehicleType === VEHICLE_CART_NO_OX && v.task === 'waitsForAnimal').length ===
            carts.length - 1
        );
      },
    },
    {
      label: 'each farm kept its breeding pair',
      predicate: (sim) => {
        const farmOf = (e: Entity): Entity | undefined =>
          sim.world.tryGet(e, FarmAnimal)?.farm ?? sim.world.tryGet(e, ReleasedFrom)?.farm;
        const farms = [...sim.world.query(Building)].filter(
          (e) => sim.world.get(e, Building).buildingType === BUILDING_ANIMAL_FARM,
        );
        return (
          farms.length === 2 &&
          farms.every((farm) => [...sim.world.query(Settler)].filter((e) => farmOf(e) === farm).length === 2)
        );
      },
    },
    {
      label: 'no ox cart was stocked as a ware',
      predicate: (sim) =>
        [...sim.world.query(Stockpile)].every(
          (e) => (sim.world.get(e, Stockpile).amounts.get(goodBySlug(sim, 'oxcart')) ?? 0) === 0,
        ),
    },
  ],
};
