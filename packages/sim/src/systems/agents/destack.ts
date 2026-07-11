import { MoveGoal, Owner } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockedCells } from '../footprint/index.js';
import type { NodeBuckets } from '../spatial.js';

// The SPACING drives — the two consumers of the planner-tick occupancy state:
//  - idle spacing ({@link deStackIdle}): the last resort for a unit with nothing to do — step off a
//    tile shared with another resting unit so an idle crowd spreads out instead of stacking;
//  - work slots ({@link claimWorkCell}): a worker whose drive converges many units on ONE anchor
//    cell (builders hammering a construction site) claims a distinct stand cell in the anchor's
//    yard instead, so parallel workers spread out. Body collision can never do this: civilians are
//    deliberate pass-through (see movement/collision/bodies.ts), and the SeparationSystem displaces
//    only WALKING movers — two units STANDING on one node would never be pushed apart.

/**
 * The planner-tick idle-spacing state, built once per tick from the tick-start positions (stable
 * across the planner loop's own mutations — deliberately NOT updated as units are re-tasked):
 * `occupancy` buckets the owned resting units by tile, `claimed` stops two de-stackers choosing the
 * same free cell, and `blockedCells` lazily memoises the building walk-block overlay so a tick with
 * no crowded idle unit never builds it.
 */
export interface IdleSpacing {
  readonly occupancy: NodeBuckets;
  readonly claimed: Set<NodeId>;
  blockedCells?: ReadonlySet<NodeId>;
}

/** Max nodes a de-stack ring search visits before giving up — a boxed-in unit simply stays put.
 *  Quadrupled with the half-cell migration: nodes are 4× denser per world area, so this cap covers
 *  the same on-screen search radius the old 48-cell cap did. */
const SPACING_SEARCH_CAP = 192;

/**
 * The idle-spacing drive: if `e` — a resting, owned, otherwise-idle settler on half-cell node
 * (tileX,tileY) — shares that node with a LOWER-id resting owned settler, send it (a
 * {@link MoveGoal}) to the nearest free node so the two don't stand stacked. The lowest-id occupant
 * on the node is the keeper (it stays); every other occupant steps aside. A unit boxed in (no free
 * node within the search cap) just stays.
 *
 * This is the sim half of the "no hard collision, but units won't come to rest on an occupied node"
 * behaviour: transit is never blocked (a walker passes through freely), only a unit that has ARRIVED
 * with nothing to do relocates off a shared node. Determinism: the keeper test is a canonical id
 * compare; the target is a canonical breadth-first search; `claimed` keeps two de-stackers off the
 * same new node.
 */
export function deStackIdle(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  tileX: number,
  tileY: number,
  spacing: IdleSpacing,
): void {
  // Only PLAYER-owned units space out. An unowned settler is NOT in the owned-only `occupancy`, so the
  // keeper test below (`bucket[0] === e`) could never recognise it as the keeper — without this guard an
  // unowned unit sharing a tile with ≥2 owned resting units would wrongly de-stack. Gating here keeps the
  // unowned golden/economy fixtures byte-identical (the stated invariant) and neutrals put in real play.
  if (!world.has(e, Owner)) return;
  const bucket = spacing.occupancy.at(tileX, tileY);
  if (bucket.length < 2 || bucket[0] === e) return; // alone on the tile, or the keeper — hold ground
  // Build the building walk-block overlay once, only when a real de-stack is attempted (so a tick with no
  // crowded idle unit pays nothing). Excludes a target under a standing building: routing A* would refuse
  // a blocked goal, and a MoveGoal whose route can't resolve would freeze the unit (nothing clears a
  // failed non-player request), so we never aim at one.
  spacing.blockedCells ??= dynamicBlockedCells(world, ctx, terrain);
  const from = terrain.nodeAtClamped(tileX, tileY);
  const free = nearestFreeCell(terrain, from, spacing.occupancy, spacing.claimed, spacing.blockedCells);
  if (free === null) return; // boxed in — nothing better than staying
  spacing.claimed.add(free);
  world.add(e, MoveGoal, { cell: free });
}

/**
 * The Manhattan node radius of a work anchor's YARD — how far from a construction site's
 * interaction cell a builder may stand and still be working the site. Small enough that a crew
 * reads as clustered ON the site (4 half-cell nodes ≈ two visual tiles), large enough that the
 * realistic handful of parallel builders each finds a free cell. A named approximation: the
 * original shows several builders spread around one foundation (observed behavior), but nothing
 * readable pins the spread's size.
 */
export const WORK_YARD_RADIUS_NODES = 4;

/**
 * Claim a distinct STAND cell for a worker whose drive targets the shared `anchor` cell (a
 * construction site's interaction cell): the anchor itself when free, else the nearest free yard
 * cell — so parallel workers spread over the yard instead of stacking pixel-perfectly on one node.
 * Rules, in order:
 *
 *  - **Unowned settlers keep the exact-anchor behavior** (the same Owner gate as {@link deStackIdle}
 *    — the unowned golden/economy fixtures stay byte-identical).
 *  - **A worker already standing ALONE on a yard node stays put**, so a hammering builder never hops
 *    cells between swings: the choice is stable across re-plans by construction. Alone — not the
 *    {@link deStackIdle} keeper rule — because a worker mid-swing does not re-plan: a keeper
 *    arriving on a node where a fellow already swings would start a SECOND swing on top of it and
 *    stack for a whole swing's length, while stepping aside costs the arriver a few walk ticks.
 *  - Otherwise the nearest free cell to the anchor within {@link WORK_YARD_RADIUS_NODES} is claimed
 *    ({@link nearestFreeCell} — every returned cell is ≤ maxDepth 4-connected steps from the anchor,
 *    so its Manhattan distance also fits the stay-put test above and the two rules can never
 *    disagree). A full yard falls back to the anchor — the pre-slot stacking, never a refusal to
 *    work.
 *
 * Determinism: a canonical ring search plus an occupancy count, claims in planner order.
 */
export function claimWorkCell(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  anchor: NodeId,
  spacing: IdleSpacing,
): NodeId {
  if (!world.has(e, Owner)) return anchor; // unowned fixtures keep the shared-anchor behavior
  const hereXY = terrain.coordsOf(here);
  const anchorXY = terrain.coordsOf(anchor);
  const manhattan = Math.abs(hereXY.x - anchorXY.x) + Math.abs(hereXY.y - anchorXY.y);
  if (manhattan <= WORK_YARD_RADIUS_NODES) {
    const bucket = spacing.occupancy.at(hereXY.x, hereXY.y);
    // A planned owned settler is always in its own node's bucket (it is resting by the planner's
    // gates), so `claimed` needs no entry: the occupancy already keeps others off this cell.
    if (bucket.length === 0 || (bucket.length === 1 && bucket[0] === e)) return here;
  }
  spacing.blockedCells ??= dynamicBlockedCells(world, ctx, terrain);
  const free = nearestFreeCell(
    terrain,
    anchor,
    spacing.occupancy,
    spacing.claimed,
    spacing.blockedCells,
    WORK_YARD_RADIUS_NODES,
  );
  if (free === null) return anchor; // yard full — fall back to the shared anchor
  spacing.claimed.add(free);
  return free;
}

/**
 * The nearest cell to `from` (checking `from` itself first) that is walkable, unblocked by a
 * building, holds no resting occupant, and hasn't been claimed by another spacing consumer this
 * tick — a breadth-first ring search over the graph's canonical N,E,S,W neighbours (so the first
 * hit at the minimum distance is history-independent), bounded by {@link SPACING_SEARCH_CAP}
 * visited nodes and, when given, `maxDepth` rings. Returns null when nothing free is reachable
 * within the caps. Blocked cells are neither entered nor traversed, mirroring the pathfinder that
 * will carry the move out. (For the de-stack caller the `from` check is inert: it de-stacks only a
 * CROWDED node, which is never free.)
 */
function nearestFreeCell(
  terrain: TerrainGraph,
  from: NodeId,
  occupancy: NodeBuckets,
  claimed: ReadonlySet<NodeId>,
  blocked: ReadonlySet<NodeId>,
  maxDepth = Number.POSITIVE_INFINITY,
): NodeId | null {
  const isFree = (cell: NodeId): boolean => {
    if (claimed.has(cell) || blocked.has(cell)) return false;
    const { x, y } = terrain.coordsOf(cell);
    return occupancy.at(x, y).length === 0;
  };
  if (terrain.isWalkable(from) && isFree(from)) return from;
  const seen = new Set<NodeId>([from]);
  let frontier: NodeId[] = [from];
  let visited = 0;
  let depth = 0;
  while (frontier.length > 0 && visited < SPACING_SEARCH_CAP && depth < maxDepth) {
    depth++;
    const next: NodeId[] = [];
    for (const cell of frontier) {
      for (const n of terrain.walkableNeighbours(cell)) {
        if (seen.has(n) || blocked.has(n)) continue;
        seen.add(n);
        visited++;
        if (isFree(n)) return n;
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}
