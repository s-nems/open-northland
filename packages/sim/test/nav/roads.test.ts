import { describe, expect, it, vi } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import {
  exportSaveGame,
  findPath,
  restoreSimulation,
  type SearchStats,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { fillRoadDistances, NO_NEAREST_ROAD, NO_ROAD_DISTANCE } from '../../src/nav/terrain/road-distance.js';
import { NO_ROAD_NETWORK } from '../../src/nav/terrain/road-networks.js';
import { isRoad, layRoad, roadRevision } from '../../src/systems/roads/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap, roughNodeMap, waterColumnMap } from '../fixtures/terrain.js';

const LAND = 2;
const SAND = 3;
const SNOW = 5;
const ROAD = 1;

/** The straight walk every route test asks for: 20 half columns east along row 10. */
const FROM = { hx: 0, hy: 10 };
const TO = { hx: 20, hy: 10 };
/** The row the road detour runs along, two diagonals north of the straight line. */
const ROAD_ROW = 6;
/** A map wide enough that a road at {@link FAR_ROAD_HX} lies farther from every node of the route than its goal. */
const FAR_MAP_WIDTH = 160;
const FAR_ROAD_HX = 140;
/** A street along the start's row, and a goal on that row far enough east that no street node helps. */
const NEAR_STREET_LENGTH = 12;
const FAR_GOAL_HX = 120;
/** The random laying run: a water-split map in cells, its batch count and the largest batch, a
 *  construction unit's node and six neighbours plus one. */
const RANDOM_MAP_CELLS = { width: 17, height: 13, waterColumn: 6 };
const RANDOM_BATCHES = 40;
const MAX_BATCH = 8;

function mappedSim(map: TerrainMap): { sim: Simulation; terrain: TerrainGraph } {
  const sim = new Simulation({ seed: 1, content: testContent(), map });
  if (sim.terrain === undefined) throw new Error('mapped sim has no terrain');
  return { sim, terrain: sim.terrain };
}

/** A road that leaves the straight line at FROM by two NE diagonals, runs east along ROAD_ROW and
 *  rejoins it at TO by two SE diagonals. */
function detourRoad(terrain: TerrainGraph): NodeId[] {
  const nodes = [terrain.nodeAt(1, 8)];
  for (let hx = 2; hx <= 18; hx++) nodes.push(terrain.nodeAt(hx, ROAD_ROW));
  nodes.push(terrain.nodeAt(19, 8), terrain.nodeAt(TO.hx, TO.hy));
  return nodes;
}

function route(terrain: TerrainGraph): NodeId[] {
  const path = findPath(terrain, terrain.nodeAt(FROM.hx, FROM.hy), terrain.nodeAt(TO.hx, TO.hy));
  if (path === null) throw new Error('no route across open ground');
  return path;
}

describe('road network', () => {
  it('reads a road node at resistance 1 and every other node at its map roughness', () => {
    const { sim, terrain } = mappedSim(roughNodeMap(4, 1, (hx) => (hx === 0 ? SNOW : SAND)));
    const [snow, sand] = [terrain.nodeAt(0, 0), terrain.nodeAt(1, 0)];
    layRoad(sim.world, terrain, [snow]);
    expect([terrain.resistanceAt(snow), terrain.resistanceAt(sand)]).toEqual([ROAD, SAND]);
    expect(terrain.roughnessAt(snow)).toBe(SNOW);
    expect([isRoad(sim.world, snow), terrain.isRoad(snow), isRoad(sim.world, sand)]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('bumps the revision once per change and never for a node already a road', () => {
    const { sim, terrain } = mappedSim(grassNodeMap(4, 1));
    expect(roadRevision(sim.world)).toBe(0);
    layRoad(sim.world, terrain, [terrain.nodeAt(0, 0), terrain.nodeAt(1, 0), terrain.nodeAt(0, 0)]);
    expect(roadRevision(sim.world)).toBe(1);
    layRoad(sim.world, terrain, [terrain.nodeAt(1, 0)]);
    expect(roadRevision(sim.world)).toBe(1);
    expect(() => layRoad(sim.world, terrain, [99 as NodeId])).toThrow(/out of range/);
    expect(roadRevision(sim.world)).toBe(1);
  });

  it('routes a walker along a road detour that costs less than the straight line over sand', () => {
    const { sim, terrain } = mappedSim(roughNodeMap(24, 14, () => SAND));
    expect(route(terrain).every((node) => terrain.yOf(node) === FROM.hy)).toBe(true);
    layRoad(sim.world, terrain, detourRoad(terrain));
    const onRoad = route(terrain);
    expect(onRoad).toContain(terrain.nodeAt(10, ROAD_ROW));
    expect(onRoad.every((node) => terrain.isRoad(node) || node === terrain.nodeAt(FROM.hx, FROM.hy))).toBe(
      true,
    );
  });

  it('routes a walker along a road detour over grass: the heuristic drops to the road-aware bound', () => {
    const { sim, terrain } = mappedSim(grassNodeMap(24, 14));
    layRoad(sim.world, terrain, detourRoad(terrain));
    const onRoad = route(terrain);
    expect(onRoad).toContain(terrain.nodeAt(10, ROAD_ROW));
    expect(onRoad.every((node) => terrain.isRoad(node) || node === terrain.nodeAt(FROM.hx, FROM.hy))).toBe(
      true,
    );
  });

  it('keeps the grass-weighted heuristic far from any road, settling only the straight line', () => {
    const { sim, terrain } = mappedSim(grassNodeMap(FAR_MAP_WIDTH, 14));
    const farRoad = Array.from({ length: 10 }, (_, i) => terrain.nodeAt(FAR_ROAD_HX + i, FROM.hy));
    layRoad(sim.world, terrain, farRoad);
    const stats: SearchStats = { explored: 0 };
    const path = findPath(
      terrain,
      terrain.nodeAt(FROM.hx, FROM.hy),
      terrain.nodeAt(TO.hx, TO.hy),
      undefined,
      stats,
    );
    expect(path?.every((node) => terrain.yOf(node) === FROM.hy)).toBe(true);
    expect(stats.explored).toBe(path?.length);
  });

  it('keeps the grass-weighted heuristic beside a road network the goal lies far from', () => {
    const { sim, terrain } = mappedSim(grassNodeMap(FAR_MAP_WIDTH, 14));
    // A street through the start that runs back west, away from a goal far to the east.
    const street = Array.from({ length: NEAR_STREET_LENGTH }, (_, i) => terrain.nodeAt(i, FROM.hy - 1));
    layRoad(sim.world, terrain, street);
    const stats: SearchStats = { explored: 0 };
    const goal = terrain.nodeAt(FAR_GOAL_HX, FROM.hy);
    const path = findPath(terrain, terrain.nodeAt(NEAR_STREET_LENGTH - 1, FROM.hy), goal, undefined, stats);
    expect(path?.every((node) => terrain.yOf(node) === FROM.hy)).toBe(true);
    expect(stats.explored).toBe(path?.length);
  });

  it('routes round snow on the straight line: every ground weighs by its resistance', () => {
    const snowBand = (hx: number, hy: number) => (hx >= 8 && hx <= 12 && hy >= 8 && hy <= 12 ? SNOW : LAND);
    const { terrain } = mappedSim(roughNodeMap(24, 20, snowBand));
    expect(route(terrain).some((node) => terrain.resistanceAt(node) === SNOW)).toBe(false);
  });

  it('hashes, saves and restores the roads, and a restored sim routes over them', () => {
    const build = (withRoad: boolean) => {
      const built = mappedSim(grassNodeMap(24, 14));
      if (withRoad) layRoad(built.sim.world, built.terrain, detourRoad(built.terrain));
      return built;
    };
    const live = build(true);
    expect(live.sim.hashState()).toBe(build(true).sim.hashState());
    expect(live.sim.hashState()).not.toBe(build(false).sim.hashState());
    const restored = restoreSimulation(exportSaveGame(live.sim), {
      content: testContent(),
      map: grassNodeMap(24, 14),
    });
    expect(restored.hashState()).toBe(live.sim.hashState());
    const terrain = restored.terrain;
    if (terrain === undefined) throw new Error('restored sim has no terrain');
    expect(route(terrain)).toEqual(route(live.terrain));
    const offRoad = terrain.nodeAt(TO.hx, 0);
    expect(terrain.roadDistanceAt(offRoad)).toBeLessThan(NO_ROAD_DISTANCE);
    expect(terrain.roadDistanceAt(offRoad)).toBe(live.terrain.roadDistanceAt(offRoad));
  });

  it('lowers the distances and road networks as roads are laid to exactly what a full rebuild computes, whatever the batching', () => {
    const { width, height, waterColumn } = RANDOM_MAP_CELLS;
    const { sim, terrain } = mappedSim(waterColumnMap(width, height, waterColumn));
    const rng = new Rng(7);
    const laid = new Set<NodeId>();
    const rebuilt = new Int32Array(terrain.nodeCount);
    const rebuiltNearest = new Int32Array(terrain.nodeCount);
    const syncs = vi.spyOn(terrain, 'syncRoads');
    for (let batch = 0; batch < RANDOM_BATCHES; batch++) {
      const size = 1 + rng.int(MAX_BATCH);
      // A cluster round a random centre, repeats and nodes already laid included.
      const hx = rng.int(terrain.width);
      const hy = rng.int(terrain.height);
      const nodes: NodeId[] = [];
      for (let i = 0; i < size; i++) {
        const x = Math.min(terrain.width - 1, Math.max(0, hx + rng.int(5) - 2));
        const y = Math.min(terrain.height - 1, Math.max(0, hy + rng.int(5) - 2));
        nodes.push(terrain.nodeAt(x, y));
      }
      layRoad(sim.world, terrain, nodes);
      for (const node of nodes) laid.add(node);
      fillRoadDistances(rebuilt, rebuiltNearest, terrain.width, terrain.height, laid);
      for (let node = 0 as NodeId; node < terrain.nodeCount; node++) {
        expect(terrain.roadDistanceAt(node)).toBe(rebuilt[node]);
        const nearest = rebuiltNearest[node] ?? NO_NEAREST_ROAD;
        const network = terrain.roadNetworkNear(node);
        if (nearest === NO_NEAREST_ROAD) expect(network).toBe(NO_ROAD_NETWORK);
        else expect(network).toBe(terrain.roadNetworkNear(nearest as NodeId));
      }
    }
    // Only the first road rebuilds the lanes; every later batch is extended in place.
    expect(syncs).toHaveBeenCalledTimes(1);
    const restored = restoreSimulation(exportSaveGame(sim), {
      content: testContent(),
      map: waterColumnMap(width, height, waterColumn),
    }).terrain;
    if (restored === undefined) throw new Error('restored sim has no terrain');
    for (let node = 0 as NodeId; node < terrain.nodeCount; node++) {
      expect(restored.roadDistanceAt(node)).toBe(rebuilt[node]);
      expect(restored.roadNetworkNear(node)).toBe(terrain.roadNetworkNear(node));
    }
  });
});
