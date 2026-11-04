import type { World } from '../../../ecs/world.js';
import type { DepositKept } from '../../ai-shared/building-spot.js';
import { homeSettlers } from '../../ai-shared/home-roster.js';
import type { SystemContext } from '../../context.js';
import { heldGatherGood } from '../../economy/gather-goods.js';
import { liveWorkFlag } from '../../economy/work-flag.js';

/** A deposit node with no more than this many units left is a last scrap, which keeps no room (authored):
 *  about one gatherer's trip. */
export const DEPOSIT_SCRAP_UNITS = 2;

/**
 * Which live deposits keep a computer seat's buildings off them. Our own AI policy, not a game rule: a
 * deposit holds its ground only while the seat still works its good, a gatherer of its home posted on that
 * good, and only while more than a last scrap ({@link DEPOSIT_SCRAP_UNITS}) is left. The workforce posts
 * gatherers while the good is short and releases them at its glut line (`../workforce/collectors/`), so a
 * deposit they stopped working at the stock target, or a scrap, frees its ground for building (owner
 * ruling: room that opens as resources are mined out is built on).
 */
export function seatDepositKept(world: World, ctx: SystemContext, player: number): DepositKept {
  let worked: Set<number> | undefined;
  return (goodType, remaining) => {
    if (remaining <= DEPOSIT_SCRAP_UNITS) return false;
    if (worked === undefined) {
      worked = new Set();
      for (const e of homeSettlers(world, ctx, player)) {
        if (liveWorkFlag(world, e) === undefined) continue;
        const good = heldGatherGood(world, ctx, e);
        if (good !== undefined) worked.add(good);
      }
    }
    return worked.has(goodType);
  };
}
