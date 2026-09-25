import {
  AttackOrder,
  Engagement,
  Palisade,
  PalisadeBlocking,
  PlayerOrder,
  Position,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { findPath } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { isValidOrderedTarget } from '../conflict/targeting.js';
import type { SystemContext } from '../context.js';
import { translatedCells } from '../footprint/geometry.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { clearNavState } from '../movement/nav-state.js';
import { canonicalById } from '../spatial/nodes.js';

/**
 * Turn a player-driven walk that walls block into an attack on the wall barring it, reporting whether it
 * did. `resume` is the ordered target to go back to once the wall falls; for an attack-move it is null and
 * the march resumes instead. A further wall behind is found the same way. Project rule: soldiers ordered
 * past a sealed palisade break through it rather than giving up.
 */
export function breakThroughWall(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  route: { readonly start: NodeId; readonly goal: NodeId },
  resume: Entity | null,
): boolean {
  const wall = palisadeBarring(world, ctx, terrain, e, route.start, route.goal);
  if (wall === null) return false;
  clearNavState(world, e);
  const march = world.tryGet(e, PlayerOrder)?.attackMove;
  if (resume === null && march !== undefined)
    world.mut(e, PlayerOrder).attackMove = { ...march, resume: true };
  world.add(e, AttackOrder, { target: wall, breach: { resume } });
  world.add(e, Engagement, { repathAt: ctx.tick });
  return true;
}

/**
 * A wall fell: every breach order lets go, so a squad chopping several posts walks through the first gap
 * instead of felling the rest. An ordered attack returns to its target; a march resumes and finds the next
 * wall itself if the gap does not open the way. Costs the standing attack orders, once per fallen wall.
 */
export function releaseWallBreaches(world: World, ctx: SystemContext): void {
  const released: { e: Entity; resume: Entity | null }[] = [];
  for (const e of world.query(AttackOrder)) {
    const breach = world.get(e, AttackOrder).breach;
    if (breach !== undefined) released.push({ e, resume: breach.resume });
  }
  for (const { e, resume } of released) {
    if (resume !== null && world.isAlive(resume)) {
      world.add(e, AttackOrder, { target: resume });
      world.add(e, Engagement, { repathAt: ctx.tick });
    } else {
      world.remove(e, AttackOrder);
    }
  }
}

/**
 * The wall segment `e` must break to reach `goal` from `start`: the first wall it may attack on the route
 * that treats every such wall as open ground. Null when walls are not what blocks the way: the goal is
 * reachable as it is, out of reach for another reason, or barred only by walls `e` may not attack. Costs
 * the standing walls and up to two searches.
 */
export function palisadeBarring(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  start: NodeId,
  goal: NodeId,
): Entity | null {
  const settler = world.tryGet(e, Settler);
  if (settler === undefined) return null;
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  // A route refused over a crowd or a far-off chase target is not a wall's doing.
  if (findPath(terrain, start, goal, blocked) !== null) return null;
  const wallAt = new Map<NodeId, Entity>();
  for (const wall of canonicalById(world.query(PalisadeBlocking, Palisade, Position))) {
    if (!isValidOrderedTarget(world, ctx, e, settler, wall)) continue;
    const at = world.get(wall, Position);
    const { hx, hy } = nodeOfPosition(at.x, at.y);
    for (const cell of translatedCells(terrain, world.get(wall, Palisade).walk, hx, hy)) {
      if (!wallAt.has(cell)) wallAt.set(cell, wall);
    }
  }
  if (wallAt.size === 0) return null;
  const breachable: BlockOverlay = {
    has: (node) => !wallAt.has(node) && blocked.has(node),
    get size() {
      return blocked.size;
    },
  };
  const path = findPath(terrain, start, goal, breachable);
  if (path === null) return null;
  for (let at = 0; at < path.length; at++) {
    const node = path[at];
    if (node === undefined) continue;
    const wall = wallAt.get(node);
    if (wall !== undefined) return wall;
    const next = path[at + 1];
    if (next === undefined) continue;
    const squeezed = postSqueezedPast(terrain, blocked, wallAt, node, next);
    if (squeezed !== null) return squeezed;
  }
  return null;
}

/**
 * A diagonal step passes between its two midpoint flanks and may cross a wall line without standing on it:
 * with both flanks closed it is a joint the walls-open route slipped through, and the lower-id wall of the
 * two is the one in the way.
 */
function postSqueezedPast(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  wallAt: ReadonlyMap<NodeId, Entity>,
  from: NodeId,
  to: NodeId,
): Entity | null {
  const a = terrain.coordsOf(from);
  const c = terrain.coordsOf(to);
  if (Math.abs(c.y - a.y) !== 2) return null;
  const row = (a.y + c.y) / 2;
  const flanks = [terrain.nodeAt(a.x, row), terrain.nodeAt(c.x, row)];
  if (!flanks.every((flank) => blocked.has(flank) || !terrain.isWalkable(flank))) return null;
  let post: Entity | null = null;
  for (const flank of flanks) {
    const wall = wallAt.get(flank);
    if (wall !== undefined && (post === null || wall < post)) post = wall;
  }
  return post;
}
