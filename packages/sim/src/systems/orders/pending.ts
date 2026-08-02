import {
  CurrentAtomic,
  type DeferrableOrderCommand,
  DeferredOrder,
  Settler,
} from '../../components/index.js';
import { assertNever } from '../../core/brand.js';
import type { World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { moveUnit } from './movement.js';
import { placeSignpost } from './signposts.js';
import { setJob } from './work/index.js';

/**
 * DeferredOrderSystem - re-dispatches each order parked behind a non-interruptible atomic ({@link
 * DeferredOrder}, stamped by {@link import('./guards.js').deferOrderDuringAtomic}) once that atomic is gone.
 * Scheduled directly after the atomicSystem so a completing swing frees the settler and its parked order
 * takes effect the same tick, before any drive could see the gap and re-task it (the plannerSystem already
 * ran this tick).
 *
 * The command replays through its ordinary handler, which re-validates against the current world - a target
 * dead or a spot taken since the order was parked skips exactly like fresh bad input.
 */
export const deferredOrderSystem: System = (world, ctx) => {
  // Re-dispatch follows the DeferredOrder store's insertion order - park order, mirroring command FIFO.
  for (const e of world.query(Settler, DeferredOrder)) {
    if (world.has(e, CurrentAtomic)) continue; // still acting - the order stays parked
    const parked = world.get(e, DeferredOrder).command;
    world.remove(e, DeferredOrder);
    applyDeferredOrder(world, ctx, parked);
  }
};

function applyDeferredOrder(world: World, ctx: SystemContext, command: DeferrableOrderCommand): void {
  switch (command.kind) {
    case 'moveUnit':
      moveUnit(world, ctx, command);
      return;
    case 'setJob':
      setJob(world, ctx, command);
      return;
    case 'placeSignpost':
      placeSignpost(world, ctx, command);
      return;
    default:
      assertNever(command);
  }
}
