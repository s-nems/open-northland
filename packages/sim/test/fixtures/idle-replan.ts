import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import { idleReplanDue } from '../../src/systems/settlers/planner/idle-replan.js';

/** The first tick from `from` on which idle `e` re-plans, for a planner pass run by hand. */
export function idleReplanTick(e: Entity, from: number): number {
  let tick = from;
  while (!idleReplanDue(tick, e)) tick++;
  return tick;
}

/** Step at least once, until the tick just run was idle `e`'s re-plan tick: a standing settler takes up
 *  new work only then. */
export function stepToIdleReplan(sim: Simulation, e: Entity): void {
  do sim.step();
  while (!idleReplanDue(sim.tick, e));
}
