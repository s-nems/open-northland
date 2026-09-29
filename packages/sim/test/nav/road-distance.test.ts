import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { Simulation } from '../../src/index.js';
import { type NodeId, nodeLatticeDistance, type TerrainGraph } from '../../src/nav/terrain/index.js';
import {
  fillRoadDistances,
  NO_NEAREST_ROAD,
  NO_ROAD_DISTANCE,
  ROAD_DISTANCE_REACH,
  RoadDistanceField,
} from '../../src/nav/terrain/road-distance.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const WIDTH = 23;
const HEIGHT = 31;
/** A strip long enough that a road at its west end leaves its east end past the field's reach. */
const LONG_WIDTH = 80;
const LONG_HEIGHT = 5;
/** The random laying run on the long strip: lays, and the most roads one lay adds. */
const RANDOM_LAYS = 60;
const MAX_LAY = 3;

function grid(width = WIDTH, height = HEIGHT): TerrainGraph {
  const terrain = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(width, height) })
    .terrain;
  if (terrain === undefined) throw new Error('mapped sim has no terrain');
  return terrain;
}

describe('road distance field', () => {
  it('holds each node the lattice distance to its nearest road and that road, the two raster passes exact', () => {
    const terrain = grid();
    // Two roads mirrored about column 11 tie for the nodes between them; the lower id wins.
    const roads = [
      terrain.nodeAt(3, 4),
      terrain.nodeAt(20, 9),
      terrain.nodeAt(11, 27),
      terrain.nodeAt(0, 30),
      terrain.nodeAt(7, 15),
      terrain.nodeAt(15, 15),
    ];
    const field = new Int32Array(terrain.nodeCount);
    const nearestRoads = new Int32Array(terrain.nodeCount);
    fillRoadDistances(field, nearestRoads, WIDTH, HEIGHT, roads);
    for (let node = 0 as NodeId; node < terrain.nodeCount; node++) {
      const distances = roads.map((road) => nodeLatticeDistance(terrain, node, road));
      const nearest = Math.min(...distances);
      expect(field[node]).toBe(nearest);
      expect(nearestRoads[node]).toBe(Math.min(...roads.filter((_, i) => distances[i] === nearest)));
    }
  });

  it('reads no road past the reach, and the exact distance within it', () => {
    const terrain = grid(LONG_WIDTH, LONG_HEIGHT);
    const road = terrain.nodeAt(0, 2);
    const field = new Int32Array(terrain.nodeCount);
    const nearestRoads = new Int32Array(terrain.nodeCount);
    fillRoadDistances(field, nearestRoads, LONG_WIDTH, LONG_HEIGHT, [road]);
    let pastReach = 0;
    for (let node = 0 as NodeId; node < terrain.nodeCount; node++) {
      const distance = nodeLatticeDistance(terrain, node, road);
      const reached = distance < ROAD_DISTANCE_REACH;
      if (!reached) pastReach++;
      expect(field[node]).toBe(reached ? distance : NO_ROAD_DISTANCE);
      expect(nearestRoads[node]).toBe(reached ? road : NO_NEAREST_ROAD);
    }
    expect(pastReach).toBeGreaterThan(0);
  });

  it('reads no road anywhere until one is laid', () => {
    const field = new Int32Array(WIDTH * HEIGHT);
    fillRoadDistances(field, new Int32Array(WIDTH * HEIGHT), WIDTH, HEIGHT, []);
    expect(field.every((distance) => distance === NO_ROAD_DISTANCE)).toBe(true);
    expect(grid().roadDistanceAt(0 as NodeId)).toBe(NO_ROAD_DISTANCE);
  });

  it('lowers to exactly what a full rebuild computes, nearest roads included, over random lays', () => {
    const rng = new Rng(5);
    const field = new RoadDistanceField(LONG_WIDTH, LONG_HEIGHT);
    const roads: number[] = [];
    const distances = new Int32Array(LONG_WIDTH * LONG_HEIGHT);
    const nearestRoads = new Int32Array(LONG_WIDTH * LONG_HEIGHT);
    field.rebuild(roads);
    for (let lay = 0; lay < RANDOM_LAYS; lay++) {
      const added = Array.from({ length: 1 + rng.int(MAX_LAY) }, () => rng.int(LONG_WIDTH * LONG_HEIGHT));
      roads.push(...added);
      field.lower(added, roads);
      fillRoadDistances(distances, nearestRoads, LONG_WIDTH, LONG_HEIGHT, roads);
      expect(field.distances).toEqual(distances);
      expect(field.nearest).toEqual(nearestRoads);
    }
  });
});
