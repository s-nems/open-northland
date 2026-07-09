import { MoveGoal, Owner } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CellId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockedCells } from '../footprint/index.js';
import type { TileBuckets } from '../spatial.js';

// The IDLE-SPACING drive — the planner's last resort for a unit with nothing to do: step off a tile
// shared with another resting unit so an idle crowd spreads out instead of stacking.

/**
 * The planner-tick idle-spacing state, built once per tick from the tick-start positions (stable
 * across the planner loop's own mutations — deliberately NOT updated as units are re-tasked):
 * `occupancy` buckets the owned resting units by tile, `claimed` stops two de-stackers choosing the
 * same free cell, and `blockedCells` lazily memoises the building walk-block overlay so a tick with
 * no crowded idle unit never builds it.
 */
export interface IdleSpacing {
  readonly occupancy: TileBuckets;
  readonly claimed: Set<CellId>;
  blockedCells?: ReadonlySet<CellId>;
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
  const from = terrain.cellAtClamped(tileX, tileY);
  const free = nearestFreeCell(terrain, from, spacing.occupancy, spacing.claimed, spacing.blockedCells);
  if (free === null) return; // boxed in — nothing better than staying
  spacing.claimed.add(free);
  world.add(e, MoveGoal, { cell: free });
}

/**
 * The nearest cell to `from` that is walkable, unblocked by a building, holds no resting occupant, and
 * hasn't been claimed by another de-stacker this tick — a breadth-first ring search over the graph's
 * canonical N,E,S,W neighbours (so the first hit at the minimum distance is history-independent),
 * bounded by {@link SPACING_SEARCH_CAP}. Returns null when nothing free is reachable within the cap.
 * Blocked cells are neither entered nor traversed, mirroring the pathfinder that will carry the move out.
 */
function nearestFreeCell(
  terrain: TerrainGraph,
  from: CellId,
  occupancy: TileBuckets,
  claimed: ReadonlySet<CellId>,
  blocked: ReadonlySet<CellId>,
): CellId | null {
  const seen = new Set<CellId>([from]);
  let frontier: CellId[] = [from];
  let visited = 0;
  while (frontier.length > 0 && visited < SPACING_SEARCH_CAP) {
    const next: CellId[] = [];
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
