import { MoveGoal, Owner, Position, Residence } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import type { PlannerSpacing } from '../settlers/planner/spacing.js';
import { navigationLimitFor } from '../signposts/index.js';

/**
 * The child stroll - a growing settler with a home occasionally walks to a random spot beside it instead
 * of standing frozen at the door. Approximation of the original's children pottering around the house.
 */

/** How far from the home anchor a stroll may aim (half-cell nodes, so ~3 visual tiles). */
const CHILD_WANDER_RADIUS_NODES = 6;
/** Mean ticks between strolls; each idle tick rolls 1/N. */
const CHILD_WANDER_PERIOD_TICKS = 90;

/**
 * Maybe send the idle child `e` on a stroll near its home. Owned children only, following the
 * {@link PlannerSpacing} Owner convention, and only onto a walkable node outside building footprints; an
 * unlucky roll simply waits for the next one.
 */
export function planChildWander(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  spacing: PlannerSpacing,
): void {
  if (!world.has(e, Owner)) return;
  const home = world.tryGet(e, Residence)?.home;
  if (home === undefined || !world.isAlive(home)) return;
  const homePos = world.tryGet(home, Position);
  if (homePos === undefined) return;
  if (ctx.rng.int(CHILD_WANDER_PERIOD_TICKS) !== 0) return;
  const anchor = nodeOfPosition(homePos.x, homePos.y);
  const dx = ctx.rng.int(2 * CHILD_WANDER_RADIUS_NODES + 1) - CHILD_WANDER_RADIUS_NODES;
  const dy = ctx.rng.int(2 * CHILD_WANDER_RADIUS_NODES + 1) - CHILD_WANDER_RADIUS_NODES;
  const target = terrain.nodeAtClamped(anchor.hx + dx, anchor.hy + dy);
  if (!terrain.isWalkable(target) || spacing.blockedCells().has(target)) return;
  // Checked after the rolls, so the RNG stream is identical whether or not confinement is on.
  const limit = navigationLimitFor(world, ctx.content, terrain, e);
  if (limit !== null && !limit.allowsNode(target)) return;
  world.add(e, MoveGoal, { cell: target });
}
