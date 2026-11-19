import type { Entity, World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import { NO_WALK, type WalkLengths } from '../../../nav/node-circle.js';
import { ringSearch, STAND_SEARCH_CAP } from '../../../nav/ring-search.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { type NavigationLimit, rankFromSpot } from '../../signposts/index.js';
import { rankWalk } from '../../spatial/walk-rank.js';
import type { PlannerSpacing } from '../planner/spacing.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';

// Where a tired settler beds down. Settlers step off the workplace doorstep into open ground and lie down
// there (observed original), so sleeping is a walk-then-act rung rather than an in-place atomic.
// Approximation: the original's own bedding-down rule is not in the readable data.
//
// Not gated on Owner, unlike the sibling spacing drives: where a settler sleeps is a needs mechanic, not
// spacing. Unowned settlers are absent from the occupancy buckets, so they avoid owned sleepers without
// being avoided in turn.

/**
 * The node `e` should sleep on: `here` when it is already lying in the open, otherwise the nearest open
 * node it may walk to, claimed for the tick so two settlers turning in together pick different beds. A
 * boxed-in settler falls back to `here` rather than refusing to sleep.
 *
 * `here` must win whenever it qualifies: the caller re-runs this every idle tick, so a drifting pick would
 * leave an arriving sleeper choosing a further bed forever.
 */
export function restingCell(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  spacing: PlannerSpacing,
  limit: NavigationLimit | null,
): NodeId {
  const blocked = spacing.blockedCells();
  if (isOpenGround(terrain, here, blocked) && nodeIsFreeFor(terrain, here, e, spacing)) return here;

  // The beds this settler's routes just failed to reach. The search traverses blocked nodes, so a bed can
  // sit behind a wall and would otherwise be re-picked on every re-plan.
  const failed = unreachableGoals(world, ctx, e);
  const open = (n: NodeId): boolean =>
    !spacing.isClaimed(n) &&
    !isUnreachableGoal(failed, n) &&
    (limit === null || limit.allowsNode(n)) &&
    isOpenGround(terrain, n, blocked) &&
    nodeIsFreeFor(terrain, n, e, spacing);
  const walk = rankWalk(rankFromSpot(limit, here));
  const bed =
    walk === undefined
      ? ringSearch(terrain, here, STAND_SEARCH_CAP, { accept: open })
      : nearestBedByWalk(terrain, here, walk, open);
  if (bed === null) return here;
  spacing.claim(bed);
  return bed;
}

/**
 * The open node with the fewest steps of `walk`, the first the ring search meets among equals; one the
 * walk does not reach, allowed through a signpost group alone, only when it reaches none. The search
 * walks through building bodies where the walk goes round them, so a node a ring out is no fewer steps
 * away, and it ends once its ring cannot beat the bed held.
 */
function nearestBedByWalk(
  terrain: TerrainGraph,
  here: NodeId,
  walk: WalkLengths,
  open: (n: NodeId) => boolean,
): NodeId | null {
  const pick = { bed: null as NodeId | null, steps: Number.POSITIVE_INFINITY, beyond: null as NodeId | null };
  ringSearch(terrain, here, STAND_SEARCH_CAP, {
    accept: (n, ring) => {
      if (ring >= pick.steps || ring > walk.maxSteps) return true;
      if (!open(n)) return false;
      const steps = walk.stepsTo(n, pick.steps);
      if (steps !== NO_WALK && steps < pick.steps) {
        pick.bed = n;
        pick.steps = steps;
      } else if (pick.bed === null) pick.beyond ??= n;
      return false;
    },
  });
  return pick.bed ?? pick.beyond;
}

/** Whether `node` and every walkable neighbour are clear of building and resource footprints, so a sleeper
 *  never ends up in a doorway or pressed against a tree. */
function isOpenGround(terrain: TerrainGraph, node: NodeId, blocked: BlockOverlay): boolean {
  if (!terrain.isWalkable(node) || blocked.has(node)) return false;
  for (const n of terrain.walkableNeighbours(node)) if (blocked.has(n)) return false;
  return true;
}

/** Whether `node` holds no stationary owned settler other than `e`. */
function nodeIsFreeFor(terrain: TerrainGraph, node: NodeId, e: Entity, spacing: PlannerSpacing): boolean {
  const { x, y } = terrain.coordsOf(node);
  const bucket = spacing.occupancy.at(x, y);
  return bucket.length === 0 || (bucket.length === 1 && bucket[0] === e);
}
