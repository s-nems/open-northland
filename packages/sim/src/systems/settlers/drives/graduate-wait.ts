import { GraduateWait, MoveGoal, sameSide } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { routeRegions } from '../../footprint/index.js';
import { isSchoolOrFoundation } from '../../orders/education.js';
import type { NavigationLimit } from '../../signposts/index.js';
import type { PlannerSpacing } from '../planner/spacing.js';
import { interactionCell } from '../targets/index.js';
import { loiterCell } from './spacing.js';
import { drillDoorOpen } from './training.js';

/**
 * The idle tail's walk back to the school a graduate waits by (`GraduateWait`): an idler outside the
 * school's yard is sent to a free yard cell. Returns true when it sent the settler walking. Already in the
 * yard, or with the yard full, it idles where it stands. A wait whose school is gone, lost to another
 * side, or out of reach ends here.
 */
export function planGraduateWait(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  spacing: PlannerSpacing,
  limit: NavigationLimit | null,
): boolean {
  const wait = world.tryGet(e, GraduateWait);
  if (wait === undefined) return false;
  const door =
    isSchoolOrFoundation(world, ctx, wait.school) && sameSide(world, e, wait.school)
      ? interactionCell(world, ctx, terrain, wait.school, here)
      : null;
  if (door === null || !drillDoorOpen(world, ctx, e, door, limit)) {
    world.remove(e, GraduateWait);
    return false;
  }
  const stand = loiterCell(world, terrain, e, here, door, spacing);
  if (stand === here) return false;
  // Shipped to another island, or walled off: the walk could only fail, so the wait ends.
  if (
    terrain.componentOf(stand) !== terrain.componentOf(here) ||
    routeRegions(world, ctx, terrain).unroutable(here, stand)
  ) {
    world.remove(e, GraduateWait);
    return false;
  }
  world.add(e, MoveGoal, { cell: stand });
  return true;
}
