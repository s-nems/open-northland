import { cellAnchorNode, components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SCOUT } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { ANIMAL_TRIBE_CATTLE, ANIMAL_TRIBE_SHEEP } from '../game/sandbox/content/catalog/animals.js';
import {
  BUILDING_ANIMAL_FARM,
  buildingDoorNode,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import { computeLifeHearts } from '../view/projections/life-hearts.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 40;
const MAP_H = 28;
const INITIAL_ZOOM = 0.8;
/** The claim, the walk home, breeding at 180 ticks a calf, the 3600-tick childhood, and the slaughter
 *  that follows the first grown calf, with margin. */
const RUN_TICKS = 5200;

const FARM = { x: 26, y: 8 } as const;
const BREEDERS = 2;
/** Far enough from the farm that the walk home is visible. */
const SHEEP_BIRTH = { x: 8, y: 20 } as const;
const CATTLE_BIRTH = { x: 30, y: 21 } as const;

/** Each spawned wild herd's size (`maximumgroupsize` for both species), so a bigger herd at the farm can
 *  only have been bred there. */
const SPAWNED_HERD_SIZE = 6;

/** Stuffed past the 10-unit slot caps so the breeding never waits on a supply chain. */
const STARTER_WATER = 40;
const STARTER_WHEAT = 80;

const { Building, FarmAnimal, Health, Owner, Position, Settler, StayPoint, Stockpile, YoungAnimal } =
  components;

function build(sim: Simulation): void {
  const farm = placeBuiltSandboxBuilding(sim, BUILDING_ANIMAL_FARM, FARM.x, FARM.y, HUMAN_PLAYER);
  const s = sim.world.mut(farm, Stockpile);
  s.amounts.set(goodBySlug(sim, 'water'), STARTER_WATER);
  s.amounts.set(goodBySlug(sim, 'wheat'), STARTER_WHEAT);
  spawnWorkersAtDoor(sim, farm, BREEDERS);

  for (const herd of [
    { tribe: ANIMAL_TRIBE_SHEEP, at: SHEEP_BIRTH },
    { tribe: ANIMAL_TRIBE_CATTLE, at: CATTLE_BIRTH },
  ]) {
    const node = cellAnchorNode(herd.at.x, herd.at.y);
    sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: herd.tribe, x: node.hx, y: node.hy });
    // The claim reaches two map points, so the scout spawns amid the herd.
    spawnSandboxSettler(sim, JOB_SCOUT, herd.at.x, herd.at.y, HUMAN_PLAYER);
  }
}

function ownedOf(sim: Simulation, tribe: number): Entity[] {
  const owned: Entity[] = [];
  for (const e of sim.world.query(Settler, Owner)) {
    if (sim.world.get(e, Settler).tribe === tribe && sim.world.get(e, Owner).player === HUMAN_PLAYER) {
      owned.push(e);
    }
  }
  return owned;
}

/** Every sheep and cow on the map, claimed or wild. */
function animalIds(sim: Simulation): Set<number> {
  const ids = new Set<number>();
  for (const e of sim.world.query(Settler)) {
    const tribe = sim.world.get(e, Settler).tribe;
    if (tribe === ANIMAL_TRIBE_SHEEP || tribe === ANIMAL_TRIBE_CATTLE) ids.add(e);
  }
  return ids;
}

function theFarm(sim: Simulation): Entity | null {
  for (const e of sim.world.query(Building, Stockpile)) {
    if (sim.world.get(e, Building).buildingType === BUILDING_ANIMAL_FARM) return e;
  }
  return null;
}

function farmStock(sim: Simulation, slug: string): number {
  const farm = theFarm(sim);
  if (farm === null) return 0;
  return sim.world.get(farm, Stockpile).amounts.get(goodBySlug(sim, slug)) ?? 0;
}

/** The farm's herd of one species, and how many of them were born there and are still young. */
function herdOf(sim: Simulation, tribe: number): { all: Entity[]; young: Entity[] } {
  const farm = theFarm(sim);
  const all = farm === null ? [] : ownedOf(sim, tribe).filter((e) => holdsFor(sim, e, farm));
  return { all, young: all.filter((e) => sim.world.has(e, YoungAnimal)) };
}

function holdsFor(sim: Simulation, animal: Entity, farm: Entity): boolean {
  return sim.world.tryGet(animal, FarmAnimal)?.farm === farm;
}

export const livestockScene: SceneDefinition = {
  id: 'livestock',
  seed: 17,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the scouts claimed sheep and cattle in passing',
      predicate: (sim) =>
        ownedOf(sim, ANIMAL_TRIBE_SHEEP).length >= 1 && ownedOf(sim, ANIMAL_TRIBE_CATTLE).length >= 1,
    },
    {
      label: 'the breeders took both species into the farm herd and the rows count it',
      predicate: (sim) => {
        const farm = theFarm(sim);
        if (farm === null) return false;
        const stock = sim.world.get(farm, Stockpile).amounts;
        return [
          { tribe: ANIMAL_TRIBE_SHEEP, slug: 'sheep' },
          { tribe: ANIMAL_TRIBE_CATTLE, slug: 'cattle' },
        ].every(({ tribe, slug }) => {
          const herd = herdOf(sim, tribe).all.length;
          return herd > 0 && (stock.get(goodBySlug(sim, slug)) ?? 0) === herd;
        });
      },
    },
    {
      label: 'both herds bred: more animals than the scouts ever claimed, young among them',
      predicate: (sim) =>
        [ANIMAL_TRIBE_SHEEP, ANIMAL_TRIBE_CATTLE].every((tribe) => {
          const herd = herdOf(sim, tribe);
          // The claim can only ever have taken the spawned herd; anything past it was bred here.
          return herd.all.length > SPAWNED_HERD_SIZE || herd.young.length > 0;
        }),
    },
    {
      label: 'a slaughter put wool, leather, and meat in the farm',
      predicate: (sim) =>
        farmStock(sim, 'wool') >= 1 && farmStock(sim, 'leather') >= 1 && farmStock(sim, 'meat') >= 1,
    },
    {
      label: 'the herd keeps to its leash around the farm door',
      predicate: (sim) => {
        const terrain = sim.terrain;
        if (terrain === undefined) return false;
        const door = buildingDoorNode(sim, BUILDING_ANIMAL_FARM, FARM.x, FARM.y);
        const at = terrain.coordsOf(terrain.nodeAtClamped(door.hx, door.hy));
        const herd = [...herdOf(sim, ANIMAL_TRIBE_SHEEP).all, ...herdOf(sim, ANIMAL_TRIBE_CATTLE).all];
        return (
          herd.length > 0 &&
          herd.every((e) => {
            const stay = sim.world.tryGet(e, StayPoint)?.cell;
            if (stay === undefined) return false;
            const spot = terrain.coordsOf(stay);
            // Every farm animal is anchored on the door itself, the original's birth point.
            return spot.x === at.x && spot.y === at.y;
          })
        );
      },
    },
    {
      label: 'the heart projection marks exactly the claimed animals (no wild one) and mirrors their life',
      predicate: (sim) => {
        const claimed = [...ownedOf(sim, ANIMAL_TRIBE_SHEEP), ...ownedOf(sim, ANIMAL_TRIBE_CATTLE)];
        const poolOf = new Map<number, { hitpoints: number; max: number }>();
        for (const e of claimed) {
          const h = sim.world.tryGet(e, Health);
          if (h === undefined) return false;
          poolOf.set(e, h);
        }
        const hearts = computeLifeHearts(sim.snapshot(), {
          isLivestockTribe: (tribe) => systems.isCatchableAnimal(sim.content, tribe),
        });
        // People get hearts by their own rule, so this check holds the projection to the herds.
        const animals = animalIds(sim);
        const animalHearts = hearts.filter((heart) => animals.has(heart.id));
        return (
          claimed.length > 0 &&
          animalHearts.length === claimed.length &&
          animalHearts.every((heart) => {
            const pool = poolOf.get(heart.id);
            return pool !== undefined && heart.life === pool.hitpoints / pool.max;
          })
        );
      },
    },
    {
      label: 'animals still wild at run end are unhurt (nothing drains a creature nobody claimed)',
      predicate: (sim) => {
        for (const e of sim.world.query(Settler, Position)) {
          const tribe = sim.world.get(e, Settler).tribe;
          if (tribe !== ANIMAL_TRIBE_SHEEP && tribe !== ANIMAL_TRIBE_CATTLE) continue;
          if (sim.world.has(e, Owner)) continue;
          const h = sim.world.tryGet(e, Health);
          if (h === undefined || h.hitpoints < h.max) return false;
        }
        return true;
      },
    },
  ],
};
