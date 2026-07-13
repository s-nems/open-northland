import { grassCellMap as grassMap } from '../../fixtures/terrain.js';

export { grassMap };

import { MoveGoal, Owner, PathFollow, Position, Settler } from '../../../src/components/index.js';
import { fx, ZERO } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { nodeOfPosition, positionOfNode, Simulation } from '../../../src/index.js';
import { testContent } from '../../fixtures/content.js';

export const GRASS = 0;
export const WATER = 1;
export const VIKING = 1;
export const WOODCUTTER = 1;
export const SOLDIER = 31;
export const ANY_BUILDING_TYPE = 999;
export const P0 = 0;
export const P1 = 1;

export function sim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 6) });
}

export function settlerAt(
  simulation: Simulation,
  x: number,
  y: number,
  jobType: number,
  owner: number | null,
): Entity {
  const entity = simulation.world.create();
  simulation.world.add(entity, Position, positionOfNode(x, y));
  simulation.world.add(entity, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  if (owner !== null) simulation.world.add(entity, Owner, { player: owner });
  return entity;
}

export function orderTo(simulation: Simulation, entity: Entity, x: number, y: number): void {
  const terrain = simulation.terrain;
  if (terrain === undefined) throw new Error('orderTo needs a mapped sim');
  simulation.world.add(entity, MoveGoal, { cell: terrain.nodeAt(x, y) });
}

export function walkStraightTo(simulation: Simulation, entity: Entity, x: number, y: number): void {
  simulation.world.add(entity, PathFollow, {
    waypoints: [positionOfNode(x, y)],
    index: 0,
    speed: ZERO,
    hx: ZERO,
    hy: ZERO,
  });
}

export function nodeOf(simulation: Simulation, entity: Entity): { x: number; y: number } {
  const position = simulation.world.get(entity, Position);
  const node = nodeOfPosition(position.x, position.y);
  return { x: node.hx, y: node.hy };
}

export function wallAt(simulation: Simulation, hx: number, owner: number): Entity[] {
  const posts: Entity[] = [];
  for (let hy = 0; hy < 12; hy++) posts.push(settlerAt(simulation, hx, hy, SOLDIER, owner));
  return posts;
}
