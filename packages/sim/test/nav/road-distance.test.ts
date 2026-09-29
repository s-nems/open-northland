import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/index.js';
import { type NodeId, nodeLatticeDistance, type TerrainGraph } from '../../src/nav/terrain/index.js';
import { fillRoadDistances, NO_ROAD_DISTANCE } from '../../src/nav/terrain/road-distance.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const WIDTH = 23;
const HEIGHT = 31;

function grid(): TerrainGraph {
  const terrain = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(WIDTH, HEIGHT) })
    .terrain;
  if (terrain === undefined) throw new Error('mapped sim has no terrain');
  return terrain;
}

describe('road distance field', () => {
  it('holds each node the lattice distance to its nearest road, the two raster passes exact', () => {
    const terrain = grid();
    const roads = [
      terrain.nodeAt(3, 4),
      terrain.nodeAt(20, 9),
      terrain.nodeAt(11, 27),
      terrain.nodeAt(0, 30),
    ];
    const field = new Int32Array(terrain.nodeCount);
    fillRoadDistances(field, WIDTH, HEIGHT, roads);
    for (let node = 0 as NodeId; node < terrain.nodeCount; node++) {
      const nearest = Math.min(...roads.map((road) => nodeLatticeDistance(terrain, node, road)));
      expect(field[node]).toBe(nearest);
    }
  });

  it('reads no road anywhere until one is laid', () => {
    const field = new Int32Array(WIDTH * HEIGHT);
    fillRoadDistances(field, WIDTH, HEIGHT, []);
    expect(field.every((distance) => distance === NO_ROAD_DISTANCE)).toBe(true);
    expect(grid().roadDistanceAt(0 as NodeId)).toBe(NO_ROAD_DISTANCE);
  });
});
