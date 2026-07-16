import {
  Building,
  DeliveryFlag,
  JobAssignment,
  Position,
  Resting,
  UnderConstruction,
  YardDeliveryRoute,
} from '../../../components/index.js';
import { farmWorkGood } from '../../economy/farming.js';
import { atomicDuration } from '../../readviews/animations.js';
import { stampSupplyRun } from '../../stores/index.js';
import { atOrWalk, PILEUP_ATOMIC_ID, startAtomic } from '../actions.js';
import { dropCarryAtOwnTile } from '../effects-goods/index.js';
import type { PlannerContext } from '../planner-context.js';
import { interactionCell, nearestFreeYardNode } from '../targets/index.js';
import { isPorterBoundToStore } from './haul-targets.js';
import { deliveryTargetFor } from './routing.js';

/** Deposit a carried load, or hold/drop it deterministically when no eligible sink exists. */
export function planDelivery(plan: PlannerContext, load: { goodType: number; amount: number }): void {
  const { world, ctx, terrain, entity, here, targets, inbound } = plan;
  const worker = plan;
  const store = deliveryTargetFor(plan, load.goodType);

  if (store === null) {
    world.remove(entity, YardDeliveryRoute);
    const workplace = world.tryGet(entity, JobAssignment)?.workplace;
    // A porter at a passive store sheds an undeliverable surplus so another good can be hauled;
    // producers instead keep their load and wait inside their completed workplace. These are the
    // existing no-sink branches, kept here beside delivery routing so their priority cannot drift.
    if (
      workplace !== undefined &&
      isPorterBoundToStore(world, ctx, entity) &&
      farmWorkGood(world, ctx, workplace) === null &&
      dropCarryAtOwnTile(world, entity) > 0
    ) {
      return;
    }
    if (
      workplace !== undefined &&
      world.has(workplace, Building) &&
      !world.has(workplace, UnderConstruction) &&
      world.has(workplace, Position)
    ) {
      atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, workplace, here), () =>
        world.add(entity, Resting, { at: workplace }),
      );
    }
    return;
  }

  // A load headed for a construction site is a live supply errand: stamp it so later-planned settlers
  // count it as inbound (SupplyRun — no duplicate fetch of a unit already on someone's back).
  if (world.has(store, UnderConstruction)) {
    stampSupplyRun(world, entity, inbound, { site: store, goodType: load.goodType, amount: load.amount });
  }
  const priorYard = world.tryGet(entity, YardDeliveryRoute);
  if (!world.has(store, DeliveryFlag)) world.remove(entity, YardDeliveryRoute);
  const sameYard =
    priorYard !== undefined && priorYard.flag === store && priorYard.goodType === load.goodType
      ? priorYard
      : undefined;
  if (priorYard !== undefined && sameYard === undefined) world.remove(entity, YardDeliveryRoute);
  const cell = world.has(store, DeliveryFlag)
    ? sameYard !== undefined && !sameYard.failed
      ? sameYard.goal
      : // A flag is a marker, not a stock sink: resume after a proven failed yard candidate, or start nearest.
        nearestFreeYardNode(
          targets.yard,
          world,
          terrain,
          store,
          load.goodType,
          here,
          sameYard?.goal,
          plan.limit ?? undefined,
        )
    : interactionCell(world, ctx, terrain, store, here);
  if (cell === null) return;
  if (world.has(store, DeliveryFlag)) {
    world.add(entity, YardDeliveryRoute, { flag: store, goodType: load.goodType, goal: cell, failed: false });
  }
  atOrWalk(world, entity, here, cell, () => {
    world.remove(entity, YardDeliveryRoute);
    startAtomic(
      world,
      entity,
      PILEUP_ATOMIC_ID,
      { kind: 'pileup', store },
      atomicDuration(ctx.content, worker, PILEUP_ATOMIC_ID),
      store,
    );
  });
}
