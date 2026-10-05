import { cellAnchorNode, components, type Simulation, systems } from '@open-northland/sim';
import { ANIMAL_TRIBE_CATTLE } from '../catalog/animal-tribes.js';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_ANIMAL_FARM,
  BUILDING_JOINERY_02,
  placeBuiltSandboxBuilding,
  spawnWorkersAtDoor,
  VEHICLE_CART_NO_OX,
  VEHICLE_OXCART,
} from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const { Building, FarmAnimal, JobAssignment, Livestock, Stockpile } = components;

function build(sim: Simulation): void {
  const joinery = placeBuiltSandboxBuilding(sim, BUILDING_JOINERY_02, 9, 12);
  sim.world.mut(joinery, Stockpile).amounts.set(goodBySlug(sim, 'wood'), 10);
  spawnWorkersAtDoor(sim, joinery, 1);
  for (const worker of sim.world.query(JobAssignment)) {
    if (sim.world.get(worker, JobAssignment).workplace !== joinery) continue;
    const good = goodBySlug(sim, 'oxcart');
    sim.enqueueSetup({ kind: 'setProductionGoods', entity: worker, goods: [good] });
    sim.enqueueSetup({ kind: 'setProductionCount', entity: worker, goodType: good, count: 2 });
  }
  // Only the first farm has a spare adult. Both must retain two cows after the first cart harnesses.
  for (const [x, y, count] of [
    [23, 7, 3],
    [23, 17, 2],
  ] as const) {
    const farm = placeBuiltSandboxBuilding(sim, BUILDING_ANIMAL_FARM, x, y);
    const at = cellAnchorNode(x - 3, y + 3);
    systems.spawnAnimalHerd(
      sim.world,
      {
        content: sim.content,
        rng: sim.rng,
        tick: sim.tick,
        events: sim.events,
        commands: sim.commands,
        ...(sim.terrain === undefined ? {} : { terrain: sim.terrain }),
      },
      { kind: 'spawnAnimalHerd', tribe: ANIMAL_TRIBE_CATTLE, x: at.hx, y: at.hy, count, owner: HUMAN_PLAYER },
    );
    for (const animal of sim.world.query(Livestock)) {
      if (!sim.world.has(animal, FarmAnimal)) sim.world.add(animal, FarmAnimal, { farm, summoner: null });
    }
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
  runTicks: 5000,
  checks: [
    {
      label: 'the joiner built two carts but only one received an ox',
      predicate: (sim) => {
        const carts = sim.vehiclesOf(HUMAN_PLAYER);
        return (
          carts.length === 2 &&
          carts.filter((v) => v.vehicleType === VEHICLE_OXCART && v.harnessed).length === 1 &&
          carts.filter((v) => v.vehicleType === VEHICLE_CART_NO_OX && v.task === 'waitsForAnimal').length ===
            1
        );
      },
    },
    {
      label: 'each farm kept its breeding pair',
      predicate: (sim) => {
        const farms = [...sim.world.query(Building)].filter(
          (e) => sim.world.get(e, Building).buildingType === BUILDING_ANIMAL_FARM,
        );
        return (
          farms.length === 2 &&
          farms.every(
            (farm) =>
              [...sim.world.query(FarmAnimal)].filter((e) => sim.world.get(e, FarmAnimal).farm === farm)
                .length === 2,
          )
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
