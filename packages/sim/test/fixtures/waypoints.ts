import type { Waypoint } from '../../src/components/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import type { TerrainGraph } from '../../src/nav/terrain/index.js';

/** A route stop on lattice node `(hx, hy)`, as routing mints one. */
export function stopAt(terrain: TerrainGraph, hx: number, hy: number): Waypoint {
  return { ...positionOfNode(hx, hy), node: terrain.nodeAt(hx, hy) };
}
