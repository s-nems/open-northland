import { FishSwarm, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistance, nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { FishSwarmInput, NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System } from '../context.js';
import { fishSwarmsNearNode } from '../spatial/fish.js';
import { closer, ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../spatial/metric.js';

export const MAX_FISH_PER_SWARM = 30;
export const FISH_CAST_ATOMIC = 36;
export const FISH_CAUGHT_ATOMIC = 37;
export const FISH_FAILED_ATOMIC = 38;
export const FISH_SHORE_SEARCH_RADIUS = 20;
/** The original's fish reproduction fires exactly once per 2160 game ticks. */
export const FISH_REPRODUCTION_TICKS = 2160;

/**
 * Add authored swarms before tick zero, retaining source order as entity order. Original
 * behavior: a swarm stores at most 30 fish, the fisher's shore search covers 20 nodes, and reproduction
 * increments each positive non-full swarm once every 2160 ticks.
 */
export function addFishSwarms(
  world: World,
  terrain: TerrainGraph,
  swarms: readonly FishSwarmInput[],
): Entity[] {
  const added: Entity[] = [];
  for (const input of swarms) {
    if (!terrain.inBounds(input.hx, input.hy) || input.count <= 0) continue;
    const water = terrain.nodeAt(input.hx, input.hy);
    const e = world.create();
    world.add(e, Position, positionOfNode(input.hx, input.hy));
    world.add(e, FishSwarm, {
      count: Math.min(input.count, MAX_FISH_PER_SWARM),
      continent: input.continent,
      shore: nearestShore(terrain, water),
    });
    added.push(e);
  }
  return added;
}

/**
 * Resolve a deterministic reachable stand inside the source's catch radius. The original pathfinder
 * keeps up to eight reachable shore candidates and chooses one randomly; picking the nearest walkable
 * node is the deterministic approximation, while retaining its observed 20-half-cell search bound.
 */
function nearestShore(terrain: TerrainGraph, water: NodeId): NodeId | null {
  const origin = terrain.coordsOf(water);
  for (let radius = 1; radius <= FISH_SHORE_SEARCH_RADIUS; radius++) {
    const count = ringOffsetCount(radius);
    for (let i = 0; i < count; i++) {
      const x = origin.x + ringOffsetDx(radius, i);
      const y = origin.y + ringOffsetDy(radius, i);
      if (!terrain.inBounds(x, y)) continue;
      const node = terrain.nodeAt(x, y);
      if (terrain.isWalkable(node)) return node;
    }
  }
  return null;
}

/**
 * Remove one fish from the nearest nonempty swarm of the selected water continent. Looking up again at
 * catch time mirrors `GetOneFishFromNearestSwarm`: two fishers racing one last unit can let the later
 * completion fall through to another nearby swarm instead of failing against its stale planned target.
 */
export function takeFishNear(
  world: World,
  terrain: TerrainGraph,
  water: NodeId,
  continent: number,
): Entity | null {
  const origin = terrain.coordsOf(water);
  let best: { entity: Entity; node: NodeId; distance: number } | null = null;
  for (const entity of fishSwarmsNearNode(world, origin.x, origin.y, FISH_SHORE_SEARCH_RADIUS - 1)) {
    const swarm = world.get(entity, FishSwarm);
    if (swarm.count <= 0 || swarm.continent !== continent) continue;
    const at = world.get(entity, Position);
    const point = nodeOfPosition(at.x, at.y);
    const node = terrain.nodeAtClamped(point.hx, point.hy);
    const distance = hexDistance({ hx: origin.x, hy: origin.y }, point);
    if (distance >= FISH_SHORE_SEARCH_RADIUS) continue;
    if (best === null || closer(distance, node, best.distance, best.node)) {
      best = { entity, node, distance };
    }
  }
  if (best === null) return null;
  world.mut(best.entity, FishSwarm).count -= 1;
  return best.entity;
}

/** Positive swarms recover one fish every three game minutes, capped at the source's 30. */
export const fishReproductionSystem: System = (world, ctx) => {
  if (ctx.tick % FISH_REPRODUCTION_TICKS !== 0) return;
  for (const e of world.query(FishSwarm)) {
    const swarm = world.get(e, FishSwarm);
    if (swarm.count <= 0 || swarm.count >= MAX_FISH_PER_SWARM) continue;
    world.mut(e, FishSwarm).count += 1;
  }
};
