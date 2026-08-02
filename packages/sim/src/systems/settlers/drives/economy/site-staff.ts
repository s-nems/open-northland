import { Building, JobAssignment, UnderConstruction } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { isCarrierJob } from '../../../stores/index.js';
import { atOrWalk } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { claimWorkCell, deStackIdle } from '../spacing.js';
import { fetchNeededMaterial } from './site-supply.js';

/**
 * SITE STAFF - what a worker posted to a building that is still going up does until it stands. A building
 * takes its staff from the moment its foundation is placed (same slots, same per-slot limits - see
 * `openWorkerJobFromList`), and an upgrade keeps the crew it already had, so both cases land here:
 *
 *  - a **carrier** posted to the site hauls its construction bill, exactly as the builders' own supply trips
 *    do ({@link fetchNeededMaterial} - the delivery drive then routes the load to the site). This is the
 *    whole point of posting a hauler to a foundation: the crew stops walking its own material.
 *  - **every other trade** - a baker with no oven yet - waits at the site instead of working: its trade needs
 *    the finished workhouse (readable source: `jobtypes.ini` `mustHaveFinishedWorkHouseFlag`, per-job data
 *    collapsed to a blanket here - every bound trade we model sets 1, and the 0 rows (hunter/scout/jester)
 *    never bind a workplace). Standing AT the site rather than wherever it happened to be is what makes the
 *    wait readable on screen. A carrier with nothing left to fetch waits with them.
 *
 * The wait stand goes through {@link claimWorkCell}, the same spread the build crew uses, so staff and
 * builders share the site's perimeter instead of stacking on one cell; with no free perimeter cell the
 * settler just de-stacks where it is. The binding survives the build either way, so work starts the tick the
 * building is finished.
 */
export function planSiteStaff(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  hx: number,
  hy: number,
): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const site = boundSite(plan);
  if (site === null) return false;
  if (isCarrierJob(ctx, plan.jobType) && fetchNeededMaterial(plan, site)) return true;
  const stand = claimWorkCell(world, terrain, e, here, site, spacing);
  if (stand === null) deStackIdle(world, terrain, e, hx, hy, spacing);
  else atOrWalk(world, e, here, stand, () => {});
  return true;
}

/** The settler's bound workplace while it is still a construction site of its own tribe, else null. */
function boundSite(plan: PlannerContext): Entity | null {
  const { world, entity, tribe } = plan;
  const workplace = world.tryGet(entity, JobAssignment)?.workplace;
  if (workplace === undefined || !world.has(workplace, UnderConstruction)) return null;
  return world.tryGet(workplace, Building)?.tribe === tribe ? workplace : null;
}
