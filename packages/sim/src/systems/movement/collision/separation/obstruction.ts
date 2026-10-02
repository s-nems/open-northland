import {
  MoveGoal,
  Obstructed,
  PathFollow,
  PathRequest,
  Position,
  WalkFacing,
} from '../../../../components/index.js';
import { type Fixed, fx, ULP } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { HALF_ROW, worldDistance } from '../../../../nav/world-metric.js';
import { clearNavState, dropPath, restartLeg } from '../../nav-state.js';
import { routeStartCell } from '../../route-start.js';
import { SLOWEST_PACE_PER_TICK } from '../../system.js';

/** Consecutive low-progress ticks before a walker asks for a route around the blockers. */
export const OBSTRUCTED_REROUTE_TICKS = 4;

/** Low-progress windows without reaching the goal before a walker stands down entirely. */
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
  restartWindow(world, entity, obstruction);
}

/** Begin a fresh window where `entity` stands. A window that ended without a reroute is progress, so the
 *  walker asks at its next stall rather than waiting out a hold. */
function restartWindow(
  world: World,
  entity: Entity,
  obstruction: { ticks: number; hold: number; x: Fixed; y: Fixed },
): void {
  const position = world.get(entity, Position);
  obstruction.ticks = 0;
  obstruction.hold = 0;
  obstruction.x = position.x;
  obstruction.y = position.y;
}

/**
 * Maintain the firm-body grind window after collision resolution. Soft movers never grind; a firm
 * mover in its own calm zone or without a post or firm mover in reach (`firmNear`) clears the window.
 * Otherwise each low-progress window asks for a route around the blockers unless a hold is still being
 * waited out, and a bounded run of windows drops the whole navigation goal.
 */
export function updateObstruction(
  world: World,
  terrain: TerrainGraph,
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
      hold: 0,
      x: position.x,
      y: position.y,
    });
  obstruction.ticks += 1;
  const sinceAnchor = worldDistance(obstruction.x, obstruction.y, position.x, position.y);
  const pacedFloor = cost > 0 ? fx.div(HALF_ROW, fx.fromInt(cost * 3)) : OBSTRUCTED_PROGRESS_FLOOR;
  const floor =
    pacedFloor < ULP ? ULP : pacedFloor < OBSTRUCTED_PROGRESS_FLOOR ? pacedFloor : OBSTRUCTED_PROGRESS_FLOOR;
  if (sinceAnchor >= fx.mul(floor, fx.fromInt(obstruction.ticks))) {
    restartWindow(world, entity, obstruction);
    return;
  }
  if (obstruction.ticks < OBSTRUCTED_REROUTE_TICKS) return;

  if (obstruction.reroutes >= OBSTRUCTED_MAX_REROUTES) {
    clearNavState(world, entity);
    world.remove(entity, Obstructed);
    return;
  }
  if (obstruction.hold > 0) {
    obstruction.hold -= 1;
    restartLeg(world, entity);
  } else {
    requestGrindReroute(world, terrain, entity, position);
  }
  obstruction.ticks = 0;
  obstruction.x = position.x;
  obstruction.y = position.y;
  obstruction.reroutes += 1;
}

/**
 * Ask for a route from where `entity` stands to its goal beside the live route; routing keeps the live one
 * when the answer matches it. A walk without a goal has nothing to re-plan and drops its path.
 */
function requestGrindReroute(
  world: World,
  terrain: TerrainGraph,
  entity: Entity,
  position: { x: Fixed; y: Fixed },
): void {
  const goal = world.tryGet(entity, MoveGoal)?.cell;
  if (goal === undefined) {
    dropPath(world, entity);
    return;
  }
  if (world.has(entity, PathRequest)) return;
  const start = routeStartCell(terrain, position.x, position.y);
  world.add(entity, PathRequest, { start, goal, failed: false, grind: true });
}
