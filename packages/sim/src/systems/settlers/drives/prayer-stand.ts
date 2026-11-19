import { Position } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { HEX_DIRECTIONS, hexHeadingBetween, nodeOfPosition, stepHex } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { type NavigationLimit, rankFromSpot } from '../../signposts/index.js';
import { hexNodeDistance } from '../../spatial/metric.js';
import { rankLength, rankWalk } from '../../spatial/walk-rank.js';
import type { PlannerSpacing } from '../planner/spacing.js';
import { interactionCell } from '../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';

/** Authored outdoor placement: stand one hex back from the entrance or footprint perimeter.
 * Keep an arriving worshipper's stand stable; no original work-area coordinates are assumed. */
export function prayerStand(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  entity: Entity,
  site: Entity,
  here: NodeId,
  spacing: PlannerSpacing,
  limit: NavigationLimit | null,
): NodeId | null {
  const blocked = spacing.blockedCells();
  const failed = unreachableGoals(world, ctx, entity);
  const component = terrain.componentOf(here);
  const usable = (cell: NodeId): boolean => {
    if (
      !terrain.isWalkable(cell) ||
      blocked.has(cell) ||
      spacing.isClaimed(cell) ||
      terrain.componentOf(cell) !== component ||
      isUnreachableGoal(failed, cell) ||
      (limit !== null && !limit.allowsNode(cell))
    )
      return false;
    const { x, y } = terrain.coordsOf(cell);
    return spacing.occupancy.at(x, y).every((occupant) => occupant === entity);
  };
  const position = world.get(site, Position);
  const anchor = nodeOfPosition(position.x, position.y);
  const stepBack = (cell: NodeId): NodeId | null => {
    const { x, y } = terrain.coordsOf(cell);
    // An anchor-only site has no authored front; use the south-west side consistently.
    const direction =
      x === anchor.hx && y === anchor.hy
        ? 'southWest'
        : (HEX_DIRECTIONS[hexHeadingBetween(anchor.hx, anchor.hy, x, y)] ?? 'southWest');
    const back = stepHex({ hx: x, hy: y }, direction);
    return terrain.inBounds(back.hx, back.hy) ? terrain.nodeAt(back.hx, back.hy) : null;
  };
  const door = stepBack(interactionCell(world, ctx, terrain, site, here));
  const perimeter = spacing.workCells(site).flatMap((cell) => {
    const back = stepBack(cell);
    return back === null ? [] : [back];
  });
  if ((here === door || perimeter.includes(here)) && usable(here)) return here;
  if (door !== null && usable(door)) return door;
  // By the settler's walk where its confinement measures one, which no hex distance undercuts.
  const walk = rankWalk(rankFromSpot(limit, here));
  let nearest: NodeId | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const cell of perimeter) {
    const direct = hexNodeDistance(terrain, here, cell);
    if (direct > distance || !usable(cell)) continue;
    const gap = rankLength(walk, cell, direct, distance);
    if (gap < distance || (gap === distance && (nearest === null || cell < nearest))) {
      nearest = cell;
      distance = gap;
    }
  }
  return nearest;
}
