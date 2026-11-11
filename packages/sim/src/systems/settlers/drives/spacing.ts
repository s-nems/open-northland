import { MoveGoal, Owner, Residence, Stance } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { hasOpenSide } from '../../../nav/nearest.js';
import { ringSearch, STAND_SEARCH_CAP } from '../../../nav/ring-search.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { builtHomeType } from '../../family/households.js';
import { moveAnchor } from '../../orders/combat.js';
import { nearestCell } from '../../spatial/metric.js';
import type { PlannerSpacing } from '../planner/spacing.js';
import { interactionCell } from '../targets/index.js';

// The spacing drives, the two consumers of the planner-tick occupancy state: idle units step off a shared
// tile so a crowd spreads out, and construction workers claim distinct perimeter cells. Body collision can
// do neither: civilians are deliberate pass-through, and only walking movers are ever displaced.

/**
 * The idle-spacing drive: a resting owned settler sharing its node with a lower-id resting owned settler is
 * sent to the nearest free node. The lowest-id occupant keeps the tile, and a unit boxed in stays.
 *
 * Transit is never blocked; only a unit that has arrived with nothing to do relocates. Returns the node it
 * sent the unit to, or null when it stays.
 */
export function deStackIdle(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  tileX: number,
  tileY: number,
  spacing: PlannerSpacing,
): NodeId | null {
  // Only owned units space out: an unowned settler is absent from `occupancy`, so the keeper test below
  // could never recognise it as the keeper and it would wrongly de-stack.
  if (!world.has(e, Owner)) return null;
  const bucket = spacing.occupancy.at(tileX, tileY);
  if (bucket.length < 2 || bucket[0] === e) return null;
  // Never aim at a cell under a standing building: A* refuses a blocked goal, and a MoveGoal whose route
  // cannot resolve would freeze the unit.
  const from = terrain.nodeAtClamped(tileX, tileY);
  const free = nearestFreeCell(terrain, from, spacing);
  if (free === null) return null;
  spacing.claim(free);
  world.add(e, MoveGoal, { cell: free });
  return free;
}

/**
 * {@link deStackIdle} for a DEFEND guard, whose hold ends the ladder before the idle tail: a guard standing
 * on its own anchor moves the post to the free node it steps to, or the combat walk-back would lead it
 * straight back onto the stack. Recruits leaving one barracks door fan out this way. A guard off its
 * anchor is left to that walk-back. Source basis: authored.
 */
export function deStackGuard(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  hx: number,
  hy: number,
  spacing: PlannerSpacing,
): void {
  const here = terrain.nodeAtClamped(hx, hy);
  if ((world.tryGet(e, Stance)?.anchorCell ?? here) !== here) return;
  const free = deStackIdle(world, terrain, e, hx, hy, spacing);
  if (free !== null) moveAnchor(world, ctx.content, e, free);
}

/** A resident with no current errand leaves the door clear for incoming deliveries and sleepers.
 * Approximation: the adjacent idle stand is chosen by the existing workplace yard rule. */
export function stepOffHomeDoor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  spacing: PlannerSpacing,
): boolean {
  if (!world.has(e, Owner)) return false;
  const home = world.tryGet(e, Residence)?.home;
  if (home === undefined || builtHomeType(world, ctx, home) === undefined) return false;
  const door = interactionCell(world, ctx, terrain, home, here);
  if (here !== door) return false;
  const nearby = loiterCell(world, terrain, e, here, door, spacing);
  const stand = nearby === here ? nearestFreeCell(terrain, here, spacing) : nearby;
  if (stand === null || stand === here) return false;
  if (nearby === here) spacing.claim(stand);
  world.add(e, MoveGoal, { cell: stand });
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
 * worker already alone on a yard cell that is neither the anchor nor a doorway and keeps an open side
 * stays put, and with no free yard cell it stays where it is: loitering is a stance, never a refusal that
 * must relocate someone. Source basis: authored.
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
  const doorways = spacing.doorways();
  const blocked = spacing.blockedCells();
  // Doors and their passages stay free, and a stand keeps an exit.
  if (yard.has(here) && here !== anchor && !doorways.has(here)) {
    const bucket = spacing.occupancy.at(terrain.xOf(here), terrain.yOf(here));
    const alone = bucket.length === 0 || (bucket.length === 1 && bucket[0] === e);
    if (alone && hasOpenSide(terrain, here, blocked)) return here;
  }
  for (const cell of yard) {
    if (cell === anchor || doorways.has(cell) || spacing.isClaimed(cell)) continue;
    if (spacing.occupancy.at(terrain.xOf(cell), terrain.yOf(cell)).length > 0) continue;
    if (!hasOpenSide(terrain, cell, blocked)) continue;
    spacing.claim(cell);
    return cell;
  }
  return here;
}

/**
 * The nearest cell to `from` that is walkable, unblocked, off every doorway, keeps an open side, holds no
 * resting occupant, and is unclaimed this tick, or null when nothing free is reachable within the search
 * cap. Blocked cells are neither entered nor traversed, mirroring the pathfinder that will carry the move
 * out.
 */
export function nearestFreeCell(terrain: TerrainGraph, from: NodeId, spacing: PlannerSpacing): NodeId | null {
  const blocked = spacing.blockedCells();
  const doorways = spacing.doorways();
  return ringSearch(terrain, from, STAND_SEARCH_CAP, {
    traverse: (n) => !blocked.has(n),
    accept: (n) => {
      if (spacing.isClaimed(n) || doorways.has(n)) return false;
      if (spacing.occupancy.at(terrain.xOf(n), terrain.yOf(n)).length > 0) return false;
      return hasOpenSide(terrain, n, blocked);
    },
  });
}
