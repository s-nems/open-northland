import { describe, expect, it } from 'vitest';
import { buildTerrainGraph, findPath, type NodeId, Rng, type TerrainGraph } from '../../../src/index.js';
import { ClusterRegions } from '../../../src/nav/pathfinding/cluster-regions.js';
import { CorridorRoutes } from '../../../src/nav/pathfinding/corridor-route.js';
import type { SearchStats } from '../../../src/nav/pathfinding/index.js';
import { testContent } from '../../fixtures/content.js';
import { StampedMask } from '../../fixtures/stamped-mask.js';

const GRASS = 0;
const WATER = 1;
const SIZE = 112;
const SEED = 11;
const ROUNDS = 40;
/** Wall segments toggled per round, each up to this many nodes long. */
const SEGMENTS_PER_ROUND = 6;
const MAX_SEGMENT = 24;
const WALKS_PER_ROUND = 8;
/** Rounds between road changes, which move the route factors under the held regions. */
const ROAD_EVERY = 4;
const ROAD_NODES = 60;
/** The side of an open field wide enough for a detour to flood. */
const FIELD = 176;

/** Grass with a river down the middle that two fords cross. */
function riverLand(): TerrainGraph {
  const typeIds = new Array<number>(SIZE * SIZE).fill(GRASS);
  const river = SIZE / 2;
  for (let y = 0; y < SIZE; y++) {
    if (y % 40 < 4) continue;
    typeIds[y * SIZE + river] = WATER;
    typeIds[y * SIZE + river + 1] = WATER;
  }
  return buildTerrainGraph(testContent(), { resolution: 'half-cell', width: SIZE, height: SIZE, typeIds });
}

function randomNode(rng: Rng, terrain: TerrainGraph): NodeId {
  return terrain.nodeAt(rng.int(SIZE), rng.int(SIZE));
}

/** Toggle a straight run of nodes, so walls rise and open across cluster borders. */
function toggleSegment(rng: Rng, terrain: TerrainGraph, mask: StampedMask): void {
  const x = rng.int(SIZE);
  const y = rng.int(SIZE);
  const length = 1 + rng.int(MAX_SEGMENT);
  const along = rng.int(2) === 0;
  for (let i = 0; i < length; i++) {
    const hx = along ? x + i : x;
    const hy = along ? y : y + i;
    if (terrain.inBounds(hx, hy)) mask.flip(terrain.nodeAt(hx, hy));
  }
}

function fresh(terrain: TerrainGraph, mask: StampedMask): CorridorRoutes {
  return new CorridorRoutes(terrain, new ClusterRegions(terrain, mask));
}

describe('CorridorRoutes', () => {
  it('held regions route as fresh ones after random mask flips and road changes', () => {
    const terrain = riverLand();
    const mask = new StampedMask(terrain);
    const rng = new Rng(SEED);
    const held = fresh(terrain, mask);
    let roadRevision = 0;
    let routed = 0;
    for (let round = 0; round < ROUNDS; round++) {
      for (let i = 0; i < SEGMENTS_PER_ROUND; i++) toggleSegment(rng, terrain, mask);
      if (round % ROAD_EVERY === 0) {
        const roads = Array.from({ length: ROAD_NODES }, () => randomNode(rng, terrain));
        roadRevision += 1;
        terrain.syncRoads(roadRevision, roads);
      }
      const cold = fresh(terrain, mask);
      for (let i = 0; i < WALKS_PER_ROUND; i++) {
        const start = randomNode(rng, terrain);
        const goal = randomNode(rng, terrain);
        const heldStats: SearchStats = { explored: 0 };
        const coldStats: SearchStats = { explored: 0 };
        const route = held.find(start, goal, heldStats);
        expect(route).toEqual(cold.find(start, goal, coldStats));
        expect(heldStats.explored).toBe(coldStats.explored);
        if (route !== null) routed += 1;
      }
      expect(held.regions.verify()).toEqual([]);
    }
    expect(routed).toBeGreaterThan(ROUNDS);
  });

  it('finds a route exactly when the map-wide search does, over open steps only', () => {
    const terrain = riverLand();
    const mask = new StampedMask(terrain);
    const rng = new Rng(SEED);
    const routes = fresh(terrain, mask);
    for (let round = 0; round < ROUNDS; round++) {
      for (let i = 0; i < SEGMENTS_PER_ROUND; i++) toggleSegment(rng, terrain, mask);
      for (let i = 0; i < WALKS_PER_ROUND; i++) {
        const start = randomNode(rng, terrain);
        const goal = randomNode(rng, terrain);
        // A blocked start steps off through the map-wide search, which the corridor hands it to.
        if (mask.has(start)) continue;
        const route = routes.find(start, goal, { explored: 0 });
        expect(route !== null).toBe(findPath(terrain, start, goal, mask) !== null);
        if (route === null) continue;
        expect(route[0]).toBe(start);
        expect(route.at(-1)).toBe(goal);
        for (let step = 1; step < route.length; step++) {
          const from = route[step - 1] as NodeId;
          expect(terrain.steps(from, mask).map((edge) => edge.node)).toContain(route[step]);
        }
      }
    }
  });

  it('routes a long walk round a wall for a fraction of the map-wide flood', () => {
    const terrain = buildTerrainGraph(testContent(), {
      resolution: 'half-cell',
      width: FIELD,
      height: FIELD,
      typeIds: new Array<number>(FIELD * FIELD).fill(GRASS),
    });
    const mask = new StampedMask(terrain);
    // A wall across the field that only its west end leaves open.
    const wallRow = FIELD / 2;
    for (let x = 8; x < FIELD; x++) mask.flip(terrain.nodeAt(x, wallRow));
    const start = terrain.nodeAt(FIELD - 10, wallRow - 3);
    const goal = terrain.nodeAt(FIELD - 60, wallRow + 3);
    const flood: SearchStats = { explored: 0 };
    const flat = findPath(terrain, start, goal, mask, flood, 'land', undefined, true);
    const spent: SearchStats = { explored: 0 };
    const route = fresh(terrain, mask).route(start, goal, spent);
    expect(route?.length).toBe(flat?.length);
    expect(spent.explored).toBeLessThan(flood.explored / 2);
  });

  it('refuses a goal walled into a pocket without settling the start side', () => {
    const terrain = riverLand();
    const mask = new StampedMask(terrain);
    // A closed square on the east bank, larger than one cluster.
    for (let i = 70; i <= 100; i++) {
      for (const node of [
        [i, 70],
        [i, 100],
        [70, i],
        [100, i],
      ] as const) {
        const id = terrain.nodeAt(node[0], node[1]);
        if (!mask.has(id)) mask.flip(id);
      }
    }
    const spent: SearchStats = { explored: 0 };
    expect(fresh(terrain, mask).route(terrain.nodeAt(4, 4), terrain.nodeAt(85, 85), spent)).toBeNull();
    expect(spent.explored).toBeLessThan(200);
  });

  it('leaves a short walk to the map-wide search', () => {
    const terrain = riverLand();
    const spent: SearchStats = { explored: 0 };
    const routes = fresh(terrain, new StampedMask(terrain));
    expect(routes.route(terrain.nodeAt(4, 8), terrain.nodeAt(20, 14), spent)).toBeNull();
    expect(spent.explored).toBe(0);
  });
});
