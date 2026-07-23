import type { EquipCategory } from '@open-northland/data';
import { Carrying, Equipment, EquipOrder, MoveGoal, type SettlerIdentity } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { atomicDuration } from '../readviews/animations.js';
import type { NavigationLimit } from '../signposts/index.js';
import { atOrWalk, PICKUP_ATOMIC_ID, PILEUP_ATOMIC_ID, startAtomic, startDrop } from './actions.js';
import { equipSlotValue } from './effects-goods/index.js';
import type { TargetCandidates } from './targets/index.js';
import { interactionCell, nearestStoreFor, nearestStoreHolding } from './targets/index.js';
import { unreachableGoalVeto } from './unreachable-goals.js';

/**
 * The planner's EQUIP-ERRAND rung: drive a settler's live {@link EquipOrder} one step forward. Sits
 * above the economy rungs (a player errand outranks work) and below the needs drives and the
 * fight/flee/player-walk gates, like the other soft overrides. Stage by stage:
 *
 *  - `acquire`: free the hands first (a leftover job load is set down where the settler stands, the
 *    `moveUnit` idiom), then fetch - walk to the nearest reachable store/pile holding the wanted good
 *    and run the `equip` atomic there (the unit lands straight on the body, a swap-out on the back).
 *    A take-off order (`goodType` null) runs the `unequip` atomic in place instead. Nothing to fetch
 *    anywhere reachable → skip to `return` (the errand gives up, faithful to "no source, no order").
 *  - `stow`: a carried good (the swap-out / the taken-off unit) goes into the nearest store that can
 *    take it; when none can, it is set down on the ground where the settler stands (user-specified
 *    fallback). Partial deposits re-plan until the hands are free.
 *  - `return`: walk back to the node the order was issued on; arriving (or the way back proving
 *    unreachable) ends the errand and hands the settler to the economy the same tick.
 *
 * The fetch/deposit gestures reuse the generic goods-handling animation ({@link PICKUP_ATOMIC_ID} /
 * {@link PILEUP_ATOMIC_ID}) - no decoded equip clip exists (named approximation, like the drop). No
 * source-side reservation: two settlers sent for the last unit race it, the loser re-searches and
 * walks home empty-handed (the whiffing `equip` effect keeps goods conserved).
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
): boolean {
  const order = world.tryGet(e, EquipOrder);
  if (order === undefined) return false;
  const gate = limit ?? undefined;
  const avoid = unreachableGoalVeto(world, ctx, e);

  if (order.stage === 'acquire') {
    const worn = world.tryGet(e, Equipment);
    if (order.goodType === null) {
      // Take-off: the slot may have emptied since the order (a swap raced it) - then just walk home.
      if (worn === undefined || equipSlotValue(worn, order.group, order.slot) === null) {
        order.stage = 'return';
        return planReturn(world, e, order.returnTo, here, avoid);
      }
      if (world.has(e, Carrying)) {
        startDrop(world, ctx, e); // free the hands first - the taken-off good needs the back
        return true;
      }
      startUnequip(world, ctx, e, settler, order.group, order.slot);
      return true;
    }
    // Already wearing the wanted good (a re-issued order): nothing to fetch.
    if (worn !== undefined && equipSlotValue(worn, order.group, order.slot)?.goodType === order.goodType) {
      order.stage = 'return';
      return planReturn(world, e, order.returnTo, here, avoid);
    }
    if (world.has(e, Carrying)) {
      startDrop(world, ctx, e); // a leftover job load is set down where the settler stands
      return true;
    }
    const goodType = order.goodType;
    const src = nearestStoreHolding(targets.stockpileCells, world, ctx, terrain, here, goodType, gate, avoid);
    if (src === null) {
      order.stage = 'return'; // nothing reachable holds the good - give up and walk home
      return planReturn(world, e, order.returnTo, here, avoid);
    }
    const { group, slot } = order;
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, src, here), () =>
      startAtomic(
        world,
        e,
        PICKUP_ATOMIC_ID,
        { kind: 'equip', from: src, goodType, group, slot },
        atomicDuration(ctx.content, settler, PICKUP_ATOMIC_ID),
        src,
      ),
    );
    return true;
  }

  if (order.stage === 'stow') {
    const load = world.tryGet(e, Carrying);
    if (load === undefined || load.amount <= 0) {
      order.stage = 'return';
      return planReturn(world, e, order.returnTo, here, avoid);
    }
    const sink = nearestStoreFor(targets.stockpileCells, world, ctx, here, load.goodType, false, gate, avoid);
    if (sink === null) {
      startDrop(world, ctx, e); // no store can take it - onto the ground where the settler stands
      return true;
    }
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, sink, here), () =>
      startAtomic(
        world,
        e,
        PILEUP_ATOMIC_ID,
        { kind: 'pileup', store: sink },
        atomicDuration(ctx.content, settler, PILEUP_ATOMIC_ID),
        sink,
      ),
    );
    return true;
  }

  return planReturn(world, e, order.returnTo, here, avoid);
}

/** Walk back to the issue node; arriving (or the way back proving unreachable) ends the errand and
 *  returns false so the economy re-tasks the settler this very tick. */
function planReturn(
  world: World,
  e: Entity,
  returnTo: NodeId,
  here: NodeId,
  avoid: ((cell: NodeId) => boolean) | undefined,
): boolean {
  if (here === returnTo || avoid?.(returnTo) === true) {
    world.remove(e, EquipOrder);
    return false;
  }
  world.add(e, MoveGoal, { cell: returnTo });
  return true;
}

/** The in-place take-off atomic: the generic goods-handling gesture with the `unequip` effect (a
 *  self-directed action, so no target entity). */
function startUnequip(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  group: EquipCategory,
  slot: number,
): void {
  startAtomic(
    world,
    e,
    PICKUP_ATOMIC_ID,
    { kind: 'unequip', group, slot },
    atomicDuration(ctx.content, settler, PICKUP_ATOMIC_ID),
    null,
  );
}
