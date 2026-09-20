import { Building, JobAssignment, UnderConstruction, Upgrading } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { isCarrierJob } from '../../../stores/index.js';
import { atOrWalk } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { claimWorkCell, deStackIdle } from '../spacing.js';
import { fetchNeededMaterial } from './site-supply.js';

/**
 * Remaster rule: future staff help supply their own new workplace without changing trade or employment.
 * Upgrades retain the carrier-only supply policy; incumbent workers' upgrade duties are unchanged.
 */
export function planSiteStaff(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  hx: number,
  hy: number,
): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const site = boundConstructionSite(plan);
  if (site === null) return false;
  if ((!world.has(site, Upgrading) || isCarrierJob(ctx, plan.jobType)) && fetchNeededMaterial(plan, site)) {
    return true;
  }
  const stand = claimWorkCell(world, terrain, e, here, site, spacing);
  if (stand === null) deStackIdle(world, terrain, e, hx, hy, spacing);
  else atOrWalk(world, e, here, stand, () => {});
  return true;
}

/** The settler's bound workplace while it is still a construction site of its own tribe, else null. */
export function boundConstructionSite(plan: PlannerContext): Entity | null {
  const { world, entity, tribe } = plan;
  const workplace = world.tryGet(entity, JobAssignment)?.workplace;
  if (workplace === undefined || !world.has(workplace, UnderConstruction)) return null;
  return world.tryGet(workplace, Building)?.tribe === tribe ? workplace : null;
}
