import { isAiPlayer, LostWay, MoveGoal, ownerOf, Position } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import { hexDistanceBetween, nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { routeRegions } from '../../footprint/index.js';
import { type NavigationLimit, networkLimitAt, signpostNetwork } from '../../signposts/index.js';
import type { PlannerPass } from '../planner/pass.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';
import { type SeatDoors, strandedWorkplaceDoor } from './cut-off.js';
import { nearestFreeCell } from './spacing.js';

/** How long a computer seat's settler stands lost before it is led back. Not the original's: its
 *  settlers stand until the player leads them, and a computer seat has no player to do that. */
export const LOST_GUIDE_DELAY_TICKS = 10 * TICKS_PER_SECOND;

/**
 * Lead a computer seat's lost settler back towards its settlement: once it has stood lost for
 * {@link LOST_GUIDE_DELAY_TICKS}, a worker posted beyond its reach walks to its workplace's door, and one
 * with no door of its seat in reach walks to the nearest own post from which the signpost network reaches
 * a door, or to the nearest door when no post does. The walk itself ignores the confinement, as a
 * player's order would; normal planning resumes on arrival. A settler sealed in a pocket, or whose last
 * guided walk failed, stays put. Returns whether it set the walk.
 */
export function guideLostSettler(pass: PlannerPass, e: Entity, limit: NavigationLimit | null): boolean {
  const { world, ctx, terrain } = pass;
  if (limit === null) return false;
  const lost = world.tryGet(e, LostWay);
  if (lost === undefined || ctx.tick - lost.since < LOST_GUIDE_DELAY_TICKS) return false;
  const owner = ownerOf(world, e);
  if (owner === undefined || !isAiPlayer(world, owner)) return false;
  const p = world.get(e, Position);
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const here = terrain.nodeAtClamped(hx, hy);
  const component = terrain.componentOf(here);
  if (component === -1) return false;
  const target =
    strandedWorkplaceDoor(world, ctx, terrain, e, limit) ??
    homewardTarget(pass, owner, component, hx, hy, limit);
  const stand = target === null ? null : nearestFreeCell(terrain, target, pass.spacing);
  if (stand === null || isUnreachableGoal(unreachableGoals(world, ctx, e), stand)) return false;
  if (routeRegions(world, ctx, terrain).unroutable(here, stand)) return false;
  pass.spacing.claim(stand);
  world.add(e, MoveGoal, { cell: stand });
  return true;
}

/** The nearest own post from which the network reaches a door of the seat, or the nearest door when no
 *  post does; null while a door is already in reach. */
function homewardTarget(
  pass: PlannerPass,
  owner: number,
  component: number,
  hx: number,
  hy: number,
  limit: NavigationLimit,
): NodeId | null {
  const home = pass.homeward.of(owner, component);
  if (home.doors.length === 0 || home.doors.some((door) => limit.allowsNode(door))) return null;
  return nearest(pass.terrain, hx, hy, home.posts) ?? nearest(pass.terrain, hx, hy, home.doors);
}

/** One seat's landmarks on one static component: its doors there, and its posts there from which the
 *  signpost network reaches one of those doors. */
interface Homeward {
  readonly doors: readonly NodeId[];
  readonly posts: readonly NodeId[];
}

/** Each seat's {@link Homeward} landmarks, derived at most once per planner pass per seat and component,
 *  so a pass pays one post-by-post network test however many of the seat's settlers stand lost. */
export class HomewardPosts {
  private readonly byKey = new Map<string, Homeward>();

  constructor(
    private readonly world: World,
    private readonly terrain: TerrainGraph,
    private readonly seatDoors: SeatDoors,
  ) {}

  of(seat: number, component: number): Homeward {
    const key = `${seat}:${component}`;
    let home = this.byKey.get(key);
    if (home === undefined) {
      home = this.derive(seat, component);
      this.byKey.set(key, home);
    }
    return home;
  }

  private derive(seat: number, component: number): Homeward {
    const { world, terrain } = this;
    const onComponent = (node: NodeId): boolean => terrain.componentOf(node) === component;
    const doors = this.seatDoors.of(seat).filter(onComponent);
    if (doors.length === 0) return { doors, posts: [] };
    const posts = (signpostNetwork(world).get(seat) ?? [])
      .map((s) => terrain.nodeAtClamped(s.hx, s.hy))
      .filter(onComponent)
      .filter((post) => {
        const reach = networkLimitAt(world, terrain, seat, terrain.xOf(post), terrain.yOf(post));
        return reach === null || doors.some((door) => reach.allowsNode(door));
      });
    return { doors, posts };
  }
}

/** The node of `nodes` nearest `(hx, hy)` by hex distance, node id breaking ties. */
function nearest(terrain: TerrainGraph, hx: number, hy: number, nodes: readonly NodeId[]): NodeId | null {
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const distance = hexDistanceBetween(hx, hy, terrain.xOf(node), terrain.yOf(node));
    if (distance < bestDistance || (distance === bestDistance && best !== null && node < best)) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}
