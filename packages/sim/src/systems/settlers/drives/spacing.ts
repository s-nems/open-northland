import { MoveGoal, Owner } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { ringSearch, STAND_SEARCH_CAP } from '../../../nav/ring-search.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { nearestCell } from '../../footprint/geometry.js';
import type { PlannerSpacing } from '../planner/spacing.js';

// The spacing drives, the two consumers of the planner-tick occupancy state: idle units step off a shared
// tile so a crowd spreads out, and construction workers claim distinct perimeter cells. Body collision can
// do neither: civilians are deliberate pass-through, and only walking movers are ever displaced.

/**
 * The idle-spacing drive: a resting owned settler sharing its node with a lower-id resting owned settler is
 * sent to the nearest free node. The lowest-id occupant keeps the tile, and a unit boxed in stays.
 *
 * Transit is never blocked; only a unit that has arrived with nothing to do relocates. Returns true when it
 * sent the unit stepping aside.
 */
export function deStackIdle(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  tileX: number,
  tileY: number,
  spacing: PlannerSpacing,
): boolean {
  // Only owned units space out: an unowned settler is absent from `occupancy`, so the keeper test below
  // could never recognise it as the keeper and it would wrongly de-stack.
  if (!world.has(e, Owner)) return false;
  const bucket = spacing.occupancy.at(tileX, tileY);
  if (bucket.length < 2 || bucket[0] === e) return false;
  // Never aim at a cell under a standing building: A* refuses a blocked goal, and a MoveGoal whose route
  // cannot resolve would freeze the unit.
  const from = terrain.nodeAtClamped(tileX, tileY);
  const free = nearestFreeCell(terrain, from, spacing);
  if (free === null) return false;
  spacing.claim(free);
  world.add(e, MoveGoal, { cell: free });
  return true;
}

/**
 * Claim the nearest free perimeter cell for a construction worker. A worker already alone on a legal cell
 * stays there between swings; otherwise `(distance, node id)` chooses deterministically, and a full perimeter
 * falls back to stacking on its nearest legal cell rather than aiming inside the building body.
 */
export function claimWorkCell(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  site: Entity,
  spacing: PlannerSpacing,
): NodeId | null {
  const cells = spacing.workCells(site);
  if (cells.length === 0) return null;
  if (!world.has(e, Owner)) return nearestCell(terrain, cells, here);
  if (cells.includes(here)) {
    const hereXY = terrain.coordsOf(here);
    const bucket = spacing.occupancy.at(hereXY.x, hereXY.y);
    if (bucket.length === 0 || (bucket.length === 1 && bucket[0] === e)) return here;
  }
  const free = nearestCell(terrain, cells, here, (cell) => {
    if (spacing.isClaimed(cell)) return false;
    const { x, y } = terrain.coordsOf(cell);
    return spacing.occupancy.at(x, y).length === 0;
  });
  if (free !== null) {
    spacing.claim(free);
    return free;
  }
  return nearestCell(terrain, cells, here);
}

/**
 * Claim a stand cell beside the shared `anchor` for a worker with nothing to do. The anchor itself is never
 * returned, so a loitering operator never lands on the door node the production presence count reads. A
 * worker already alone on a non-anchor yard cell stays put, and with no free yard cell it stays where it
 * is: loitering is a stance, never a refusal that must relocate someone. Source basis: authored.
 */
export function loiterCell(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  anchor: NodeId,
  spacing: PlannerSpacing,
): NodeId {
  if (!world.has(e, Owner)) return here; // unowned fixtures never relocate
  const yard = spacing.yard(anchor);
  if (here !== anchor && yard.has(here)) {
    const hereXY = terrain.coordsOf(here);
    const bucket = spacing.occupancy.at(hereXY.x, hereXY.y);
    if (bucket.length === 0 || (bucket.length === 1 && bucket[0] === e)) return here;
  }
  for (const cell of yard) {
    if (cell === anchor) continue; // the door node stays free
    if (spacing.isClaimed(cell)) continue;
    const { x, y } = terrain.coordsOf(cell);
    if (spacing.occupancy.at(x, y).length > 0) continue;
    spacing.claim(cell);
    return cell;
  }
  return here;
}

/**
 * The nearest cell to `from` that is walkable, unblocked, holds no resting occupant, and is unclaimed this
 * tick, or null when nothing free is reachable within the search cap. Blocked cells are neither entered nor
 * traversed, mirroring the pathfinder that will carry the move out.
 */
function nearestFreeCell(terrain: TerrainGraph, from: NodeId, spacing: PlannerSpacing): NodeId | null {
  const blocked = spacing.blockedCells();
  return ringSearch(terrain, from, STAND_SEARCH_CAP, {
    traverse: (n) => !blocked.has(n),
    accept: (n) => {
      if (spacing.isClaimed(n)) return false;
      const { x, y } = terrain.coordsOf(n);
      return spacing.occupancy.at(x, y).length === 0;
    },
  });
}
