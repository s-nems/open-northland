import { JobAssignment, Settler, Stockpile, UnderConstruction } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { jobCanHarvestGood } from '../../../economy/work-flag.js';
import { exportedGoodForm } from '../../../readviews/index.js';
import { bankedSlot } from '../../../stores/index.js';
import type { PlannerContext } from '../../planner/context.js';
import {
  DELIVERY_RULES,
  type DeliverySearchArea,
  type DeliveryVerdict,
  deliverySearchArea,
} from './delivery-rules.js';

/** The store a settler carrying `goodType` should deliver it to, or null when no rule can place the load. */
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
 * Where this settler's `good` would be delivered right now, or null: the same decision the delivery rung
 * makes once the good is on its back. Probes the carried form, memoized per planner call.
 */
export function deliverySinkProbe(plan: PlannerContext): (goodType: number) => Entity | null {
  const memo = new Map<number, Entity | null>();
  return (rawGoodType: number): Entity | null => {
    const goodType = carriedGoodForm(plan.world, plan.ctx, plan.entity, rawGoodType);
    // Tick-global precondition: when no store anywhere could take the good, skip the routing walk. It
    // deliberately ignores construction-site sinks, which builders supply through their own fetch rung.
    if (!plan.targets.sinks.has(goodType)) return null;
    let known = memo.get(goodType);
    if (known === undefined) {
      known = deliveryTargetFor(plan, goodType);
      memo.set(goodType, known);
    }
    return known;
  };
}

/**
 * The units of `goodType` the store this carrier would deliver it to still has room for, so a cart lifts
 * no more of a good than lands, yet always the unit the routing admitted; unbounded for a sink that is
 * no shelf, a site or a flag's yard. Zero with no sink.
 */
export function sinkRoomFor(plan: PlannerContext, goodType: number): number {
  const { world, ctx, entity: e } = plan;
  const carried = carriedGoodForm(world, ctx, e, goodType);
  const sink = deliveryTargetFor(plan, carried);
  if (sink === null) return 0;
  if (world.has(sink, UnderConstruction) || !world.has(sink, Stockpile)) return Number.POSITIVE_INFINITY;
  const slot = bankedSlot(world, ctx, sink, carried);
  return Math.max(1, slot.capacity - (world.get(sink, Stockpile).amounts.get(slot.goodType) ?? 0));
}

/** Whether this settler's `good` would be delivered into its own workplace right now: what a store's
 *  porter, which works for its store alone (owner ruling), may lift. */
export function homeBoundGoodProbe(plan: PlannerContext): (goodType: number) => boolean {
  const sink = deliverySinkProbe(plan);
  const home = plan.world.tryGet(plan.entity, JobAssignment)?.workplace;
  return (goodType) => home !== undefined && sink(goodType) === home;
}

/** Whether this settler's `good` could be delivered anywhere right now, so a pickup rung cannot lift a
 *  load that would be shed at its feet and re-lifted next tick. */
export function deliverableGoodProbe(plan: PlannerContext): (goodType: number) => boolean {
  const sink = deliverySinkProbe(plan);
  return (goodType) => sink(goodType) !== null;
}

/**
 * The form `goodType` takes on a settler's back when lifted: a dish becomes its edible unless the lifter's
 * own trade harvests it raw, so a hunter lifts meat as meat while anyone else lifting the same unit holds
 * food. Source basis: observation of the original.
 */
export function carriedGoodForm(world: World, ctx: SystemContext, settler: Entity, goodType: number): number {
  const jobType = world.tryGet(settler, Settler)?.jobType;
  if (jobType !== null && jobType !== undefined && jobCanHarvestGood(ctx, jobType, goodType)) {
    return goodType;
  }
  return exportedGoodForm(ctx, goodType);
}
