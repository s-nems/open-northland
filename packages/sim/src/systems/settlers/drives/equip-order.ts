import {
  AssistantRecruit,
  Carrying,
  EquipOrder,
  MoveGoal,
  ownerOf,
  type SettlerIdentity,
  wornSlot,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { atomicDuration } from '../../readviews/animations.js';
import { canEquipCategory } from '../../readviews/equip-pick.js';
import { isHeroJob } from '../../readviews/jobs.js';
import { type NavigationLimit, networkLimitAt } from '../../signposts/index.js';
import type { SupplyTally } from '../../stores/index.js';
import { EQUIP_FETCH_UNITS, isUsed } from '../atomics/effects/goods/index.js';
import { atOrWalk, PICKUP_ATOMIC_ID, PILEUP_ATOMIC_ID, startAtomic, startDrop } from '../atomics/start.js';
import { chainRecruitArmor } from '../planner/recruit-arming.js';
import type { TargetCandidates } from '../targets/index.js';
import { interactionCell, nearestStoreFor, nearestStoreHolding } from '../targets/index.js';
import { unreachableGoalVeto } from '../unreachable-goals.js';

type EquipOrderState = NonNullable<(typeof EquipOrder)['__value']>;

/** What one errand's stage handlers share, resolved once per plan call. */
interface EquipErrand {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly terrain: TerrainGraph;
  readonly entity: Entity;
  readonly settler: SettlerIdentity;
  /** The stored order, read-only: a handler that changes it writes through {@link writableOrder}, so a
   *  plan that only waits on its stage logs no write. */
  readonly order: DeepReadonly<EquipOrderState>;
  readonly here: NodeId;
  readonly gate: NavigationLimit | undefined;
  readonly avoid: ((cell: NodeId) => boolean) | undefined;
  /** The settler's owning player - the errand fetches and stows only through same-side stores. */
  readonly owner: number | undefined;
  readonly targets: TargetCandidates;
  readonly supply: SupplyTally;
}

const EXCLUDE_PRODUCERS = false;

/** An errand shops inside its settler's own confinement, or, for a job with none (a soldier) and for a
 *  recruit being armed, inside the settlement network at his feet - the original's
 *  equipment-search bound. The store is re-picked every tick, so without a gate an
 *  unconfined settler would re-target across the map the moment his store ran dry. */
function errandGate(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  limit: NavigationLimit | null,
): NavigationLimit | undefined {
  if (limit !== null && !world.has(e, AssistantRecruit)) return limit;
  const owner = ownerOf(world, e);
  if (owner === undefined) return limit ?? undefined;
  return networkLimitAt(world, terrain, owner, terrain.xOf(here), terrain.yOf(here)) ?? undefined;
}

/**
 * Drive a settler's live equip order one stage forward. Approximation: the fetch and deposit gestures
 * reuse the generic goods-handling animations, as no decoded equip clip exists. A fetch claims its source
 * unit, so a settler planned later shops elsewhere; the pickup still takes whatever stands there.
 */
export function planEquipOrder(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: SettlerIdentity,
  here: NodeId,
  limit: NavigationLimit | null,
  targets: TargetCandidates,
  supply: SupplyTally,
): boolean {
  const order = world.tryGet(e, EquipOrder);
  if (order === undefined) return false;
  const errand: EquipErrand = {
    world,
    ctx,
    terrain,
    entity: e,
    settler,
    order,
    here,
    gate: errandGate(world, terrain, e, here, limit),
    avoid: unreachableGoalVeto(world, ctx, e),
    owner: ownerOf(world, e),
    targets,
    supply,
  };
  if (order.issuer === 'player' && !playerIntentAllowed(ctx, settler, order)) return finishEquipOrder(errand);
  switch (order.stage) {
    case 'acquire':
      return order.goodType === null ? planTakeOff(errand) : planFetch(errand, order.goodType);
    case 'stow':
      return planStow(errand);
    case 'return':
      return planReturn(errand);
  }
}

/** Recheck a player intent when it becomes active: the settler's profession may have changed meanwhile. */
function playerIntentAllowed(
  ctx: SystemContext,
  settler: SettlerIdentity,
  intent: Pick<EquipOrderState, 'group' | 'goodType'>,
): boolean {
  if (isHeroJob(ctx.content, settler.jobType)) return false;
  if (intent.goodType === null) return true;
  const good = contentIndex(ctx.content).goods.get(intent.goodType);
  return (
    good?.equip?.category === intent.group && canEquipCategory(ctx.content, settler.jobType, intent.group)
  );
}

/**
 * The `acquire` stage of a take-off order. Authored: the item stays visibly worn for the walk, so the
 * `unequip` atomic runs at the store the unit will land in. Only a part-used unit, or one no store can
 * take, comes off in place.
 */
function planTakeOff(errand: EquipErrand): boolean {
  const { world, ctx, entity, order } = errand;
  const takenOff = wornSlot(world, entity, order.group, order.slot);
  if (takenOff === null) return endErrand(errand); // the slot emptied since the order - a swap raced it
  if (world.has(entity, Carrying)) {
    startDrop(world, ctx, entity); // free the hands first - the taken-off good may need the back
    return true;
  }
  const sink = isUsed(takenOff) ? null : stowSink(errand, takenOff.goodType);
  if (sink === null) {
    startUnequip(errand, null);
    return true;
  }
  atOrWalkTo(errand, sink, () => startUnequip(errand, sink));
  return true;
}

/**
 * The `acquire` stage of a wear order: fetch `goodType` from the nearest reachable store or pile.
 * Nothing reachable to fetch ends the errand rather than parking the settler.
 */
function planFetch(errand: EquipErrand, goodType: number): boolean {
  const { world, ctx, entity, settler, order, here, owner, gate, avoid, targets, supply } = errand;
  const held = wornSlot(world, entity, order.group, order.slot);
  // A part-used unit is still replaced: refetching a worn pair is the swap the menu offers.
  if (held !== null && held.goodType === goodType && !isUsed(held)) return endErrand(errand);
  if (world.has(entity, Carrying)) {
    // An assistant order yields to the rungs below, so the load is delivered rather than dropped and the
    // fetch starts once the hands are free. A player order is urgent enough to set the load down here.
    if (order.issuer !== 'player') return false;
    startDrop(world, ctx, entity);
    return true;
  }
  const src = nearestStoreHolding(targets.bands, world, here, goodType, owner, supply, gate, avoid);
  if (src === null) return endErrand(errand);
  supply.stampPickupClaim(entity, { source: src, goodType, amount: EQUIP_FETCH_UNITS });
  const { group, slot } = order;
  atOrWalkTo(errand, src, () =>
    startAtomic(
      world,
      entity,
      PICKUP_ATOMIC_ID,
      { kind: 'equip', from: src, goodType, group, slot },
      atomicDuration(ctx.content, settler, PICKUP_ATOMIC_ID),
      src,
    ),
  );
  return true;
}

/** The `stow` stage: a partial deposit leaves the stage in place, so the errand re-plans until the
 *  hands are free. */
function planStow(errand: EquipErrand): boolean {
  const { world, ctx, entity, settler } = errand;
  const load = world.tryGet(entity, Carrying);
  if (load === undefined || load.amount <= 0) return endErrand(errand);
  const sink = stowSink(errand, load.goodType);
  if (sink === null) {
    startDrop(world, ctx, entity); // no store can take it - onto the ground where the settler stands
    return true;
  }
  atOrWalkTo(errand, sink, () =>
    startAtomic(
      world,
      entity,
      PILEUP_ATOMIC_ID,
      { kind: 'pileup', store: sink },
      atomicDuration(ctx.content, settler, PILEUP_ATOMIC_ID),
      sink,
    ),
  );
  return true;
}

/** The `return` stage: walk back to the issue node, if the order keeps one. Arriving, or finding it
 *  unreachable, ends the errand and returns false so the economy re-tasks the settler the same tick. */
function planReturn(errand: EquipErrand): boolean {
  const { world, ctx, terrain, entity, order, here, avoid, targets, supply } = errand;
  // A queued player intent continues from the current stock/stow point. Only the final intent walks
  // back to the shared issue position, avoiding a potentially huge round trip between equipment types.
  if (order.issuer === 'player' && promoteQueuedEquipOrder(errand)) return true;
  // A recruit weapon errand chains its armor want from the store it stands at rather than walking
  // in between, so one outing dresses the recruit and finishes at the final stock source.
  if (order.issuer === 'assistant-recruit' && order.group === 'weapon') {
    const chained = chainRecruitArmor(world, ctx, terrain, targets, supply, entity, here, avoid);
    if (chained !== null) {
      const live = writableOrder(errand);
      live.group = 'armor';
      live.goodType = chained;
      live.stage = 'acquire';
      return planFetch(errand, chained);
    }
  }
  const { returnTo } = order;
  if (returnTo === null || here === returnTo || avoid?.(returnTo) === true) {
    return finishEquipOrder(errand);
  }
  world.add(entity, MoveGoal, { cell: returnTo });
  return true;
}

function endErrand(errand: EquipErrand): boolean {
  writableOrder(errand).stage = 'return';
  return planReturn(errand);
}

/** Finish the active intent and promote the next player intent, if any. */
function finishEquipOrder(errand: EquipErrand): boolean {
  if (promoteQueuedEquipOrder(errand)) return true;
  errand.world.remove(errand.entity, EquipOrder);
  return false;
}

/** Promote the next still-valid player intent without an intermediate return trip. */
function promoteQueuedEquipOrder(errand: EquipErrand): boolean {
  const { ctx, settler } = errand;
  if (errand.order.queued.length === 0) return false;
  const order = writableOrder(errand);
  for (;;) {
    const next = order.queued?.shift();
    if (next === undefined) return false;
    if (!playerIntentAllowed(ctx, settler, next)) continue;
    order.group = next.group;
    order.slot = next.slot;
    order.goodType = next.goodType;
    order.returnTo = next.returnTo;
    order.stage = 'acquire';
    order.issuer = 'player';
    return true;
  }
}

function writableOrder(errand: EquipErrand): EquipOrderState {
  return errand.world.mut(errand.entity, EquipOrder);
}

/** The nearest same-side store that can take `goodType`. */
function stowSink(errand: EquipErrand, goodType: number): Entity | null {
  const { world, here, owner, gate, avoid, targets } = errand;
  return nearestStoreFor(targets.bands, world, here, goodType, owner, EXCLUDE_PRODUCERS, gate, avoid);
}

function atOrWalkTo(errand: EquipErrand, target: Entity, act: () => void): void {
  const { world, ctx, terrain, entity, here } = errand;
  atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, target, here), act);
}

/** The take-off atomic: aimed at the stow store, or self-directed (`sink` null) for a destroy/drop. */
function startUnequip(errand: EquipErrand, sink: Entity | null): void {
  const { world, ctx, entity, settler, order } = errand;
  startAtomic(
    world,
    entity,
    PICKUP_ATOMIC_ID,
    { kind: 'unequip', group: order.group, slot: order.slot, sink },
    atomicDuration(ctx.content, settler, PICKUP_ATOMIC_ID),
    sink,
  );
}
