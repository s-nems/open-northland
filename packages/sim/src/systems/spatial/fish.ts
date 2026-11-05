import { FishSwarm } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { createRegionIndex, NO_REGION_EXTRA } from './region.js';

const index = createRegionIndex(
  FishSwarm,
  { verifier: 'fishSwarmRegionIndex', plural: 'fish swarms', component: 'FishSwarm', singular: 'swarm' },
  NO_REGION_EXTRA,
);

/** Fish swarms in the square around a half-cell, ascending by entity id. */
export function fishSwarmsNearNode(world: World, hx: number, hy: number, reach: number): Entity[] {
  return index.near(world, hx, hy, reach);
}

/** The swarms {@link fishSwarmsNearNode} lists, handed to `visit` in no particular order. */
export function visitFishSwarmsNear(
  world: World,
  hx: number,
  hy: number,
  reach: number,
  visit: (e: Entity) => void,
): void {
  index.visitNear(world, hx, hy, reach, visit);
}
