import { Settler, Sheltering } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { sheltersOnAlarm } from '../readviews/index.js';
import { stepOut } from '../settlers/indoors.js';
import { clearNavState } from '../spatial/nodes.js';
import { shelterStillHolds } from './shelters.js';

/**
 * DefenceSystem - the release half of defence mode: a civilian keeps its {@link Sheltering} claim only
 * while the building it claimed still holds a garrison and it is still a civilian. Everything else about
 * the mode lives elsewhere - the alarm itself is the `setDefenceMode` order, the run for cover is the
 * planner's shelter drive (`settlers/drives/shelter.ts`), and the fire from inside is the CombatSystem's.
 *
 * Releasing HERE rather than in the drive is what makes "switch one tower off and its people run to the
 * other" work: the claim is gone before the planner's next pass, so the freed settler re-claims a
 * still-enabled building the same tick instead of standing in a building that stopped sheltering it.
 *
 * Scale: iterates the {@link Sheltering} carriers alone - a set bounded by the enabled buildings' total
 * `shelterCapacity` - so a peaceful map with no alarm pays one empty query.
 */
export const defenceSystem: System = (world, ctx) => {
  for (const e of world.query(Sheltering)) {
    if (holdsItsShelter(world, ctx, e)) continue;
    releaseShelter(world, e);
  }
};

/** Whether `e`'s claim still stands: its building still holds a garrison, and the settler is still one of
 *  the trades that runs for cover (a civilian drilled into a soldier mid-alarm goes back to fighting). */
function holdsItsShelter(world: World, ctx: SystemContext, e: Entity): boolean {
  const settler = world.tryGet(e, Settler);
  if (settler === undefined || !sheltersOnAlarm(ctx.content, settler.jobType)) return false;
  return shelterStillHolds(world, ctx, world.get(e, Sheltering).shelter);
}

/** Drop `e`'s claim and put it back on the map: out of the building, and off any route the shelter drive
 *  had it walking, so the planner re-plans it (onto another shelter, or back to its trade) this tick. */
export function releaseShelter(world: World, e: Entity): void {
  world.remove(e, Sheltering);
  stepOut(world, e);
  clearNavState(world, e);
}
