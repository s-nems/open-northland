import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import { hexDistanceBetween } from '../../src/nav/halfcell.js';
import { buildingBodyNodes } from '../../src/systems/conflict/target-node.js';
import { ctxOf } from './context.js';

/** How far `(x, y)` stands from `building`'s nearest wall: the distance the defence bands are read in. */
export function distanceFromWalls(sim: Simulation, building: Entity, x: number, y: number): number {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain graph');
  const body = buildingBodyNodes(sim.world, ctxOf(sim), terrain, building);
  return Math.min(...body.map((n) => hexDistanceBetween(x, y, terrain.xOf(n), terrain.yOf(n))));
}
