import { Settler, Sheltering } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { sheltersOnAlarm } from '../readviews/index.js';
import { stepOut } from '../settlers/indoors.js';
import { clearNavState } from '../spatial/nodes.js';
import { shelterStillHolds } from './shelters.js';

/**
 * The release half of defence mode: a civilian keeps its {@link Sheltering} claim only while the building
 * it claimed still holds a garrison and it is still a civilian. Releasing here rather than in the drive
 * frees the claim before the planner's next pass, so a settler whose building stopped sheltering it
 * re-claims a still-enabled one the same tick. Iterates the `Sheltering` carriers alone, so a map with no
 * alarm pays one empty query.
 */
export const defenceSystem: System = (world, ctx) => {
  // Releasing deletes the key just yielded, which a live-Map walk tolerates - no snapshot needed.
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
