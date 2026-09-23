import { Building, JobAssignment, UnderConstruction } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { atOrWalk } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { PlannerSpacing } from '../../planner/spacing.js';
import { claimWorkCell, deStackIdle } from '../spacing.js';
import { fetchNeededMaterial } from './site-supply.js';

/**
 * SITE STAFF - a worker posted to a building that is still going up hauls its construction bill, then
 * waits at it, without changing trade or employment. The same help applies during an upgrade.
 * Waiting reads off `jobtypes.ini` `mustHaveFinishedWorkHouseFlag`, applied as a blanket
 * because the flag is not extracted into the IR; that over-applies to its 0 rows, so a hunter posted to a
 * store's gatherer slot stops hunting while the store is upgraded.
 *
 * Source basis: authored project rule, since the original has no pre-completion staff to observe.
 */
export function planSiteStaff(
  plan: PlannerContext,
  spacing: PlannerSpacing,
  hx: number,
  hy: number,
): boolean {
  const { world, terrain, entity: e, here } = plan;
  const site = boundConstructionSite(plan);
  if (site === null) return false;
  if (fetchNeededMaterial(plan, spacing, site)) return true;
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
