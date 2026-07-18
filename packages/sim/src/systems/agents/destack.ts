import { MoveGoal, Owner } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { constructionWorkCells, dynamicBlockedCells } from '../footprint/index.js';
import type { NodeBuckets } from '../spatial.js';

// The spacing drives — the two consumers of the planner-tick occupancy state:
//  - idle spacing ({@link deStackIdle}): the last resort for a unit with nothing to do — step off a tile
//    shared with another resting unit so an idle crowd spreads out instead of stacking;
//  - work slots ({@link claimWorkCell}): builders converging on one construction site claim distinct
//    perimeter cells. Body collision can't do this: civilians are deliberate pass-through, and
//    the SeparationSystem displaces only walking movers — two units standing on one node are never pushed apart.

/**
 * The planner-tick spacing state, built once per tick from the tick-start positions (stable across the
 * planner loop's own mutations — deliberately not updated as units are re-tasked): `occupancy` buckets the
 * owned resting units by tile, `claimed` stops two spacing consumers choosing the same free cell,
 * `blockedCells` lazily memoises the building walk-block overlay, `constructionCells` memoises each site's
 * work perimeter, `crewLeadBySite` memoises each site's lead (lowest-id) builder, and `yards` memoises
 * completed-workplace loiter regions.
 */
export interface SpacingState {
  readonly occupancy: NodeBuckets;
  readonly claimed: Set<NodeId>;
  blockedCells?: ReadonlySet<NodeId>;
  constructionCells?: Map<Entity, readonly NodeId[]>;
  crewLeadBySite?: Map<Entity, Entity>;
  yards?: Map<NodeId, ReadonlySet<NodeId>>;
}

/** Max nodes a de-stack ring search visits before giving up — a boxed-in unit simply stays put.
 *  Quadrupled with the half-cell migration: nodes are 4× denser per world area, so this cap covers
 *  the same on-screen search radius the old 48-cell cap did. */
const SPACING_SEARCH_CAP = 192;

/**
 * The idle-spacing drive: if `e` — a resting, owned, otherwise-idle settler on half-cell node (tileX,tileY)
 * — shares that node with a lower-id resting owned settler, send it (a {@link MoveGoal}) to the nearest free
 * node so the two don't stand stacked. The lowest-id occupant is the keeper (it stays); every other occupant
 * steps aside. A unit boxed in (no free node within the search cap) just stays.
 *
 * The sim half of the "no hard collision, but units won't come to rest on an occupied node" behaviour:
 * transit is never blocked (a walker passes through freely), only a unit that has arrived with nothing to do
 * relocates off a shared node. Returns true when it sent the unit stepping aside — the caller's lower rung
 * (the idle chat) yields to it, so a stacked crowd spreads out before striking up conversations.
 */
export function deStackIdle(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  tileX: number,
  tileY: number,
  spacing: SpacingState,
): boolean {
  // Only player-owned units space out. An unowned settler isn't in the owned-only `occupancy`, so the keeper
  // test below (`bucket[0] === e`) could never recognise it as the keeper — without this guard an unowned unit
  // sharing a tile with ≥2 owned resting units would wrongly de-stack. Gating here keeps the unowned fixtures
  // byte-identical.
  if (!world.has(e, Owner)) return false;
  const bucket = spacing.occupancy.at(tileX, tileY);
  if (bucket.length < 2 || bucket[0] === e) return false; // alone on the tile, or the keeper — hold ground
  // Build the building walk-block overlay once, only when a real de-stack is attempted. Excludes a target
  // under a standing building: routing A* would refuse a blocked goal, and a MoveGoal whose route can't
  // resolve would freeze the unit (nothing clears a failed non-player request), so we never aim at one.
  spacing.blockedCells ??= dynamicBlockedCells(world, ctx, terrain);
  const from = terrain.nodeAtClamped(tileX, tileY);
  const free = nearestFreeCell(terrain, from, spacing.occupancy, spacing.claimed, spacing.blockedCells);
  if (free === null) return false; // boxed in — nothing better than staying
  spacing.claimed.add(free);
  world.add(e, MoveGoal, { cell: free });
  return true;
}

/**
 * The 4-connected radius of a completed workplace's loiter yard (4 half-cell steps ≈ two visual tiles).
 * This is a presentation tuning value, not extracted data.
 */
const WORKPLACE_YARD_RADIUS_NODES = 4;

/**
 * Claim the nearest free perimeter cell for a construction worker. A worker already alone on a legal cell
 * stays there between swings; otherwise `(distance, node id)` chooses deterministically, and a full perimeter
 * falls back to stacking on its nearest legal cell rather than aiming inside the building body.
 */
export function claimWorkCell(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  site: Entity,
  spacing: SpacingState,
): NodeId | null {
  spacing.blockedCells ??= dynamicBlockedCells(world, ctx, terrain);
  spacing.constructionCells ??= new Map();
  let cells = spacing.constructionCells.get(site);
  if (cells === undefined) {
    cells = constructionWorkCells(world, ctx, terrain, site, spacing.blockedCells);
    spacing.constructionCells.set(site, cells);
  }
  if (cells.length === 0) return null;
  if (!world.has(e, Owner)) return nearestWorkCell(terrain, cells, here);
  if (cells.includes(here)) {
    const hereXY = terrain.coordsOf(here);
    const bucket = spacing.occupancy.at(hereXY.x, hereXY.y);
    if (bucket.length === 0 || (bucket.length === 1 && bucket[0] === e)) return here;
  }
  const free = nearestWorkCell(terrain, cells, here, (cell) => {
    if (spacing.claimed.has(cell)) return false;
    const { x, y } = terrain.coordsOf(cell);
    return spacing.occupancy.at(x, y).length === 0;
  });
  if (free !== null) {
    spacing.claimed.add(free);
    return free;
  }
  return nearestWorkCell(terrain, cells, here);
}

function nearestWorkCell(
  terrain: TerrainGraph,
  cells: readonly NodeId[],
  from: NodeId,
  accept: (cell: NodeId) => boolean = () => true,
): NodeId | null {
  const origin = terrain.coordsOf(from);
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    if (!accept(cell)) continue;
    const candidate = terrain.coordsOf(cell);
    const distance = Math.abs(candidate.x - origin.x) + Math.abs(candidate.y - origin.y);
    if (distance < bestDistance || (distance === bestDistance && (best === null || cell < best))) {
      best = cell;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Claim a stand cell BESIDE the shared `anchor` for a worker with nothing to do — the "bored by the door"
 * stand (user-directed behaviour: an off-duty worker loiters visibly next to its workplace door, not on
 * it). It shares the planner-tick occupancy and cell claims used by construction spacing, but keeps its
 * own door-centred yard: the anchor itself is never returned, so a loitering operator never lands on the
 * node {@link presentOperatorCount} reads (standing ON the door would silently run the workshop). A worker
 * already alone on a non-anchor yard cell stays put (stable across re-plans); with no free yard cell it
 * simply stays where it is (`here`) — loitering is a stance, never a refusal that must relocate someone.
 */
export function loiterCell(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  anchor: NodeId,
  spacing: SpacingState,
): NodeId {
  if (!world.has(e, Owner)) return here; // unowned fixtures never relocate (the deStackIdle Owner gate)
  spacing.blockedCells ??= dynamicBlockedCells(world, ctx, terrain);
  spacing.yards ??= new Map();
  let yard = spacing.yards.get(anchor);
  if (yard === undefined) {
    yard = yardCells(terrain, anchor, spacing.blockedCells);
    spacing.yards.set(anchor, yard);
  }
  if (here !== anchor && yard.has(here)) {
    const hereXY = terrain.coordsOf(here);
    const bucket = spacing.occupancy.at(hereXY.x, hereXY.y);
    if (bucket.length === 0 || (bucket.length === 1 && bucket[0] === e)) return here;
  }
  for (const cell of yard) {
    if (cell === anchor) continue; // the door node stays free — loiterers stand beside it
    if (spacing.claimed.has(cell)) continue;
    const { x, y } = terrain.coordsOf(cell);
    if (spacing.occupancy.at(x, y).length > 0) continue;
    spacing.claimed.add(cell);
    return cell;
  }
  return here; // no free yard cell — stay put rather than stack on the door
}

/**
 * A workplace anchor's loiter yard: every walkable, unblocked node reachable from `anchor` within
 * {@link WORKPLACE_YARD_RADIUS_NODES} 4-connected steps, in canonical ring order (anchor first when it
 * qualifies — Set insertion order is the claim priority). Blocked cells are neither entered nor
 * traversed, mirroring the pathfinder, so the yard never spans a wall or a stream the walk
 * couldn't cross. Bounded: ≤ ~2·R² nodes visited.
 */
function yardCells(terrain: TerrainGraph, anchor: NodeId, blocked: ReadonlySet<NodeId>): ReadonlySet<NodeId> {
  const yard = new Set<NodeId>();
  if (terrain.isWalkable(anchor) && !blocked.has(anchor)) yard.add(anchor);
  const seen = new Set<NodeId>([anchor]);
  let frontier: NodeId[] = [anchor];
  for (let depth = 0; depth < WORKPLACE_YARD_RADIUS_NODES; depth++) {
    const next: NodeId[] = [];
    for (const cell of frontier) {
      for (const n of terrain.walkableNeighbours(cell)) {
        if (seen.has(n) || blocked.has(n)) continue;
        seen.add(n);
        yard.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return yard;
}

/**
 * The nearest cell to `from` that is walkable, unblocked by a building, holds no resting occupant, and
 * hasn't been claimed by another spacing consumer this tick — a breadth-first ring search over the
 * graph's canonical N,E,S,W neighbours (so the first hit at the minimum distance is
 * history-independent), bounded by {@link SPACING_SEARCH_CAP}. Returns null when nothing free is
 * reachable within the cap. Blocked cells are neither entered nor traversed, mirroring the pathfinder
 * that will carry the move out.
 */
function nearestFreeCell(
  terrain: TerrainGraph,
  from: NodeId,
  occupancy: NodeBuckets,
  claimed: ReadonlySet<NodeId>,
  blocked: ReadonlySet<NodeId>,
): NodeId | null {
  const seen = new Set<NodeId>([from]);
  let frontier: NodeId[] = [from];
  let visited = 0;
  while (frontier.length > 0 && visited < SPACING_SEARCH_CAP) {
    const next: NodeId[] = [];
    for (const cell of frontier) {
      for (const n of terrain.walkableNeighbours(cell)) {
        if (seen.has(n) || blocked.has(n)) continue;
        seen.add(n);
        visited++;
        const { x, y } = terrain.coordsOf(n);
        if (!claimed.has(n) && occupancy.at(x, y).length === 0) return n;
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}
