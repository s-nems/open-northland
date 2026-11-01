import { Palisade, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { MapContext } from '../context.js';
import { buildingBodyNodes } from './target-node.js';

/** Shared so an uncovered node allocates nothing. */
const NO_WALLS: readonly Entity[] = [];

interface WallCover {
  /** Palisade MEMBERSHIP generation: a placement, a removal or a gate swap, which re-adds the wall. */
  palisadeGeneration: number;
  /** Position MEMBERSHIP generation: a body is read off the anchor, which only an add or re-add moves. */
  positionGeneration: number;
  readonly terrain: TerrainGraph;
  byNode: Map<NodeId, Entity[]>;
  walls: Set<Entity>;
}

const coverByWorld = new WeakMap<World, WallCover>();

/**
 * The walls whose bodies cover `node`, ascending by id, whatever their health or side. Derived per world and
 * held across ticks: a Palisade membership change, or a Position membership change on a wall, rebuilds it.
 * Never hashed; the registered verifier re-derives it.
 */
export function wallsCoveringNode(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  node: NodeId,
): readonly Entity[] {
  return liveCover(world, ctx, terrain).byNode.get(node) ?? NO_WALLS;
}

function liveCover(world: World, ctx: MapContext, terrain: TerrainGraph): WallCover {
  const palisadeGeneration = world.componentGeneration(Palisade);
  const positionGeneration = world.componentGeneration(Position);
  const held = coverByWorld.get(world);
  if (held === undefined || held.terrain !== terrain) {
    world.journalMembership(Position);
    const fresh: WallCover = {
      palisadeGeneration,
      positionGeneration,
      terrain,
      ...derive(world, ctx, terrain),
    };
    coverByWorld.set(world, fresh);
    const content = ctx.content;
    world.registerCacheVerifier('wallCover', () => verify(world, { content, terrain }, terrain));
    return fresh;
  }
  if (held.palisadeGeneration === palisadeGeneration && held.positionGeneration === positionGeneration) {
    return held;
  }
  let stale = held.palisadeGeneration !== palisadeGeneration;
  if (!stale) {
    const replayed = world.replayMembershipSince(Position, held.positionGeneration, (e) => {
      if (held.walls.has(e) || world.has(e, Palisade)) stale = true;
    });
    stale ||= !replayed;
  }
  if (stale) Object.assign(held, derive(world, ctx, terrain));
  held.palisadeGeneration = palisadeGeneration;
  held.positionGeneration = positionGeneration;
  return held;
}

/** Each placed wall at every node of its body, visited in ascending id so each node's list is ascending. */
function derive(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
): { byNode: Map<NodeId, Entity[]>; walls: Set<Entity> } {
  const byNode = new Map<NodeId, Entity[]>();
  const walls = new Set<Entity>();
  const placed = [...world.query(Palisade, Position)].sort((a, b) => a - b);
  for (const wall of placed) {
    walls.add(wall);
    for (const node of buildingBodyNodes(world, ctx, terrain, wall)) {
      const list = byNode.get(node);
      if (list === undefined) byNode.set(node, [wall]);
      else if (list[list.length - 1] !== wall) list.push(wall);
    }
  }
  return { byNode, walls };
}

function verify(world: World, ctx: MapContext, terrain: TerrainGraph): string[] {
  const held = coverByWorld.get(world);
  if (held === undefined || held.terrain !== terrain) return [];
  if (
    held.palisadeGeneration !== world.componentGeneration(Palisade) ||
    held.positionGeneration !== world.componentGeneration(Position)
  ) {
    return []; // the next read replays the changes before anything consumes the held cover
  }
  const fresh = derive(world, ctx, terrain).byNode;
  if (fresh.size !== held.byNode.size) return ['wallCover holds a stale node set'];
  for (const [node, walls] of fresh) {
    const kept = held.byNode.get(node);
    if (kept === undefined || kept.length !== walls.length || walls.some((w, i) => kept[i] !== w)) {
      return [`wallCover holds stale walls at node ${node}`];
    }
  }
  return [];
}
