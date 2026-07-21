import { CraftSelection, GatherSelection, JobAssignment } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { jobCanHarvest, removeWorkFlag } from '../flags.js';

/**
 * Bind `e` to `workplace` as `jobType` and retire what the previous employment owned: a gatherer bound to a
 * building harvests its stored goods instead of a flag yard, and a gather/craft pick made at another post
 * would mis-steer this one, which offers a different product and store set.
 *
 * The single home of that reset, shared by the JobSystem's automatic assignment and the player's
 * `assignWorker` order, so the two employment paths cannot drift.
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
