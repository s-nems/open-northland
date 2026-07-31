import { Settler } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { jobCanHarvestGood } from '../../../economy/work-flag.js';
import { exportedGoodForm } from '../../../readviews/index.js';
import type { PlannerContext } from '../../planner/context.js';
import {
  DELIVERY_RULES,
  type DeliverySearchArea,
  type DeliveryVerdict,
  deliverySearchArea,
} from './delivery-rules.js';

/**
 * The store a settler carrying `goodType` should deliver it to — the first rule of {@link DELIVERY_RULES}
 * that answers, or null when none can take the load.
 */
export function deliveryTargetFor(plan: PlannerContext, goodType: number): Entity | null {
  // Resolved on the first searched rule, so a load a bound rule claims costs no confinement lookup.
  let area: DeliverySearchArea | null = null;
  for (const rule of DELIVERY_RULES) {
    let verdict: DeliveryVerdict;
    if (rule.kind === 'bound') {
      verdict = rule.resolve(plan, goodType);
    } else {
      area ??= deliverySearchArea(plan);
      verdict = rule.resolve(plan, goodType, area);
    }
    if (verdict === 'no-sink') return null;
    if (verdict !== null) return verdict;
  }
  return null;
}

/**
 * A memoized "could this settler's `good` actually be delivered anywhere right now" probe —
 * {@link deliveryTargetFor} under the settler's own signpost gate, the exact decision the delivery rung
 * makes once the good is on its back. The pickup rungs consult it before lifting, so fetch and delivery
 * can never disagree: a disagreement is a livelock (a porter lifting a pile whose only sink is out of its
 * area sheds it at its feet and re-lifts it next tick). Memoized per planner call — a scan probes few
 * distinct goods, and the answer is position-stable for the one decision the caller makes this tick.
 *
 * The probe routes the CARRIED form ({@link carriedGoodForm} - a dish converts in this settler's hands
 * unless its trade harvests it raw), since that is what would be on the back. The memo keys on the
 * carried form, so two dishes sharing an edible answer from one routing walk.
 */
export function deliverableGoodProbe(plan: PlannerContext): (goodType: number) => boolean {
  const memo = new Map<number, boolean>();
  return (rawGoodType: number): boolean => {
    const goodType = carriedGoodForm(plan.world, plan.ctx, plan.entity, rawGoodType);
    // Tick-global cheap precondition first ({@link SinkAvailability}): when no store ANYWHERE could take
    // the good, the full routing walk below is skipped — this keeps a saturated settlement (every store
    // full, every idle hauler re-probing each tick) at ~zero probe cost. It deliberately ignores
    // construction-site sinks, exactly like the pre-confinement gate: builders supply sites through
    // their own fetch rung, so a hauler passing on such a pile matches the long-standing behavior.
    if (!plan.targets.sinks.has(goodType)) return false;
    let known = memo.get(goodType);
    if (known === undefined) {
      known = deliveryTargetFor(plan, goodType) !== null;
      memo.set(goodType, known);
    }
    return known;
  };
}

/**
 * The form `goodType` takes on a settler's back when lifted - THE owner of the dish/raw rule: a dish
 * becomes its edible ({@link exportedGoodForm}) in anyone's hands but its own gathering trade's. The
 * hunter lifts meat as meat (its flag yard heaps MEAT, the original's landscape 44 piles), while a
 * porter, a carrier, or a hungry settler lifting the same unit, off a heap or a shelf alike, holds
 * food. Source basis: observed original behavior, user-reported (meat picked up by anyone but the
 * hunter turns into food). The exemption is {@link jobCanHarvestGood}, so a fisher will keep fish raw
 * the same way when fishing lands.
 *
 * Shared by the pickup rungs' routing probe and by `pickupFromStore`, so plan and effect never
 * disagree about the load.
 */
export function carriedGoodForm(world: World, ctx: SystemContext, settler: Entity, goodType: number): number {
  const jobType = world.tryGet(settler, Settler)?.jobType;
  if (jobType !== null && jobType !== undefined && jobCanHarvestGood(ctx, jobType, goodType)) {
    return goodType;
  }
  return exportedGoodForm(ctx, goodType);
}
