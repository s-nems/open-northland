import { JobAssignment } from '../../../../components/index.js';
import { isCarrierJob } from '../../../stores/index.js';
import { walkPickupBatch } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import type { IdleStands } from '../../planner/idle-replan.js';
import { nearestWorkplaceOutput } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';
import { deliverableGoodProbe } from './delivery-targets.js';
import { haulFlagArea, waitAtHaulFlag } from './haul-flag-area.js';
import { porterPickupTarget } from './haul-targets.js';
import { markPorterDormant, porterDormant, wakePorter } from './porter-dormancy.js';
import { isBoundToStorageSink } from './store-policy.js';

/** A porter: the transport trade posted to a storage fixture. A store seats gathering trades beside its
 *  transport slots, so the post alone does not name one. */
function isPorterBoundToStore(plan: PlannerContext): boolean {
  return isCarrierJob(plan.ctx, plan.jobType) && isBoundToStorageSink(plan.world, plan.ctx, plan.entity);
}

/**
 * PORTER - a carrier bound to a storage fixture that moves loose goods. A carrier at a producing building
 * hauls its finished output out to a warehouse first, so the producer's store keeps clearing; any bound
 * carrier then brings loose ground piles in. A warehouse or HQ carrier only ever reaches the bring-in half.
 * One holding a pickup flag lifts ground piles and workshop output only around it and, with nothing there,
 * waits at the flag rather than falling through to haul output from elsewhere.
 */
export function planPorter(plan: PlannerContext, idle: IdleStands): boolean {
  const { world, entity: e } = plan;
  if (!isPorterBoundToStore(plan)) return false;
  const area = haulFlagArea(plan);
  const dormant = porterDormant(plan);
  const pick = dormant ? null : porterPickupTarget(plan);
  if (pick === null) {
    if (!dormant) markPorterDormant(plan);
    if (area === null) return false;
    idle.stand(e, false);
    waitAtHaulFlag(plan, area);
    return true;
  }
  wakePorter(world, e);
  walkPickupBatch(plan, pick.from, pick.goodType);
  return true;
}

/**
 * STORE-CARRIER HAUL - an employed carrier hauls a finished workplace output to a store, so producing
 * workshops do not clog. Nobody else ferries: transport is a job one is hired for, never a default pastime
 * (observed original behaviour), and a carrier hauls only through its assignment. `anyHaulable` is the
 * planner's per-tick dormancy gate: with nothing haulable anywhere the per-settler scan is provably null.
 */
export function planCarrierHaul(plan: PlannerContext, anyHaulable: boolean): boolean {
  const { world, ctx, entity: e, here, targets } = plan;
  const settler = plan;
  if (!isCarrierJob(ctx, settler.jobType)) return false;
  if (!world.has(e, JobAssignment)) return false;
  const haul = anyHaulable
    ? nearestWorkplaceOutput(
        targets.stockpileCells,
        deliverableGoodProbe(plan),
        world,
        ctx,
        here,
        plan.owner,
        plan.limit ?? undefined,
        unreachableGoalVeto(world, ctx, e),
      )
    : null;
  if (haul === null) return false;
  walkPickupBatch(plan, haul.workplace, haul.goodType);
  return true;
}
