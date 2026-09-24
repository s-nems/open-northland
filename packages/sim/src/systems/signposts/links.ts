import { Owner, Position, SIGNPOST_LINK_RANGE_NODES, Signpost } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, nodeOfPosition } from '../../nav/halfcell.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';

/**
 * Link a post that just rose to every same-player post inside {@link SIGNPOST_LINK_RANGE_NODES} that
 * walkable ground joins it to, on both sides. Source basis: the original floods the ground around a new
 * guide and connects every own guide the flood reaches inside the range. Approximations: the flood
 * crosses static terrain only, where the original's also stops at standing buildings and is re-run on map
 * edits; a post keeps every link, where the original holds at most eight.
 */
export function settleSignpostLinks(world: World, terrain: TerrainGraph, post: Entity): void {
  if (world.get(post, Signpost).links.length !== 0) throw new Error(`signpost ${post} is already linked`);
  const p = world.get(post, Position);
  const origin = nodeOfPosition(p.x, p.y);
  if (!terrain.inBounds(origin.hx, origin.hy)) return;
  const start = terrain.nodeAt(origin.hx, origin.hy);
  const player = world.get(post, Owner).player;
  // Same player, inside the range, on the same static ground: what the flood can still rule out is a
  // detour longer than the range.
  const candidates = new Map<Entity, NodeId>();
  for (const other of world.query(Signpost, Position, Owner)) {
    if (other === post || world.get(other, Owner).player !== player) continue;
    const op = world.get(other, Position);
    const n = nodeOfPosition(op.x, op.y);
    if (hexDistanceBetween(origin.hx, origin.hy, n.hx, n.hy) >= SIGNPOST_LINK_RANGE_NODES) continue;
    if (!terrain.inBounds(n.hx, n.hy)) continue;
    const node = terrain.nodeAt(n.hx, n.hy);
    if (terrain.componentOf(node) === terrain.componentOf(start)) candidates.set(other, node);
  }
  if (candidates.size === 0) return;
  const linked = floodToCandidates(terrain, start, origin, candidates);
  if (linked.length === 0) return;
  linked.sort((a, b) => a - b);
  world.mut(post, Signpost).links = linked;
  for (const other of linked) {
    const links = world.mut(other, Signpost);
    links.links = [...links.links, post].sort((a, b) => a - b);
  }
}

/** Breadth-first over the pathfinder's own edges, never past the link range; stops once every
 *  candidate is reached. */
function floodToCandidates(
  terrain: TerrainGraph,
  start: NodeId,
  origin: { readonly hx: number; readonly hy: number },
  candidates: ReadonlyMap<Entity, NodeId>,
): Entity[] {
  const waiting = new Map<NodeId, Entity[]>();
  for (const [post, node] of candidates) {
    const at = waiting.get(node);
    if (at === undefined) waiting.set(node, [post]);
    else at.push(post);
  }
  const reached: Entity[] = [];
  const seen = new Set<NodeId>([start]);
  const queue: NodeId[] = [start];
  const edges = new StepBuffer();
  for (const cur of queue) {
    terrain.stepsInto(cur, undefined, edges);
    for (let i = 0; i < edges.length; i++) {
      const { node } = edges.at(i);
      if (seen.has(node)) continue;
      if (
        hexDistanceBetween(origin.hx, origin.hy, terrain.xOf(node), terrain.yOf(node)) >=
        SIGNPOST_LINK_RANGE_NODES
      )
        continue;
      seen.add(node);
      queue.push(node);
      const hit = waiting.get(node);
      if (hit !== undefined) {
        reached.push(...hit);
        if (reached.length === candidates.size) return reached;
      }
    }
  }
  return reached;
}

/** Drop a falling post from its neighbours' link lists, before it is destroyed. */
export function unlinkSignpost(world: World, post: Entity): void {
  for (const other of world.get(post, Signpost).links) {
    const links = world.tryMut(other, Signpost);
    if (links !== undefined) links.links = links.links.filter((e) => e !== post);
  }
}

/** Re-settle the links of a post that changed hands: it leaves its old owner's posts and joins the new
 *  owner's in range. Source basis: the original's guide rescan links same-player guides only. */
export function relinkSignpost(world: World, terrain: TerrainGraph, post: Entity): void {
  unlinkSignpost(world, post);
  world.mut(post, Signpost).links = [];
  settleSignpostLinks(world, terrain, post);
}
