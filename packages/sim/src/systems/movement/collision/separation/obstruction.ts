import { Obstructed, PathFollow, Position } from '../../../../components/index.js';
import { type Fixed, fx } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { worldDistance } from '../../../../nav/metric.js';
import { clearNavState } from '../../../spatial.js';
import { MOVE_SPEED_PER_TICK } from '../../movement.js';

/** Consecutive low-progress ticks before a walker drops its path and asks the planner to reroute. */
export const OBSTRUCTED_REROUTE_TICKS = 4;

/** Reroutes without reaching the goal before a walker stands down entirely. */
export const OBSTRUCTED_MAX_REROUTES = 4;

/** Minimum total progress per tick of the obstruction window — one third of walking gait. */
export const OBSTRUCTED_PROGRESS_FLOOR: Fixed = fx.div(MOVE_SPEED_PER_TICK, fx.fromInt(3));

/** End the current grind window while preserving a non-zero reroute tally for this walk. */
export function clearGrind(world: World, entity: Entity): void {
  const obstruction = world.tryGet(entity, Obstructed);
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
 * mover in its own calm zone or near only soft traffic clears the window. Otherwise a bounded
 * low-progress window first drops the current path, then eventually the whole navigation goal.
 */
export function updateObstruction(
  world: World,
  entity: Entity,
  isFirm: boolean,
  ghost: boolean,
  nearPosts: readonly Entity[],
  nearMovers: readonly Entity[],
  firmMovers: ReadonlySet<Entity>,
): void {
  if (!isFirm) return;
  const firmNear = nearPosts.length > 0 || nearMovers.some((neighbor) => firmMovers.has(neighbor));
  if (ghost || !firmNear) {
    clearGrind(world, entity);
    return;
  }

  const position = world.get(entity, Position);
  const obstruction =
    world.tryGet(entity, Obstructed) ??
    world.add(entity, Obstructed, {
      ticks: 0,
      reroutes: 0,
      x: position.x,
      y: position.y,
    });
  obstruction.ticks += 1;
  const sinceAnchor = worldDistance(obstruction.x, obstruction.y, position.x, position.y);
  if (sinceAnchor >= fx.mul(OBSTRUCTED_PROGRESS_FLOOR, fx.fromInt(obstruction.ticks))) {
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
  world.remove(entity, PathFollow);
  obstruction.ticks = 0;
  obstruction.x = position.x;
  obstruction.y = position.y;
  obstruction.reroutes += 1;
}
