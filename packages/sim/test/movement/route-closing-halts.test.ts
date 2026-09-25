import { describe, expect, it } from 'vitest';
import { PathFollow, PathRoute, Position, Settler, type Waypoint } from '../../src/components/index.js';
import { type Entity, positionOfNode, Simulation } from '../../src/index.js';
import type { TerrainGraph } from '../../src/nav/terrain/index.js';
import { invalidateRoutesThrough } from '../../src/systems/landscape/routes.js';
import { moveUnit } from '../../src/systems/orders/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const WOODCUTTER = 1;
const VIKING = 1;
const OWNER = 0;
const START = { hx: 4, hy: 4 };
/** Two diagonals the same way: (4,4) to (5,6) to (6,8), a midpoint stop inside each. */
const GOAL = { hx: 6, hy: 8 };
/** The node between the two diagonals, index 2 of the route. */
const JOINT = { hx: 5, hy: 6 };

/** A walker on its fresh route from {@link START} to {@link GOAL}, heading for the first midpoint. */
function walkerOnTwoDiagonals(): { sim: Simulation; terrain: TerrainGraph; walker: Entity } {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(16, 16) });
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: WOODCUTTER,
    x: START.hx,
    y: START.hy,
    tribe: VIKING,
    owner: OWNER,
  });
  sim.step();
  const walker = [...sim.world.query(Settler)][0];
  const terrain = sim.terrain;
  if (walker === undefined || terrain === undefined) throw new Error('expected a mapped walker');
  sim.world.add(walker, Position, positionOfNode(START.hx, START.hy));
  moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: walker, x: GOAL.hx, y: GOAL.hy });
  for (let tick = 0; tick < 5 && !sim.world.has(walker, PathFollow); tick++) sim.step();
  const nodes = stops(sim, walker).map((stop) => [terrain.xOf(stop.node), terrain.yOf(stop.node)]);
  expect(nodes).toEqual([
    [4, 4],
    [4, 5],
    [5, 6],
    [5, 7],
    [6, 8],
  ]);
  sim.world.mut(walker, PathFollow).index = 1;
  return { sim, terrain, walker };
}

function stops(sim: Simulation, walker: Entity): readonly Waypoint[] {
  return sim.world.get(walker, PathRoute).waypoints;
}

function onNodeCentre(stop: Waypoint | undefined, terrain: TerrainGraph): boolean {
  if (stop === undefined) return false;
  const centre = positionOfNode(terrain.xOf(stop.node), terrain.yOf(stop.node));
  return centre.x === stop.x && centre.y === stop.y;
}

describe('a closing ahead of a walker', () => {
  it('reads the node between two same-way diagonals as a node, not a midpoint', () => {
    const { sim, terrain, walker } = walkerOnTwoDiagonals();
    const route = stops(sim, walker);
    // The cell west of the joint node lines up as a flank only under the midpoint misreading.
    invalidateRoutesThrough(sim.world, terrain, new Set([terrain.nodeAt(JOINT.hx - 1, JOINT.hy)]));
    expect(stops(sim, walker)).toBe(route);
  });

  it('turns a walker heading for a midpoint back to the node it left, not onto the edge middle', () => {
    const { sim, terrain, walker } = walkerOnTwoDiagonals();
    invalidateRoutesThrough(sim.world, terrain, new Set([terrain.nodeAt(JOINT.hx, JOINT.hy)]));
    const route = stops(sim, walker);
    expect(route).toHaveLength(1);
    expect(onNodeCentre(route.at(-1), terrain)).toBe(true);
    expect(route[0]?.node).toBe(terrain.nodeAt(START.hx, START.hy));
    expect(sim.world.get(walker, PathFollow).index).toBe(0);
  });
});
