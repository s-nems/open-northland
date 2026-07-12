import {
  Building,
  DeliveryFlag,
  JobAssignment,
  Position,
  Resting,
  UnderConstruction,
} from '../../../components/index.js';
import { farmWorkGood } from '../../economy/farming.js';
import { atomicDuration } from '../../readviews/animations.js';
import { atOrWalk, PILEUP_ATOMIC_ID, startAtomic } from '../actions.js';
import { dropCarryAtOwnTile } from '../effects-goods.js';
import type { PlannerContext } from '../planner-context.js';
import { interactionCell, nearestFreeYardNode } from '../targets/index.js';
import { deliveryTargetFor, isPorterBoundToStore } from './workshop/supply.js';

/** Deposit a carried load, or hold/drop it deterministically when no eligible sink exists. */
export function planDelivery(plan: PlannerContext, load: { goodType: number; amount: number }): boolean {
  const { world, ctx, terrain, entity, here, targets } = plan;
  const worker = plan;
  const store = deliveryTargetFor(
    targets.stockpiles,
    targets.constructionSites,
    world,
    ctx,
    terrain,
    here,
    entity,
    worker.jobType,
    worker.tribe,
    load.goodType,
  );

  if (store === null) {
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
      return true;
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
    return true;
  }

  const cell = world.has(store, DeliveryFlag)
    ? // A flag is a marker, not a stock sink: the pile belongs on a free yard node around it.
      nearestFreeYardNode(targets.stockpiles, world, terrain, store, load.goodType)
    : interactionCell(world, ctx, terrain, store, here);
  atOrWalk(world, entity, here, cell, () =>
    startAtomic(
      world,
      entity,
      PILEUP_ATOMIC_ID,
      { kind: 'pileup', store },
      atomicDuration(ctx.content, worker, PILEUP_ATOMIC_ID),
      store,
    ),
  );
  return true;
}
