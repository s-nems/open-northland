import { Building, JobAssignment, UnderConstruction } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { isCarrierJob } from '../../../stores/index.js';
import { atOrWalk } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { claimWorkCell, deStackIdle } from '../spacing.js';
import { fetchNeededMaterial } from './site-supply.js';

/**
 * SITE STAFF - a worker posted to a building that is still going up hauls its construction bill (a carrier)
 * or waits at it (every other trade). Waiting rather than working is the readable original: `jobtypes.ini`
 * gives every bound trade we model `mustHaveFinishedWorkHouseFlag 1`, collapsed to a blanket here (its 0
 * rows - hunter/scout/jester - never bind a workplace at all).
 *
 * The stand goes through {@link claimWorkCell}, so staff spread over the site's perimeter alongside the
 * build crew. The binding survives the rise, so work starts the tick the building is finished.
 *
 * source-basis: that a posted worker exists before completion at all is a user rule,
 * as is a carrier supplying its own site; the original has no pre-completion staff to observe. Only the
 * "wait, do not work" half is readable data.
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
