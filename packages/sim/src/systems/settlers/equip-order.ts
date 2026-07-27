import type { EquipCategory } from '@open-northland/data';
import {
  Carrying,
  Equipment,
  EquipOrder,
  equipSlotValue,
  MoveGoal,
  ownerOf,
  type SettlerIdentity,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { atomicDuration } from '../readviews/animations.js';
import type { NavigationLimit } from '../signposts/index.js';
import { isUsed } from './atomics/effects/goods/index.js';
import { atOrWalk, PICKUP_ATOMIC_ID, PILEUP_ATOMIC_ID, startAtomic, startDrop } from './atomics/start.js';
import type { TargetCandidates } from './targets/index.js';
import { interactionCell, nearestStoreFor, nearestStoreHolding } from './targets/index.js';
import { unreachableGoalVeto } from './unreachable-goals.js';

/**
 * The planner's EQUIP-ERRAND rung: drive a settler's live {@link EquipOrder} one step forward. Sits
 * above the economy rungs (a player errand outranks work) and below the needs drives and the
 * fight/flee/player-walk gates, like the other soft overrides. Stage by stage:
 *
 *  - `acquire`: free the hands first (a player order sets a leftover job load down where the settler
 *    stands, the `moveUnit` idiom; an assistant errand yields until the load is delivered), then fetch -
 *    walk to the nearest reachable store/pile holding the wanted good
 *    and run the `equip` atomic there (the unit lands straight on the body, a fresh swap-out on the
 *    back, a used one destroyed - the take-off rule). Nothing to fetch anywhere reachable
 *    → skip to `return` (the errand gives up, faithful to "no source, no order"). A take-off order
 *    (`goodType` null) runs the `unequip` atomic AT the store the unit will land in, so the item stays
 *    visibly worn for the walk (user rule 2026-07-23); only a part-used unit (destroyed on the spot)
 *    or a unit no store can take (dropped by the stow leg) comes off in place.
 *  - `stow`: a carried good (the swap-out / a taken-off unit no store could take) goes into the
 *    nearest store that can take it; when none can, it is set down on the ground where the settler
 *    stands (user-specified fallback). Partial deposits re-plan until the hands are free.
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
  const owner = ownerOf(world, e); // the errand fetches/stows only through same-side stores

  if (order.stage === 'acquire') {
    const worn = world.tryGet(e, Equipment);
    if (order.goodType === null) {
      // Take-off: the slot may have emptied since the order (a swap raced it) - then just walk home.
      const takenOff = worn === undefined ? null : equipSlotValue(worn, order.group, order.slot);
      if (takenOff === null) {
        order.stage = 'return';
        return planReturn(world, e, order.returnTo, here, avoid);
      }
      if (world.has(e, Carrying)) {
        startDrop(world, ctx, e); // free the hands first - the taken-off good may need the back
        return true;
      }
      // sink null = take off in place: a part-used unit destroys, an unstowable one gets ground-dropped.
      const sink = isUsed(takenOff)
        ? null
        : nearestStoreFor(
            targets.stockpileCells,
            world,
            ctx,
            here,
            takenOff.goodType,
            owner,
            false,
            gate,
            avoid,
          );
      if (sink === null) {
        startUnequip(world, ctx, e, settler, order.group, order.slot, null);
        return true;
      }
      atOrWalk(world, e, here, interactionCell(world, ctx, terrain, sink, here), () =>
        startUnequip(world, ctx, e, settler, order.group, order.slot, sink),
      );
      return true;
    }
    // Already wearing a FRESH unit of the wanted good (a re-issued order): nothing worth fetching. A
    // part-used one is still replaced - "boots at 20%, fetch me a new pair" is the swap the menu offers,
    // and the worn pair goes the way of any swapped-out part-used item.
    const held = worn === undefined ? null : equipSlotValue(worn, order.group, order.slot);
    if (held !== null && held.goodType === order.goodType && !isUsed(held)) {
      order.stage = 'return';
      return planReturn(world, e, order.returnTo, here, avoid);
    }
    if (world.has(e, Carrying)) {
      // The player's own order is urgent enough to set a leftover job load down where the settler
      // stands; the assistant's hand-out yields instead, so its errand never costs a delivery.
      if (order.issuer === 'assistant') return false;
      startDrop(world, ctx, e);
      return true;
    }
    const goodType = order.goodType;
    const src = nearestStoreHolding(
      targets.stockpileCells,
      world,
      ctx,
      terrain,
      here,
      goodType,
      owner,
      gate,
      avoid,
    );
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
    const sink = nearestStoreFor(
      targets.stockpileCells,
      world,
      ctx,
      here,
      load.goodType,
      owner,
      false,
      gate,
      avoid,
    );
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

/** The take-off atomic: the generic goods-handling gesture with the `unequip` effect - aimed at the
 *  stow store when the unit deposits there, self-directed (`sink` null) for a destroy/ground-drop. */
function startUnequip(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  group: EquipCategory,
  slot: number,
  sink: Entity | null,
): void {
  startAtomic(
    world,
    e,
    PICKUP_ATOMIC_ID,
    { kind: 'unequip', group, slot, sink },
    atomicDuration(ctx.content, settler, PICKUP_ATOMIC_ID),
    sink,
  );
}
