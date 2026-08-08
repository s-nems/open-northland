import { CraftSelection, GatherSelection, JobAssignment, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { jobCanHarvest, removeWorkFlag, syncWorkFlagToJob } from '../work-flag.js';

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

/**
 * Unbind `e` from its workplace and give back what the post had taken over: a gathering trade gets a flag
 * yard at its feet again, and the picks die with the employment they were made under. The exact inverse of
 * {@link bindEmployment}, so the player's release order and a razed workplace leave a settler in one state.
 *
 * The picks must go here rather than at the next post: `presentOperators` seats a workshop from a settler's
 * tile and trade alone, so a released craftsman still standing in the doorway would steer that workshop's
 * rotation by a product he was picked for elsewhere.
 */
export function releaseEmployment(world: World, ctx: SystemContext, e: Entity): void {
  world.remove(e, JobAssignment);
  const jobType = world.tryGet(e, Settler)?.jobType;
  if (jobType != null) syncWorkFlagToJob(world, ctx, e, jobType);
  world.remove(e, GatherSelection);
  world.remove(e, CraftSelection);
}
