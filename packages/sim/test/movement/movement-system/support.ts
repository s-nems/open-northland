import { grassNodeMap as grassMap } from '../../fixtures/terrain.js';

export { grassMap };

import { PathFollow, Position } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, type Simulation } from '../../../src/index.js';
import { ACCEL_TICKS, MOVE_SPEED_PER_TICK } from '../../../src/systems/index.js';

/**
 * Unit + integration tests for the MovementSystem's path-following mode — the seam that consumes a
 * {@link PathFollow}, ramps the gait (the movement-inertia approximation: accelerate from rest,
 * shed speed through corners, brake into the final waypoint), steps the entity toward each
 * cell-centre waypoint, advances the waypoint index on arrival, and drops the path when complete.
 * The Velocity-only mode is covered by the determinism golden; here we pin the path-follow
 * behaviour, the gait ramp, and the precedence rule.
 *
 * Tick-count pins are derived from the model: gait G = divCeil(ONE/18) = 3641,
 * accel A = divCeil(G/3) = 1214 per tick, brake floor F = divCeil(G/2) = 1821, brake target =
 * remaining/2 on the final leg. An E/W step at cruise is bit-exact G (fused mulDiv), so a cruise
 * cell is exactly WALK_TICKS_PER_CELL ticks.
 */

export const GRASS = 0;

export const FX_ZERO = fx.fromInt(0);

/** The gait ramp's per-tick acceleration at the default walk (divCeil(G/3) — see ACCEL_TICKS). */
export const ACCEL_STEP = fx.divCeil(MOVE_SPEED_PER_TICK, fx.fromInt(ACCEL_TICKS));

/** Build a mapped sim and place an entity at (x,y) with a straight-line PathFollow to the waypoints.
 *  Waypoints go through `fx.fromFloat` (exact for the test values used) so a seam waypoint's
 *  half-column fractional x can be expressed directly. The gait starts at rest (speed 0, no heading),
 *  exactly as routing mints a fresh path. */
export function followerAt(
  sim: Simulation,
  x: number,
  y: number,
  waypoints: Array<{ x: number; y: number }>,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, PathFollow, {
    waypoints: waypoints.map((w) => ({ x: fx.fromFloat(w.x), y: fx.fromFloat(w.y) })),
    index: 0,
    speed: FX_ZERO,
    hx: FX_ZERO,
    hy: FX_ZERO,
  });
  return e;
}

export function pos(sim: Simulation, e: Entity): { x: number; y: number } {
  const p = sim.world.get(e, Position);
  return { x: fx.toFloat(p.x), y: fx.toFloat(p.y) };
}

/** Step until the path completes, returning the tick count (bounded so a regression can't hang). */
export function ticksToArrive(sim: Simulation, e: Entity, bound = 200): number {
  let ticks = 0;
  while (sim.world.has(e, PathFollow)) {
    sim.step();
    ticks++;
    if (ticks > bound) throw new Error('path never completed');
  }
  return ticks;
}
