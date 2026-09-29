import { isAiPlayer, LostWay, MoveGoal, ownerOf, Position } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import { hexDistanceBetween, nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { type NavigationLimit, networkLimitAt, signpostNetwork } from '../../signposts/index.js';
import type { PlannerSpacing } from '../planner/spacing.js';
import type { SeatDoors } from './cut-off.js';
import { nearestFreeCell } from './spacing.js';

/** How long a computer seat's settler stands lost before it is led back. Not the original's: its
 *  settlers stand until the player leads them, and a computer seat has no player to do that. */
export const LOST_GUIDE_DELAY_TICKS = 10 * TICKS_PER_SECOND;

/**
 * Lead a computer seat's lost settler back towards its settlement: once it has stood lost for
 * {@link LOST_GUIDE_DELAY_TICKS} with no door of its seat in reach, it walks to the nearest own post from
 * which the signpost network reaches a door, or to the nearest door when no post does. The walk itself
 * ignores the confinement, as a player's order would; normal planning resumes on arrival. Returns
 * whether it set the walk.
 */
export function guideLostSettler(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  limit: NavigationLimit | null,
  doors: SeatDoors,
  spacing: PlannerSpacing,
): boolean {
  if (limit === null) return false;
  const lost = world.tryGet(e, LostWay);
  if (lost === undefined || ctx.tick - lost.since < LOST_GUIDE_DELAY_TICKS) return false;
  const owner = ownerOf(world, e);
  if (owner === undefined || !isAiPlayer(world, owner)) return false;
  const p = world.get(e, Position);
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const component = terrain.componentOf(terrain.nodeAtClamped(hx, hy));
  if (component === -1) return false;
  const seatDoors = doors.of(owner).filter((door) => terrain.componentOf(door) === component);
  if (seatDoors.length === 0 || seatDoors.some((door) => limit.allowsNode(door))) return false;
  const target =
    homewardPost(world, terrain, owner, hx, hy, component, seatDoors) ?? nearest(terrain, hx, hy, seatDoors);
  if (target === null) return false;
  const stand = nearestFreeCell(terrain, target, spacing);
  if (stand === null) return false;
  spacing.claim(stand);
  world.add(e, MoveGoal, { cell: stand });
  return true;
}

/** The own post nearest `(hx, hy)` on `component` whose network reaches one of `seatDoors`, nearest first
 *  by hex distance, node id breaking ties. */
function homewardPost(
  world: World,
  terrain: TerrainGraph,
  player: number,
  hx: number,
  hy: number,
  component: number,
  seatDoors: readonly NodeId[],
): NodeId | null {
  const posts = (signpostNetwork(world).get(player) ?? [])
    .map((s) => terrain.nodeAtClamped(s.hx, s.hy))
    .filter((node) => terrain.componentOf(node) === component);
  for (const post of byDistance(terrain, hx, hy, posts)) {
    const reach = networkLimitAt(world, terrain, player, terrain.xOf(post), terrain.yOf(post));
    if (reach === null || seatDoors.some((door) => reach.allowsNode(door))) return post;
  }
  return null;
}

function nearest(terrain: TerrainGraph, hx: number, hy: number, nodes: readonly NodeId[]): NodeId | null {
  return byDistance(terrain, hx, hy, nodes)[0] ?? null;
}

function byDistance(terrain: TerrainGraph, hx: number, hy: number, nodes: readonly NodeId[]): NodeId[] {
  const distance = (n: NodeId): number => hexDistanceBetween(hx, hy, terrain.xOf(n), terrain.yOf(n));
  return [...nodes].sort((a, b) => distance(a) - distance(b) || a - b);
}
