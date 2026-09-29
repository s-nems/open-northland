import { parseContentSet } from '@open-northland/data';
import {
  addPerson,
  Building,
  Owner,
  Position,
  RoadSite,
  Stockpile,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  fx,
  nodeOfPosition,
  ONE,
  playerCommand,
  positionOfNode,
  type ScriptLandscapeType,
  Simulation,
} from '../../src/index.js';
import type { TerrainMap } from '../../src/nav/terrain/index.js';
import { isRoad } from '../../src/systems/roads/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

// The road site scenes' content, map and helpers, shared by the road site and build run tests.

export const VIKING = 1;
export const HUMAN = 0;
export const RIVAL = 1;
export const STONE = 1;
const WOOD = 2;
const IDLE = 0;
const BUILDER = 7;
const BUILD_HOUSE_ATOMIC = 39;
export const BUILD_ROAD_ATOMIC = 41;
export const BUILD_WALL_ATOMIC = 42;
export const BUILD_ROAD_CLIP = 'viking_builder_build_road';
const BUILD_WALL_CLIP = 'viking_builder_build_wall';
/** The mod's build-road and build-wall clip length. */
export const BUILD_CLIP_TICKS = 15;
/** Ticks per authored clip tick the sim plays a one-strike site's clip at. */
export const ONE_STRIKE_CLIP_PACE = 2;
/** How long a road or wall strike runs. */
export const BUILD_STRIKE_TICKS = BUILD_CLIP_TICKS * ONE_STRIKE_CLIP_PACE;
const STORE = 1;
const HOUSE = 2;
const GRASS = 0;
export const ROW = 6;
export const STORE_HX = 4;
export const MAP_WIDTH = 48;
export const MAP_HEIGHT = 16;
/** Long enough for a builder to fetch a stone across the test map and swing once. */
export const BUILD_TICKS = 3000;
export const FAR_HX = 40;
export const HUT = 3;
/** A two-node body over which a road site is cancelled, with a one-node margin a road may keep. */
const HUT_FOOTPRINT = {
  blocked: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  familyBody: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  reserved: [-1, 0, 1, 2].flatMap((dy) => [-1, 0, 1, 2].map((dx) => ({ dx, dy }))),
  door: { dx: -1, dy: 0 },
};
export const HANDCART = 1;
const HANDCART_JOB = 50;
const HANDCART_SLOTS = 15;
const HANDCART_HITPOINTS = 100;
/** A disc one node out from its anchor, so the cart covers its neighbours too. */
const HANDCART_LOGIC_SIZE = 1;

export const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [],
  groups: [],
  wall: { maxHitpoints: 100, repairPerStrike: 3, construction: [{ goodType: WOOD, amount: 1 }] },
};

function roadContent() {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
      { typeId: WOOD, id: 'wood' },
    ],
    jobs: [
      { typeId: IDLE, id: 'idle' },
      {
        typeId: BUILDER,
        id: 'builder',
        allowedAtomics: [BUILD_HOUSE_ATOMIC, BUILD_ROAD_ATOMIC, BUILD_WALL_ATOMIC],
      },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [
          { jobType: BUILDER, atomicId: BUILD_ROAD_ATOMIC, animation: BUILD_ROAD_CLIP },
          { jobType: BUILDER, atomicId: BUILD_WALL_ATOMIC, animation: BUILD_WALL_CLIP },
        ],
      },
    ],
    vehicles: [
      {
        typeId: HANDCART,
        id: 'handcart',
        jobId: HANDCART_JOB,
        stockSlots: HANDCART_SLOTS,
        logicSize: HANDCART_LOGIC_SIZE,
        passengerJobs: [],
        hitpoints: HANDCART_HITPOINTS,
      },
    ],
    atomicAnimations: [
      { id: BUILD_ROAD_CLIP, name: BUILD_ROAD_CLIP, length: BUILD_CLIP_TICKS },
      { id: BUILD_WALL_CLIP, name: BUILD_WALL_CLIP, length: BUILD_CLIP_TICKS },
    ],
    buildings: [
      {
        typeId: STORE,
        id: 'headquarters',
        kind: 'storage',
        stock: [
          { goodType: STONE, capacity: 20 },
          { goodType: WOOD, capacity: 20 },
        ],
      },
      {
        typeId: HOUSE,
        id: 'home_small',
        kind: 'home',
        homeSize: 1,
        construction: [{ goodType: STONE, amount: 1 }],
      },
      {
        typeId: HUT,
        id: 'hut',
        kind: 'home',
        homeSize: 1,
        construction: [{ goodType: STONE, amount: 1 }],
        footprint: HUT_FOOTPRINT,
      },
    ],
  });
}

export function roadSim(seed = 1): Simulation {
  const map: TerrainMap = grassNodeMap(MAP_WIDTH, MAP_HEIGHT);
  const sim = new Simulation({
    seed,
    content: roadContent(),
    map: { ...map, landscapes: { types: [WALL], placements: [] } },
  });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: HUMAN, tribes: [VIKING] });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: RIVAL, tribes: [VIKING] });
  return sim;
}

export function storeAt(sim: Simulation, hx: number, stone = 10): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, ROW));
  sim.world.add(e, Building, { buildingType: STORE, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, {
    amounts: new Map([
      [STONE, stone],
      [WOOD, 10],
    ]),
  });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

export function houseSiteAt(sim: Simulation, hx: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, ROW));
  sim.world.add(e, Building, { buildingType: HOUSE, tribe: VIKING, built: fx.fromInt(0), level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

export function builderAt(sim: Simulation, hx: number, hy = ROW): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: BUILDER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

/** Order road sites through the seat's own command path and apply them. */
export function orderRoads(
  sim: Simulation,
  nodes: readonly { hx: number; hy: number }[],
  player = HUMAN,
): void {
  for (const { hx, hy } of nodes) {
    sim.enqueue(playerCommand(player, { kind: 'placeRoadSite', x: hx, y: hy, tribe: VIKING }));
  }
  sim.step();
}

export function siteAt(sim: Simulation, hx: number, hy: number): Entity | undefined {
  return [...sim.world.query(RoadSite, Position)].find((e) => {
    const n = nodeOfPosition(sim.world.get(e, Position).x, sim.world.get(e, Position).y);
    return n.hx === hx && n.hy === hy;
  });
}

export function roadAt(sim: Simulation, hx: number, hy: number): boolean {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('expected a mapped simulation');
  return isRoad(sim.world, terrain.nodeAt(hx, hy));
}

export function roadMapOf(): TerrainMap {
  return { ...grassNodeMap(MAP_WIDTH, MAP_HEIGHT), landscapes: { types: [WALL], placements: [] } };
}
