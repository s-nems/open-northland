import { MoveGoal, Owner, Position, Residence } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SpacingState } from '../agents/destack.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockedCells } from '../footprint/index.js';
import { navigationLimitFor } from '../signposts/index.js';

/**
 * The child stroll — a growing settler (baby/child) with a home occasionally walks to a random spot
 * beside it instead of standing frozen at the door (user-requested feel; the original's children
 * likewise potter around the house). Runs from the planner's Age gate for an idle young settler,
 * below a child's eat/sleep drives — a hungry child feeds first and strolls when sated.
 */

/** How far from the home anchor a stroll may aim (half-cell nodes — ~3 visual tiles). */
const CHILD_WANDER_RADIUS_NODES = 6;
/** Mean ticks between strolls (each idle tick rolls 1/N) — a stroll every few seconds, not a patrol. */
const CHILD_WANDER_PERIOD_TICKS = 90;

/**
 * Maybe send the idle child `e` on a stroll near its home. Owned children only (unowned fixtures stay
 * byte-identical, the {@link SpacingState} Owner convention); a homeless or orphaned-of-home child
 * stays put. The target must be walkable and outside building footprints — a goal the router would
 * refuse wastes the stroll (the planner's stranded recovery parks the child for its retry pace), so
 * an unlucky roll just waits for the next one.
 */
export function planChildWander(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  spacing: SpacingState,
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
  spacing.blockedCells ??= dynamicBlockedCells(world, ctx, terrain);
  const target = terrain.nodeAtClamped(anchor.hx + dx, anchor.hy + dy);
  if (!terrain.isWalkable(target) || spacing.blockedCells.has(target)) return;
  // Signpost confinement: a stroll spot outside the child's allowed area is skipped like a blocked one
  // (checked after the rolls, so the RNG stream is identical whether or not confinement is on).
  const limit = navigationLimitFor(world, terrain, e);
  if (limit !== null && !limit.allowsNode(target)) return;
  world.add(e, MoveGoal, { cell: target });
}
