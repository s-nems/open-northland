import { Simulation, type TerrainMap } from '../../src/index.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { houseContent } from './support.js';

export const POINT = { hx: 8, hy: 8 };
export const WALL = {
  typeId: 1,
  walk: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  build: [{ dx: 2, dy: 0 }],
  groups: ['blocker'] as const,
};
export function map(): TerrainMap {
  return {
    ...grassNodeMap(16, 16),
    landVertices: Array.from({ length: 256 }, (_, n) => n % 16 < 8),
    landscapes: {
      types: [WALL, { typeId: 2, walk: [], build: [], groups: ['smoke'] }],
      placements: [
        { id: 0, typeId: 1, ...POINT, level: 0 },
        { id: 1, typeId: 2, hx: 5, hy: 5, level: 0 },
      ],
    },
  };
}
export function fresh() {
  return new Simulation({ seed: 1, content: houseContent(), map: map() });
}
export function terrainOf(sim: Simulation) {
  if (sim.terrain === undefined) throw new Error('mapped fixture');
  return sim.terrain;
}
