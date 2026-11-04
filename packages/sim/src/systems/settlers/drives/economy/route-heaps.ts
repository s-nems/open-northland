import { JobAssignment, Position, TradeRoute } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { nodeOfPosition } from '../../../../nav/halfcell.js';
import type { PlannerContext } from '../../planner/context.js';
import { interactionCell } from '../../targets/index.js';
import { DOOR_HEAP_RADIUS_NODES } from './workshop/door-heap.js';

/** The door of a trade stop and the goods a route fills it with from the porter's own store. */
interface FilledDoor {
  readonly hx: number;
  readonly hy: number;
  readonly goods: readonly number[];
}

/**
 * Whether a ground pile's good lies in the door heap of a stop that a trade route fills from the porter's
 * own store: what that stop had no room for. Lifting it back would hand the route the same units to carry
 * out again, a loop that moves them between the store and the heap for good (our rule). The routes are
 * read once, on the first pile asked about.
 */
export function routeReturnTest(plan: PlannerContext): (pile: Entity, good: number) => boolean {
  const { world } = plan;
  const home = world.tryGet(plan.entity, JobAssignment)?.workplace;
  let doors: readonly FilledDoor[] | null = null;
  return (pile, good) => {
    if (home === undefined) return false;
    doors ??= filledDoors(plan, home);
    if (doors.length === 0) return false;
    const p = world.get(pile, Position);
    const at = nodeOfPosition(p.x, p.y);
    return doors.some(
      (door) =>
        door.goods.includes(good) &&
        Math.abs(at.hx - door.hx) + Math.abs(at.hy - door.hy) <= DOOR_HEAP_RADIUS_NODES,
    );
  };
}

/** The doors of the other stops of every route that stops at `store`, each with the goods it marks. */
function filledDoors(plan: PlannerContext, store: Entity): FilledDoor[] {
  const { world, ctx, terrain } = plan;
  const found: FilledDoor[] = [];
  // Each route adds its own doors, so the routes' store order cannot change the answer.
  for (const trader of world.query(TradeRoute)) {
    const { stops } = world.get(trader, TradeRoute);
    if (!stops.some((stop) => stop.house === store)) continue;
    for (const stop of stops) {
      if (stop.house === store || stop.imports.length === 0 || !world.has(stop.house, Position)) continue;
      const door = terrain.coordsOf(interactionCell(world, ctx, terrain, stop.house));
      found.push({ hx: door.x, hy: door.y, goods: stop.imports.map((mark) => mark.good) });
    }
  }
  return found;
}
