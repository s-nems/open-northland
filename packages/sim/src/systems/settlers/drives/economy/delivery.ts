import {
  Building,
  Carrying,
  DeliveryFlag,
  JobAssignment,
  PathRequest,
  Position,
  UnderConstruction,
  WorkFlag,
  YardDeliveryRoute,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { farmWorkGood } from '../../../economy/fields.js';
import { constructionWorkCell } from '../../../footprint/index.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { clearNavState } from '../../../spatial/nodes.js';
import { stampSupplyRun } from '../../../stores/index.js';
import { dropCarryAtOwnTile } from '../../atomics/effects/goods/index.js';
import { atOrWalk, PILEUP_ATOMIC_ID, startAtomic, startDrop } from '../../atomics/start.js';
import { enterBuilding } from '../../indoors.js';
import type { PlannerContext } from '../../planner/context.js';
import { interactionCell, nearestFreeYardNode } from '../../targets/index.js';
import { deliveryTargetFor } from './delivery-targets.js';
import { isBoundToStorageSink } from './store-policy.js';

/**
 * Drop a stamped yard route that no longer holds - the settler still carries the routed good, is still
 * bound to that flag, and the flag still stands - before the planner re-runs its ladder. A still-valid
 * route whose walk failed is marked `failed` instead, so the drive resumes the yard ring search strictly
 * after the proven-unreachable tile.
 */
export function reconcileYardRoute(world: World, e: Entity): void {
  const route = world.tryGet(e, YardDeliveryRoute);
  if (route === undefined) return;
  const load = world.tryGet(e, Carrying);
  const workFlag = world.tryGet(e, WorkFlag);
  const valid =
    load !== undefined &&
    load.amount > 0 &&
    load.goodType === route.goodType &&
    workFlag !== undefined &&
    workFlag.flag === route.flag &&
    world.has(route.flag, DeliveryFlag);
  if (!valid) {
    world.remove(e, YardDeliveryRoute);
    return;
  }
  const request = world.tryGet(e, PathRequest);
  if (!route.failed && request?.failed === true && request.goal === route.goal) {
    world.mut(e, YardDeliveryRoute).failed = true;
    clearNavState(world, e);
  }
}

/** Deposit a carried load, or hold/drop it deterministically when no eligible sink exists. */
export function planDelivery(plan: PlannerContext, load: { goodType: number; amount: number }): void {
  const { world, ctx, terrain, entity, here, targets, inbound } = plan;
  const worker = plan;
  const store = deliveryTargetFor(plan, load.goodType);

  if (store === null) {
    world.remove(entity, YardDeliveryRoute);
    const workplace = world.tryGet(entity, JobAssignment)?.workplace;
    // A settler posted to a passive store sheds an undeliverable surplus through an instant set-down that
    // costs no atomic; producers keep their load and wait inside instead.
    if (
      workplace !== undefined &&
      isBoundToStorageSink(world, ctx, entity) &&
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
      enterBuilding(world, entity, workplace, here, interactionCell(world, ctx, terrain, workplace, here));
      return;
    }
    // A settler still bound to a living sink keeps its load, since dropping only churns: it would
    // re-collect and re-drop. Only an orphaned settler - unbound, or bound to a destroyed workplace -
    // sets the load down.
    if (workplace === undefined || !world.isAlive(workplace)) startDrop(world, ctx, entity);
    return;
  }

  // Stamp the site errand so later-planned settlers count it as inbound and do not re-fetch the same unit.
  if (world.has(store, UnderConstruction)) {
    stampSupplyRun(world, entity, inbound, { site: store, goodType: load.goodType, amount: load.amount });
  }
  // A route naming a different flag or good than the sink just chosen is spent; the flag branch re-stamps.
  const toFlag = world.has(store, DeliveryFlag);
  const priorYard = world.tryGet(entity, YardDeliveryRoute);
  const sameYard =
    priorYard !== undefined && priorYard.flag === store && priorYard.goodType === load.goodType
      ? priorYard
      : undefined;
  if (priorYard !== undefined && sameYard === undefined) world.remove(entity, YardDeliveryRoute);

  let cell: NodeId | null;
  if (toFlag) {
    // A flag is a marker, not a stock sink: the load goes to a free tile of its yard.
    cell =
      sameYard !== undefined && !sameYard.failed
        ? sameYard.goal
        : nearestFreeYardNode(
            targets.yard,
            world,
            terrain,
            store,
            load.goodType,
            here,
            sameYard?.goal,
            plan.limit ?? undefined,
          );
  } else if (world.has(store, UnderConstruction)) {
    cell = constructionWorkCell(world, ctx, terrain, store, targets.yard.blocked, here);
  } else {
    cell = interactionCell(world, ctx, terrain, store, here);
  }
  if (cell === null) return;
  if (toFlag) {
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
