import { cellAnchorNode, components, nodeOfPosition, type Simulation, systems } from '@open-northland/sim';
import { ANIMAL_TRIBE_CATTLE, ANIMAL_TRIBE_SHEEP } from '../catalog/animal-tribes.js';
import { grassTerrain } from '../catalog/buildings.js';
import {
  BUILDING_HOME_00,
  BUILDING_WAREHOUSE_00,
  buildingDoorNode,
  placeBuiltSandboxBuilding,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const { Livestock, Owner, Position, StayPoint } = components;
const YARDS = [
  { owner: 0, buildingType: BUILDING_WAREHOUSE_00, y: 8 },
  { owner: 1, buildingType: BUILDING_HOME_00, y: 25 },
] as const;
const COLUMNS = [9, 31] as const;

function build(sim: Simulation): void {
  for (const yard of YARDS) {
    for (const x of COLUMNS) {
      placeBuiltSandboxBuilding(sim, yard.buildingType, x, yard.y, yard.owner);
      const at = cellAnchorNode(x, yard.y + 9);
      for (const tribe of [ANIMAL_TRIBE_SHEEP, ANIMAL_TRIBE_CATTLE]) {
        sim.enqueueSetup({
          kind: 'spawnAnimalHerd',
          tribe,
          x: at.hx,
          y: at.hy,
          count: 2,
          owner: yard.owner,
        });
      }
    }
  }
}

function gatheredAtYards(sim: Simulation, owner: number): boolean {
  const terrain = sim.terrain;
  const yard = YARDS.find((entry) => entry.owner === owner);
  if (terrain === undefined || yard === undefined) return false;
  const counts = [0, 0];
  for (const animal of sim.world.query(Livestock, Owner, Position, StayPoint)) {
    if (sim.world.get(animal, Owner).player !== owner) continue;
    const spot = terrain.coordsOf(sim.world.get(animal, StayPoint).cell);
    const position = sim.world.get(animal, Position);
    const at = nodeOfPosition(position.x, position.y);
    if (Math.abs(at.hx - spot.x) + Math.abs(at.hy - spot.y) > 5) return false;
    const column = COLUMNS.findIndex((x) => {
      const door = buildingDoorNode(sim, yard.buildingType, x, yard.y);
      return Math.abs(spot.x - door.hx) + Math.abs(spot.y - door.hy) <= systems.LIVESTOCK_GRAZE_RANGE_NODES;
    });
    if (column < 0) return false;
    counts[column] = (counts[column] ?? 0) + 1;
  }
  return counts.every((count) => count === 4);
}

export const livestockYardScene: SceneDefinition = {
  id: 'livestock-yard',
  seed: 17,
  terrain: grassTerrain(42, 40),
  build,
  initialZoom: 0.5,
  runTicks: 1200,
  checks: [
    {
      label: 'without headquarters sheep and cattle gather beside their nearer warehouse',
      predicate: (sim) => gatheredAtYards(sim, 0),
    },
    {
      label: 'without storage sheep and cattle gather beside their nearer owned home',
      predicate: (sim) => gatheredAtYards(sim, 1),
    },
  ],
};
