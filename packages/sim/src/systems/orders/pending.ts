import { type DeferrableOrderCommand, DeferredOrder, Settler } from '../../components/index.js';
import { assertNever } from '../../core/brand.js';
import type { World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import { attackMoveUnit, moveUnit } from './movement.js';
import { placeSignpost } from './signposts.js';
import { setJob } from './work/index.js';

/**
 * Re-dispatch each order parked behind a non-interruptible atomic once that atomic is gone. Scheduled
 * directly after the atomic system, so a completing swing frees the settler and its parked order takes
 * effect the same tick, before any drive could see the gap and re-task it.
 *
 * The command replays through its ordinary handler, which re-validates against the current world, so a
 * target that died while the order sat parked skips exactly like fresh bad input.
 */
export const deferredOrderSystem: System = (world, ctx) => {
  // Re-dispatch follows the DeferredOrder store's insertion order - park order, mirroring command FIFO.
  for (const e of world.query(Settler, DeferredOrder)) {
    if (atomicHoldsSettler(world, e)) continue; // still acting - the order stays parked
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
    case 'attackMoveUnit':
      attackMoveUnit(world, ctx, command);
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
