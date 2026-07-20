import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockedCells } from '../footprint/index.js';
import type { NavigationLimit } from '../signposts/index.js';
import type { SpacingState } from './destack.js';
import { isUnreachableGoal, unreachableGoals } from './unreachable-goals.js';

// Where a tired settler beds down. The original's settlers do not drop asleep on the spot they were
// working — they step off the workplace doorstep into open ground and lie down there (observed
// original), so the sleep drive is a walk-then-act rung like eating, not an in-place atomic.
//
// "Open ground" is read off the walk-block overlay: a rest spot is a node that is itself clear of
// buildings and resources AND has no blocked neighbour, so a sleeper never ends up in a doorway, a nook
// between two houses, or pressed against a tree. Approximated — the original's own bedding-down rule is
// not in the readable data; this is the clearance that reproduces the observed "walks aside to rest".
//
// Deliberately NOT gated on Owner, unlike the sibling spacing drives (`deStackIdle`, `loiterCell`,
// which gate to keep unowned fixtures byte-identical): where a settler sleeps is a needs mechanic, not
// spacing, and an unowned settler should not bed down by a different rule. Unowned settlers are simply
// absent from the occupancy buckets, so they avoid owned sleepers without being avoided in turn.

/**
 * Max nodes a rest-spot ring search visits before the settler simply sleeps where it stands. Matches the
 * de-stack search order of magnitude: far enough to leave a crowded village square, cheap enough to run
 * per tired settler.
 */
const REST_SPOT_SEARCH_CAP = 192;

/**
 * The node `e` should sleep on: `here` when it is already lying in the open, otherwise the nearest open
 * node the settler may walk to (claimed for the tick, so two settlers turning in together pick different
 * beds). Falls back to `here` when nothing qualifies within {@link REST_SPOT_SEARCH_CAP} — a boxed-in
 * settler rests where it stands rather than refusing to sleep.
 *
 * Re-plan stability matters here: the caller runs this every tick the settler is idle and tired, so
 * `here` must win whenever it qualifies. Otherwise an arriving sleeper would re-pick a further bed each
 * tick and never lie down.
 */
export function restingCell(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  spacing: SpacingState,
  limit: NavigationLimit | null,
): NodeId {
  spacing.blockedCells ??= dynamicBlockedCells(world, ctx, terrain);
  const blocked = spacing.blockedCells;
  if (isOpenGround(terrain, here, blocked) && nodeIsFreeFor(terrain, here, e, spacing)) return here;

  // The beds this settler's routes just failed to reach — the BFS traverses blocked nodes, so a bed can
  // sit behind a wall; without this the settler would re-pick the same unroutable spot every re-plan.
  const failed = unreachableGoals(world, ctx, e);
  const seen = new Set<NodeId>([here]);
  let frontier: NodeId[] = [here];
  let visited = 0;
  while (frontier.length > 0 && visited < REST_SPOT_SEARCH_CAP) {
    const next: NodeId[] = [];
    for (const cell of frontier) {
      // Traverse blocked nodes but never bed down on them — the open patch just past a rank of houses is
      // a fine bed, and whether it is actually reachable is the follow-up route's job (nav/nearest.ts).
      for (const n of terrain.walkableNeighbours(cell)) {
        if (seen.has(n)) continue;
        seen.add(n);
        visited++;
        next.push(n);
        if (spacing.claimed.has(n) || isUnreachableGoal(failed, n)) continue;
        if (limit !== null && !limit.allowsNode(n)) continue;
        if (!isOpenGround(terrain, n, blocked) || !nodeIsFreeFor(terrain, n, e, spacing)) continue;
        spacing.claimed.add(n);
        return n;
      }
    }
    frontier = next;
  }
  return here; // nowhere clear within reach — sleep on the spot
}

/** Whether `node` is walkable ground clear of every building/resource footprint, its own and its
 *  neighbours' — the "out in the open, off the doorstep" test a bed must pass. */
function isOpenGround(terrain: TerrainGraph, node: NodeId, blocked: ReadonlySet<NodeId>): boolean {
  if (!terrain.isWalkable(node) || blocked.has(node)) return false;
  for (const n of terrain.walkableNeighbours(node)) if (blocked.has(n)) return false;
  return true;
}

/** Whether `node` holds no stationary owned settler other than `e` — a sleeper does not bed down on top
 *  of someone else (the {@link SpacingState} occupancy test `loiterCell` makes; unowned fixtures are absent
 *  from the buckets, so they only ever avoid owned sleepers). */
function nodeIsFreeFor(terrain: TerrainGraph, node: NodeId, e: Entity, spacing: SpacingState): boolean {
  const { x, y } = terrain.coordsOf(node);
  const bucket = spacing.occupancy.at(x, y);
  return bucket.length === 0 || (bucket.length === 1 && bucket[0] === e);
}
