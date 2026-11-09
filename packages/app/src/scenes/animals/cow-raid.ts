import {
  cellAnchorNode,
  cellOfNode,
  components,
  type Entity,
  nodeOfPosition,
  type Simulation,
  setupCommand,
  systems,
} from '@open-northland/sim';
import { ANIMAL_TRIBE_CATTLE, ANIMAL_TRIBE_SHEEP } from '../../catalog/animal-tribes.js';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_SCOUT } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_ANIMAL_FARM,
  buildingDoorNode,
  placeBuiltSandboxBuilding,
  spawnAnimalHerdDirect,
  spawnSettlerDirect,
  spawnWorkersAtDoor,
} from '../../game/sandbox/index.js';
import { holdsSometimeDuring } from '../runtime.js';
import type { SceneDefinition } from '../types.js';

/**
 * A cow raid: a red scout runs at a blue animal farm's cattle and turns back short of them. The cows in his
 * reach run, each its own way, and none is his; the sheep grazing beyond his reach keep grazing. Once he is
 * gone and they have calmed, the cows walk back to the farm, still in its herd. A breeder works the farm, so
 * it keeps its herd, and may thin each herd to its breeding pair meanwhile.
 */

const MAP_W = 44;
const MAP_H = 24;
const FARM = { x: 24, y: 6 } as const;
/** The herds and the scout's run are laid out in cells from the farm door's cell, so the browser's real
 *  footprint, whose door stands elsewhere, keeps the layout the headless run checks. The cattle graze on
 *  the scout's side of the door, the sheep beside it, both inside the farm's leash. */
const CATTLE_FROM_DOOR = { x: 0, y: 5 } as const;
const SHEEP_FROM_DOOR = { x: 4, y: 3 } as const;
const HERD_SIZE = 3;
/** The scout runs in from the west along the cattle's row and turns back the way he came, before any cow
 *  is in his claim reach. The herd has spread by then: two cows are in his scatter range, the third has
 *  grazed past it, in the headless run and the browser alike. */
const SCOUT_FROM_DOOR = { x: -10, y: 5 } as const;
const TURN_FROM_DOOR = { x: -2, y: 5 } as const;
const COWS_IN_REACH = 2;
const RUN_TICK = 1;
/** The return walk waits a tick behind the run, so it lands queued behind it. */
const RETURN_TICK = RUN_TICK + 1;
const SCRIPTED_SEQUENCE = Number.MAX_SAFE_INTEGER;
/** The scout's run and return, the flight, the calm and the walk home, with margin. */
const RUN_TICKS = 1600;

const { FarmAnimal, Frightened, Livestock, Owner, Position, Settler } = components;

function build(sim: Simulation): void {
  const farm = placeBuiltSandboxBuilding(sim, BUILDING_ANIMAL_FARM, FARM.x, FARM.y, HUMAN_PLAYER);
  const door = buildingDoorNode(sim, BUILDING_ANIMAL_FARM, FARM.x, FARM.y);
  const doorCell = cellOfNode(door.hx, door.hy);
  const fromDoor = (offset: { readonly x: number; readonly y: number }) => ({
    x: doorCell.cx + offset.x,
    y: doorCell.cy + offset.y,
  });
  for (const herd of [
    { tribe: ANIMAL_TRIBE_CATTLE, at: fromDoor(CATTLE_FROM_DOOR) },
    { tribe: ANIMAL_TRIBE_SHEEP, at: fromDoor(SHEEP_FROM_DOOR) },
  ]) {
    const animals = spawnAnimalHerdDirect(sim, herd.tribe, herd.at.x, herd.at.y, {
      count: HERD_SIZE,
      owner: HUMAN_PLAYER,
    });
    for (const animal of animals) sim.world.add(animal, FarmAnimal, { farm, summoner: null });
  }
  spawnWorkersAtDoor(sim, farm, 1);
  const from = fromDoor(SCOUT_FROM_DOOR);
  const scout = spawnSettlerDirect(sim, JOB_SCOUT, from.x, from.y, ENEMY_PLAYER);
  const turnCell = fromDoor(TURN_FROM_DOOR);
  const turn = cellAnchorNode(turnCell.x, turnCell.y);
  const back = cellAnchorNode(from.x, from.y);
  sim.enqueueAt(
    setupCommand({ kind: 'moveUnit', entity: scout, x: turn.hx, y: turn.hy }),
    RUN_TICK,
    SCRIPTED_SEQUENCE,
  );
  sim.enqueueAt(
    setupCommand({ kind: 'moveUnit', entity: scout, x: back.hx, y: back.hy, queued: true }),
    RETURN_TICK,
    SCRIPTED_SEQUENCE,
  );
}

function farmHerdOf(sim: Simulation, tribe: number): Entity[] {
  return [...sim.world.query(FarmAnimal, Settler, Owner)].filter(
    (e) => sim.world.get(e, Settler).tribe === tribe && sim.world.get(e, Owner).player === HUMAN_PLAYER,
  );
}

/** Whether the cows in the scout's reach are running from him at once, each on a flight of its own. */
function cattleScatter(sim: Simulation): boolean {
  const flights = new Set<number | null>();
  for (const cow of farmHerdOf(sim, ANIMAL_TRIBE_CATTLE)) {
    const flight = sim.world.tryGet(cow, Frightened);
    if (flight?.scatter === true) flights.add(flight.dest);
  }
  return flights.size >= COWS_IN_REACH;
}

function sheepRan(sim: Simulation): boolean {
  return farmHerdOf(sim, ANIMAL_TRIBE_SHEEP).some((e) => sim.world.has(e, Frightened));
}

/** Whether both herds keep at least their breeding pair, calm and inside their farm's leash. */
function homeAgain(sim: Simulation): boolean {
  const door = buildingDoorNode(sim, BUILDING_ANIMAL_FARM, FARM.x, FARM.y);
  const cattle = farmHerdOf(sim, ANIMAL_TRIBE_CATTLE);
  const sheep = farmHerdOf(sim, ANIMAL_TRIBE_SHEEP);
  return (
    cattle.length >= systems.BREEDING_PAIR &&
    sheep.length >= systems.BREEDING_PAIR &&
    [...cattle, ...sheep].every((e) => {
      if (sim.world.has(e, Frightened)) return false;
      const p = sim.world.get(e, Position);
      const at = nodeOfPosition(p.x, p.y);
      return Math.abs(at.hx - door.hx) + Math.abs(at.hy - door.hy) <= systems.FARM_HERD_LEASH_NODES;
    })
  );
}

export const cowRaidScene: SceneDefinition = {
  id: 'cow-raid',
  seed: 29,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the scout took none of the stock',
      predicate: (sim) =>
        [...sim.world.query(Livestock, Owner)].every((e) => sim.world.get(e, Owner).player === HUMAN_PLAYER),
    },
    {
      label: 'the cows in his reach ran, each its own way',
      predicate: () => holdsSometimeDuring(cowRaidScene, RUN_TICKS, cattleScatter),
    },
    {
      label: 'the sheep beyond his reach never ran',
      predicate: () => !holdsSometimeDuring(cowRaidScene, RUN_TICKS, sheepRan),
    },
    {
      label: 'both herds are back at their farm, calm',
      predicate: homeAgain,
    },
  ],
};
