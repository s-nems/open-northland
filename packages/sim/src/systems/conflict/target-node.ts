import { Building, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingFootprintOf, nearestCell, translatedCells } from '../footprint/geometry.js';
import { interactionNode } from '../footprint/index.js';
import { entityNode } from '../spatial.js';

// The node(s) combat measures a target's distance to (and paths a chaser toward). Split out of targeting.ts
// so the ring-search index, the chase drive, and the mid-swing whiff check all resolve a building target's
// approach the same way.

/** A per-tick memo of a building's wall nodes — a building never moves within a tick, so the combat loop
 *  computes each once and the index build + every chaser share the result (see {@link buildingBodyNodes}). */
export type BuildingBodyNodeCache = Map<Entity, readonly NodeId[]>;

/**
 * The half-cell WALL nodes a building presents to attackers — its footprint `blocked` (physical body) cells,
 * translated to the placed anchor. A warrior measures reach to, and swings at, the nearest of these, so a
 * building is besieged from EVERY face rather than only its door: melee stands on any walkable perimeter cell
 * (one node outside a wall) and archers fire from the reach band around it. Falls back to the door node (then
 * the anchor) for a footprint-less building (synthetic test content, the one graphics-less real type), which
 * keeps the pre-footprint single-node behaviour. `cache` (optional) memoizes the result per building for the
 * tick — the index build and every chaser reuse it instead of re-translating the footprint.
 */
export function buildingBodyNodes(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  building: Entity,
  cache?: BuildingBodyNodeCache,
): readonly NodeId[] {
  const cached = cache?.get(building);
  if (cached !== undefined) return cached;
  const nodes = computeBuildingBodyNodes(world, ctx, terrain, building);
  cache?.set(building, nodes);
  return nodes;
}

function computeBuildingBodyNodes(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  building: Entity,
): readonly NodeId[] {
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return [];
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const body = translatedCells(
    terrain,
    buildingFootprintOf(ctx.content, b.buildingType)?.blocked ?? [],
    hx,
    hy,
  );
  if (body.length > 0) return body;
  const door = interactionNode(world, ctx, building);
  return door === null ? [entityNode(world, terrain, building)] : [terrain.nodeAtClamped(door.x, door.y)];
}

/**
 * The half-cell node a warrior at `from` fights `target` from — its own node for a settler/animal
 * ({@link entityNode}), the nearest wall ({@link buildingBodyNodes}) cell for a building. Attacker-aware so a
 * besieging warrior closes on (and measures reach to) the face nearest it, which is why a mass of attackers
 * spreads around the whole footprint instead of queueing at one door. The combat index buckets a building at
 * every wall cell, so `index.nearest` returns the same node this resolves for a given attacker — the reach
 * distance and the chase goal agree. `cache` threads the tick's building-wall memo through.
 */
export function combatTargetNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: NodeId,
  target: Entity,
  cache?: BuildingBodyNodeCache,
): NodeId {
  if (world.has(target, Building)) {
    const nearest = nearestCell(terrain, buildingBodyNodes(world, ctx, terrain, target, cache), from);
    if (nearest !== null) return nearest;
  }
  return entityNode(world, terrain, target);
}
