import { grassNodeMap as grassMap } from '../../fixtures/terrain.js';

export { grassMap };

import { PathFollow, Position, WalkFacing, type Waypoint } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, type Simulation } from '../../../src/index.js';
import { nodeOfPosition } from '../../../src/nav/halfcell.js';

/**
 * Unit + integration tests for the MovementSystem's path-following mode - the seam that consumes a
 * {@link PathFollow}, paces each leg by the original's per-step tick cost (`walkStepTicks`: the roughness
 * of the node the leg leaves plus the walker's state), steps the entity toward each stop, advances the
 * index on arrival, and drops the path when complete. The Velocity-only mode is covered by the
 * determinism golden.
 *
 * Every fixture map here carries no roughness lane, so a step leaves land (`DEFAULT_NODE_ROUGHNESS` 2):
 * a rested, barefoot, unladen walker takes 8 ticks a step, a shod one 6.
 */

export const GRASS = 0;

/** Ticks per step off land for the bare walker every test starts with, and for one wearing live boots. */
export const LAND_STEP_TICKS = 8;
export const LAND_STEP_TICKS_SHOD = 6;

/** Build a mapped sim and place an entity at (x,y) with a straight-line PathFollow to the waypoints, minted
 *  as routing mints one: the first stop is where the walker stands, so the walk starts toward the second.
 *  Waypoints go through `fx.fromFloat` (exact for the test values used) so a diagonal midpoint's
 *  fractional x can be expressed directly; each stop's node is the lattice node under it. */
export function followerAt(
  sim: Simulation,
  x: number,
  y: number,
  waypoints: Array<{ x: number; y: number }>,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  // Pace fixtures start facing east; turn timing and the engine's initial SW heading have separate tests.
  sim.world.add(e, WalkFacing, { direction: 0, target: 0 });
  sim.world.add(e, PathFollow, {
    waypoints: waypoints.map((w) => waypointAt(sim, w.x, w.y)),
    index: waypoints.length >= 2 ? 1 : 0,
    legTicks: 0,
    legCost: 0,
  });
  return e;
}

/** A stop at fractional tile coordinates whose node is the lattice node its position truncates to. */
export function waypointAt(sim: Simulation, x: number, y: number): Waypoint {
  const fxX = fx.fromFloat(x);
  const fxY = fx.fromFloat(y);
  const n = nodeOfPosition(fxX, fxY);
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('waypointAt needs a mapped sim');
  return { x: fxX, y: fxY, node: terrain.nodeAtClamped(n.hx, n.hy) };
}

export function pos(sim: Simulation, e: Entity): { x: number; y: number } {
  const p = sim.world.get(e, Position);
  return { x: fx.toFloat(p.x), y: fx.toFloat(p.y) };
}

/** Step until the path completes, returning the tick count (bounded so a regression can't hang). */
export function ticksToArrive(sim: Simulation, e: Entity, bound = 400): number {
  let ticks = 0;
  while (sim.world.has(e, PathFollow)) {
    sim.step();
    ticks++;
    if (ticks > bound) throw new Error('path never completed');
  }
  return ticks;
}
