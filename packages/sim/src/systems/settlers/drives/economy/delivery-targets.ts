import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { exportedGoodForm } from '../../../readviews/index.js';
import { buildingProduces } from '../../../stores/index.js';
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
 * Pass `from` when the good would be lifted out of a known store: a dish leaving the house that produces
 * it is routed as the edible it becomes ({@link exportedGoodForm}), since that is what the carrier will be
 * holding. Without `from` — or from a ground pile, or a store that merely holds the good — the raw form is
 * routed, so a hunter's meat heap still reaches the animal farm that stocks meat. The memo keys on the
 * carried form, so two dishes sharing an edible answer from one routing walk.
 */
export function deliverableGoodProbe(plan: PlannerContext): (goodType: number, from?: Entity) => boolean {
  const memo = new Map<number, boolean>();
  return (rawGoodType: number, from?: Entity): boolean => {
    const goodType = carriedGoodForm(plan.world, plan.ctx, from, rawGoodType);
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
 * The form `goodType` takes on a settler's back when lifted out of `from` — a dish leaving the house that
 * produces it becomes its edible ({@link exportedGoodForm}); everything else is carried as itself.
 *
 * The producer test is what keeps the conversion meaning "out of the kitchen". `meat` is a dish AND a
 * map-harvested good with its own gathering pipeline: converting it wherever it was found would stop a
 * porter routing a meat heap to `work_animal_farm`, the one store that stocks meat. Shared by the pickup
 * rungs' routing probe and by `pickupFromStore`, so plan and effect never disagree about the load.
 */
export function carriedGoodForm(
  world: World,
  ctx: SystemContext,
  from: Entity | null | undefined,
  goodType: number,
): number {
  if (from === null || from === undefined) return goodType;
  if (!buildingProduces(world, ctx, from).includes(goodType)) return goodType;
  return exportedGoodForm(ctx, goodType);
}
