import { Obstructed, PathFollow, Position, WalkFacing } from '../../../../components/index.js';
import { type Fixed, fx, ULP } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { HALF_ROW, worldDistance } from '../../../../nav/world-metric.js';
import { clearNavState, dropPath } from '../../nav-state.js';
import { SLOWEST_PACE_PER_TICK } from '../../system.js';

/** Consecutive low-progress ticks before a walker drops its path and asks the planner to reroute. */
export const OBSTRUCTED_REROUTE_TICKS = 4;

/** Reroutes without reaching the goal before a walker stands down entirely. */
export const OBSTRUCTED_MAX_REROUTES = 4;

/** Baseline progress threshold; slow captured step costs lower it further. */
export const OBSTRUCTED_PROGRESS_FLOOR: Fixed = fx.div(SLOWEST_PACE_PER_TICK, fx.fromInt(3));

/** End the current grind window while preserving a non-zero reroute tally for this walk. */
export function clearGrind(world: World, entity: Entity): void {
  const obstruction = world.tryMut(entity, Obstructed);
  if (obstruction === undefined) return;
  if (obstruction.reroutes === 0) {
    world.remove(entity, Obstructed);
    return;
  }
  const position = world.get(entity, Position);
  obstruction.ticks = 0;
  obstruction.x = position.x;
  obstruction.y = position.y;
}

/**
 * Maintain the firm-body grind window after collision resolution. Soft movers never grind; a firm
 * mover in its own calm zone or without a post or firm mover in reach (`firmNear`) clears the window.
 * Otherwise a bounded low-progress window first drops the current path, then eventually the whole
 * navigation goal.
 */
export function updateObstruction(
  world: World,
  entity: Entity,
  isFirm: boolean,
  ghost: boolean,
  firmNear: boolean,
): void {
  if (!isFirm) return;
  const cost = world.tryGet(entity, PathFollow)?.legCost ?? 0;
  const facing = world.tryGet(entity, WalkFacing);
  if (cost > 0 && facing !== undefined && facing.direction !== facing.target) {
    clearGrind(world, entity);
    return;
  }
  if (ghost || !firmNear) {
    clearGrind(world, entity);
    return;
  }

  const position = world.get(entity, Position);
  const obstruction =
    world.tryMut(entity, Obstructed) ??
    world.add(entity, Obstructed, {
      ticks: 0,
      reroutes: 0,
      x: position.x,
      y: position.y,
    });
  obstruction.ticks += 1;
  const sinceAnchor = worldDistance(obstruction.x, obstruction.y, position.x, position.y);
  const pacedFloor = cost > 0 ? fx.div(HALF_ROW, fx.fromInt(cost * 3)) : OBSTRUCTED_PROGRESS_FLOOR;
  const floor =
    pacedFloor < ULP ? ULP : pacedFloor < OBSTRUCTED_PROGRESS_FLOOR ? pacedFloor : OBSTRUCTED_PROGRESS_FLOOR;
  if (sinceAnchor >= fx.mul(floor, fx.fromInt(obstruction.ticks))) {
    obstruction.ticks = 0;
    obstruction.x = position.x;
    obstruction.y = position.y;
    return;
  }
  if (obstruction.ticks < OBSTRUCTED_REROUTE_TICKS) return;

  if (obstruction.reroutes >= OBSTRUCTED_MAX_REROUTES) {
    clearNavState(world, entity);
    world.remove(entity, Obstructed);
    return;
  }
  dropPath(world, entity);
  obstruction.ticks = 0;
  obstruction.x = position.x;
  obstruction.y = position.y;
  obstruction.reroutes += 1;
}
