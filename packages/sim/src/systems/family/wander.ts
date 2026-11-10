import { MoveGoal, Owner, Position, Residence } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { hasOpenSide } from '../../nav/nearest.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { routeRegions } from '../footprint/index.js';
import type { PlannerSpacing } from '../settlers/planner/spacing.js';
import { isUnreachableGoal, unreachableGoals } from '../settlers/unreachable-goals.js';
import { navigationLimitFor } from '../signposts/index.js';

/**
 * The child stroll - a growing settler with a home occasionally walks to a random spot beside it instead
 * of standing frozen at the door. Approximation of the original's children pottering around the house.
 */

/** How far from the home anchor a stroll may aim (half-cell nodes, so ~3 visual tiles). */
const CHILD_WANDER_RADIUS_NODES = 6;
/** Mean idle ticks before a stroll. A roll made every `n` ticks succeeds `n` times in `N + n / 2`: the
 *  half beat is the mean wait for the first roll, so the mean holds whatever the beat. */
const CHILD_WANDER_PERIOD_TICKS = 90;

/**
 * Maybe send the idle child `e` on a stroll near its home, on a roll made every `beatTicks`. Owned
 * children only, following the
 * {@link PlannerSpacing} Owner convention, and only onto a walkable node outside building footprints and
 * doorways that keeps an open side; an unlucky roll simply waits for the next one.
 */
export function planChildWander(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  spacing: PlannerSpacing,
  beatTicks: number,
): void {
  if (!world.has(e, Owner)) return;
  const home = world.tryGet(e, Residence)?.home;
  if (home === undefined || !world.isAlive(home)) return;
  const homePos = world.tryGet(home, Position);
  if (homePos === undefined) return;
  if (ctx.rng.int(CHILD_WANDER_PERIOD_TICKS + Math.floor(beatTicks / 2)) >= beatTicks) return;
  const anchor = nodeOfPosition(homePos.x, homePos.y);
  const dx = ctx.rng.int(2 * CHILD_WANDER_RADIUS_NODES + 1) - CHILD_WANDER_RADIUS_NODES;
  const dy = ctx.rng.int(2 * CHILD_WANDER_RADIUS_NODES + 1) - CHILD_WANDER_RADIUS_NODES;
  const target = terrain.nodeAtClamped(anchor.hx + dx, anchor.hy + dy);
  const blocked = spacing.blockedCells();
  if (!terrain.isWalkable(target) || blocked.has(target) || spacing.doorways().has(target)) return;
  if (!hasOpenSide(terrain, target, blocked)) return;
  // Checked after the rolls, so the RNG stream is identical whether or not confinement is on.
  const limit = navigationLimitFor(world, ctx.content, terrain, e);
  if (limit !== null && !limit.allowsNode(target)) return;
  const position = world.tryGet(e, Position);
  if (position === undefined) return;
  const node = nodeOfPosition(position.x, position.y);
  const here = terrain.nodeAtClamped(node.hx, node.hy);
  if (
    target !== here &&
    (terrain.componentOf(here) !== terrain.componentOf(target) ||
      isUnreachableGoal(unreachableGoals(world, ctx, e), target) ||
      routeRegions(world, ctx, terrain).unroutable(here, target))
  )
    return;
  world.add(e, MoveGoal, { cell: target });
}
