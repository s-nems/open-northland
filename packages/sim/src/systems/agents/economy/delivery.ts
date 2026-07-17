import {
  Building,
  Carrying,
  DeliveryFlag,
  JobAssignment,
  PathRequest,
  Position,
  Resting,
  UnderConstruction,
  WorkFlag,
  YardDeliveryRoute,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import { farmWorkGood } from '../../economy/farming.js';
import { constructionWorkCell } from '../../footprint/index.js';
import { atomicDuration } from '../../readviews/animations.js';
import { clearNavState } from '../../spatial.js';
import { stampSupplyRun } from '../../stores/index.js';
import { atOrWalk, PILEUP_ATOMIC_ID, startAtomic, startDrop } from '../actions.js';
import { dropCarryAtOwnTile } from '../effects-goods/index.js';
import type { PlannerContext } from '../planner-context.js';
import { interactionCell, nearestFreeYardNode } from '../targets/index.js';
import { isPorterBoundToStore } from './haul-targets.js';
import { deliveryTargetFor } from './routing.js';

/**
 * Reconcile the yard route {@link planDelivery} stamped on `e` against the settler's live state, before the
 * planner re-runs its ladder. The validity invariant of a stamped {@link YardDeliveryRoute} — the settler
 * still carries the routed good, is still bound to that flag, and the flag still stands — is enforced here
 * rather than at the read, so a route that outlived any of the three is dropped and the drive re-picks a
 * yard tile from scratch.
 *
 * A still-valid route whose walk failed this tick is marked `failed` instead: the drive then resumes the
 * yard ring search strictly AFTER the proven-unreachable tile (`sameYard.goal`), rejecting dynamically
 * enclosed candidates one at a time. Clearing the nav state here is what lets the drive re-issue the walk.
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
    route.failed = true;
    world.touch(e);
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
    // A porter at a passive store sheds an undeliverable surplus so another good can be hauled;
    // producers instead keep their load and wait inside their completed workplace. These are the
    // existing no-sink branches, kept here beside delivery routing so their priority cannot drift. The
    // porter shed is a deliberate INSTANT set-down (`dropCarryAtOwnTile`, no animation) so it can re-haul
    // this same tick — distinct from the orphaned-settler drop below, which plays the `startDrop` atomic.
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
      return;
    }
    // Reaching here: no sink, and not a producer resting in a completed Building workplace. A settler still
    // bound to a LIVING sink (a store or a boat hold that is only momentarily full) keeps its load and waits
    // — dropping would churn, since a bound carrier re-collects and re-drops. Only a genuinely orphaned
    // settler — unbound, or bound to a workplace that has since been destroyed — sets the load down rather
    // than stand holding it forever. `startDrop` plays the putdown; `dropCarriedLoad` banks it on the
    // settler's own tile, spilling to the nearest free tiles when that heap is full, so the load is off its
    // back and it re-plans (idle/de-stack) next tick.
    if (workplace === undefined || !world.isAlive(workplace)) startDrop(world, ctx, entity);
    return;
  }

  // A load headed for a construction site is a live supply errand: stamp it so later-planned settlers
  // count it as inbound (SupplyRun — no duplicate fetch of a unit already on someone's back).
  if (world.has(store, UnderConstruction)) {
    stampSupplyRun(world, entity, inbound, { site: store, goodType: load.goodType, amount: load.amount });
  }
  // Only a flag delivery carries a yard route; a route naming a different flag or good than the sink just
  // chosen is spent, so shed it (the flag branch re-stamps a fresh one below).
  const toFlag = world.has(store, DeliveryFlag);
  const priorYard = world.tryGet(entity, YardDeliveryRoute);
  const sameYard =
    priorYard !== undefined && priorYard.flag === store && priorYard.goodType === load.goodType
      ? priorYard
      : undefined;
  if (priorYard !== undefined && sameYard === undefined) world.remove(entity, YardDeliveryRoute);

  // Where the settler stands to deposit — one branch per sink shape.
  let cell: NodeId | null;
  if (toFlag) {
    // A flag is a marker, not a stock sink: hold an unproven yard tile, else resume strictly after a proven
    // failed candidate (or start nearest when there is none).
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
