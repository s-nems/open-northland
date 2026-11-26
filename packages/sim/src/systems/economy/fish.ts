import { type ContentSet, footprintCellDx } from '@open-northland/data';
import { FishSwarm, Position, type PositionState, positionRecord } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistance, nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { FishSwarmInput, NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System } from '../context.js';
import { type HouseKey, houseFootprintOf } from '../footprint/geometry.js';
import { fishSwarmsNearNode } from '../spatial/fish.js';
import { closer, ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../spatial/metric.js';

export const MAX_FISH_PER_SWARM = 30;
export const FISH_CAST_ATOMIC = 36;
export const FISH_CAUGHT_ATOMIC = 37;
export const FISH_FAILED_ATOMIC = 38;
export const FISH_SHORE_SEARCH_RADIUS = 20;

/**
 * How far around the anchor of a `workplace`, on a row of `hy`'s parity, every shore its
 * employed fisher searches lies, in Manhattan nodes. He searches from his feet, which stand at the door
 * after banking a catch, so the reach shrinks by the door's offset from the anchor.
 */
export function workplaceShoreSearchRadius(content: ContentSet, workplace: HouseKey, hy: number): number {
  const door = houseFootprintOf(content, workplace)?.door;
  const offset = door === undefined ? 0 : Math.abs(footprintCellDx(hy, door)) + Math.abs(door.dy);
  return Math.max(0, FISH_SHORE_SEARCH_RADIUS - offset);
}
/** The original's fish reproduction fires exactly once per 2160 game ticks. */
export const FISH_REPRODUCTION_TICKS = 2160;
/** A full swarm feeds a swarm fewer than this many map points away (original behavior). */
export const FISH_SPREAD_RADIUS = 16;
/** The fish a swarm founded by a full one starts with (original behavior). */
const FOUNDED_SWARM_FISH = 1;

/** The raw fish, the fisher's work and experience good whatever form lands in hand. Resolved by slug so
 *  modded numeric ids stay valid. */
export function fishGoodOf(content: ContentSet): number | undefined {
  return contentIndex(content).goodTypeBySlug.get('fish');
}

/**
 * Add authored swarms before tick zero, retaining source order as entity order. Original
 * behavior: a swarm stores at most 30 fish and the fisher's shore search covers 20 nodes; reproduction is
 * {@link fishReproductionSystem}.
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

/**
 * Once per {@link FISH_REPRODUCTION_TICKS}, in swarm order, a positive swarm below the cap gains one fish
 * and a full one gives one to its nearest non-full swarm on the same water within
 * {@link FISH_SPREAD_RADIUS}, an emptied one included. The water is the map's number under the full
 * swarm, not its own: when no swarm of that number lies within the radius, it founds one with one fish
 * on its own spot, so an authored swarm whose number differs from its water's still feeds a swarm the
 * fishers there can catch. Original behavior; the pass reads each count as it reaches the swarm, so a
 * swarm fed earlier in the pass grows again on its own visit, while a founded one first grows next pass.
 */
export const fishReproductionSystem: System = (world, ctx) => {
  if (ctx.tick % FISH_REPRODUCTION_TICKS !== 0) return;
  for (const e of world.canonicalQuery(FishSwarm)) {
    const count = world.get(e, FishSwarm).count;
    if (count <= 0) continue;
    if (count < MAX_FISH_PER_SWARM) {
      world.mut(e, FishSwarm).count = count + 1;
      continue;
    }
    spreadFrom(world, ctx.terrain, e);
  }
};

/**
 * Give one fish from `full` to the non-full swarm of its water nearest it within
 * {@link FISH_SPREAD_RADIUS}, the lower id on a tie, or found a swarm with one fish when no swarm of that
 * water, `full` itself or a full one included, lies within the radius.
 */
function spreadFrom(world: World, terrain: TerrainGraph | undefined, full: Entity): void {
  const at = world.get(full, Position);
  const origin = nodeOfPosition(at.x, at.y);
  const node = terrain?.nodeAtClamped(origin.hx, origin.hy);
  const continent =
    (node === undefined ? undefined : terrain?.waterContinents?.[node]) ??
    world.get(full, FishSwarm).continent;
  let best: Entity | null = null;
  let bestDistance = FISH_SPREAD_RADIUS;
  let sameWater = false;
  for (const entity of fishSwarmsNearNode(world, origin.hx, origin.hy, FISH_SPREAD_RADIUS - 1)) {
    const swarm = world.get(entity, FishSwarm);
    if (swarm.continent !== continent) continue;
    const position = world.get(entity, Position);
    const distance = hexDistance(origin, nodeOfPosition(position.x, position.y));
    if (distance >= FISH_SPREAD_RADIUS) continue;
    sameWater = true;
    if (swarm.count < MAX_FISH_PER_SWARM && distance < bestDistance) {
      best = entity;
      bestDistance = distance;
    }
  }
  if (best !== null) {
    world.mut(best, FishSwarm).count += 1;
  } else if (!sameWater && terrain !== undefined && node !== undefined) {
    foundSwarm(world, terrain, at, node, continent);
  }
}

/** A new swarm of one fish at `at`, standing on `water` of `continent`, its shore resolved like an authored one's. */
function foundSwarm(
  world: World,
  terrain: TerrainGraph,
  at: Readonly<PositionState>,
  water: NodeId,
  continent: number,
): void {
  const e = world.create();
  world.add(e, Position, positionRecord(at));
  world.add(e, FishSwarm, { count: FOUNDED_SWARM_FISH, continent, shore: nearestShore(terrain, water) });
}
