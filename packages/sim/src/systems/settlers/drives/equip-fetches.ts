import { EquipOrder, ownerOf, Settler } from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';

/** An equip errand lifts one unit into one slot. */
export const EQUIP_FETCH_UNITS = 1;

/**
 * The units of each good, per owning player, held by equip errands underway: an errand in its `acquire`
 * stage holds one unit of its good from dispatch until the pickup. Every automatic dispatcher subtracts
 * these from the stock it hands out, so a man sent for a unit takes it out of the pool and no second man is
 * sent after it. A jobless settler's errand is frozen, since the ladder never plans one, so it holds
 * nothing.
 */
export function equipFetchesUnderway(world: World): Map<number, Map<number, number>> {
  const byOwner = new Map<number, Map<number, number>>();
  for (const e of world.query(EquipOrder)) {
    const order = world.get(e, EquipOrder);
    if (order.stage !== 'acquire' || order.goodType === null) continue;
    if (world.tryGet(e, Settler)?.jobType == null) continue;
    const owner = ownerOf(world, e);
    if (owner === undefined) continue;
    let held = byOwner.get(owner);
    if (held === undefined) {
      held = new Map();
      byOwner.set(owner, held);
    }
    held.set(order.goodType, (held.get(order.goodType) ?? 0) + EQUIP_FETCH_UNITS);
  }
  return byOwner;
}
