import { CraftSelection, GatherSelection, JobAssignment } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { jobCanHarvest, removeWorkFlag } from '../work-flag.js';

/**
 * Bind `e` to `workplace` as `jobType` and retire what the previous employment owned: a gatherer bound to a
 * building harvests its stored goods instead of a flag yard, and a gather or craft pick made at another
 * post would mis-steer this one, which offers a different product and store set.
 */
export function bindEmployment(
  world: World,
  ctx: SystemContext,
  e: Entity,
  workplace: Entity,
  jobType: number,
): void {
  world.add(e, JobAssignment, { workplace });
  if (jobCanHarvest(ctx, jobType)) removeWorkFlag(world, e);
  world.remove(e, GatherSelection);
  world.remove(e, CraftSelection);
}
