import { ANIMAL_WATER_TRIBES } from '@open-northland/data';
import { isWildlife, Position, Settler } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph, Traversal } from '../../nav/terrain/index.js';
import { entityNode } from '../spatial/nodes.js';
import { routeStartCell } from './route-start.js';

export function settlerTraversal(world: World, e: Entity): Traversal {
  return isWildlife(world, e) && ANIMAL_WATER_TRIBES.has(world.get(e, Settler).tribe) ? 'water' : 'land';
}

/** A swimming leg along a bank can lie between a wet and a dry bracket node. Replanning and
 * resting drives must keep the wet bracket, even when an interrupted leg stops on that seam. */
export function settlerMovementNode(world: World, terrain: TerrainGraph, e: Entity): NodeId {
  if (settlerTraversal(world, e) === 'land') return entityNode(world, terrain, e);
  const p = world.get(e, Position);
  return routeStartCell(terrain, p.x, p.y, 'water');
}
