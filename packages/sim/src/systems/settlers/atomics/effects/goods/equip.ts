import type { EquipCategory } from '@open-northland/data';
import {
  Equipment,
  type EquipmentSlot,
  EquipOrder,
  equipSlotValue,
  MISC_EQUIP_SLOTS,
  Stockpile,
  setStockAmount,
  writeEquipSlot,
} from '../../../../../components/index.js';
import { fx } from '../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { addCarry } from './carry.js';
import { reapEmptyLoosePile } from './piles.js';
import { pileupIntoStore } from './transfer.js';

// The equip errand's two goods effects: wear a unit lifted out of a store (`equip`), and take a worn
// unit off (`unequip`). This module owns the TAKE-OFF RULE the rest of the equip code points at: a unit
// never appears out of thin air, and the one place one DISAPPEARS is the part-used take-off/swap-out
// (see isUsed). Source basis: the manual's equipment section, "Partly used items (potions, shoes, ...)
// you drop are lost. Unused items such as weapons, armour and amulets can be used again" (the original
// manual p. 27) - which is also what stores need, since they hold fungible amounts that would round-trip
// a used unit back to fresh. The fresh `degreeOfUse` on wear is the same rule's other side.

/** The settler's Equipment component, created empty on first wear (a bare settler carries none until
 *  something is actually put on it - see the component's absence contract). */
function ensureEquipment(world: World, settler: Entity) {
  const held = world.tryGet(settler, Equipment);
  if (held !== undefined) return held;
  world.add(settler, Equipment, {
    boots: null,
    tool: null,
    weapon: null,
    armor: null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
  return world.get(settler, Equipment);
}

/** Advance the settler's live equip errand to `stage` (a raced/cancelled order is simply absent). */
function advanceOrder(world: World, settler: Entity, stage: 'stow' | 'return'): void {
  const order = world.tryGet(settler, EquipOrder);
  if (order !== undefined) order.stage = stage;
}

/** Whether a worn unit has any use on it - the destroy-instead-of-stow trigger (see the module note). */
export function isUsed(slot: EquipmentSlot): boolean {
  return slot.degreeOfUse > fx.fromInt(0);
}

/**
 * Resolve one completed `equip`: move one unit of `goodType` out of `from`'s {@link Stockpile}
 * straight into the settler's equipment slot; a still-fresh swapped-out good lands on the back (the
 * errand's stow step deposits it), a part-used one is destroyed (the module note's regeneration rule).
 * A source gone or emptied since the planner chose it whiffs - nothing is worn and the errand
 * re-searches. The settler reached here empty-handed (the equip rung drops a foreign load first), so
 * {@link addCarry} never merges a foreign good.
 */
export function equipFromStore(
  world: World,
  settler: Entity,
  from: Entity,
  goodType: number,
  group: EquipCategory,
  slot: number,
): void {
  const stock = world.tryGet(from, Stockpile);
  if (stock === undefined) return; // source gone - nothing to wear (don't conjure goods)
  const have = stock.amounts.get(goodType) ?? 0;
  if (have <= 0) return; // source emptied since the planner chose it - the errand re-searches
  setStockAmount(world, from, goodType, have - 1);
  reapEmptyLoosePile(world, from); // a fully-collected ground pile vanishes (a warehouse stays)
  const previous = equipSlotValue(ensureEquipment(world, settler), group, slot);
  world.write(settler, Equipment, (eq) =>
    writeEquipSlot(eq, group, slot, { goodType, degreeOfUse: fx.fromInt(0) }),
  );
  const stows = previous !== null && !isUsed(previous);
  if (stows) addCarry(world, settler, previous.goodType, 1);
  advanceOrder(world, settler, stows ? 'stow' : 'return');
}

/**
 * Resolve one completed `unequip`: take the good in the addressed slot off. A part-used unit is
 * destroyed where the settler stands (the module note's regeneration rule); a fresh one deposits into
 * `sink` (capacity-capped - overflow lands on the back for the stow leg), or onto the back when the
 * planner found no store (`sink` null; the stow leg drops it on the ground). An already-empty slot
 * whiffs - the errand walks home with nothing.
 */
export function unequipWornGood(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  group: EquipCategory,
  slot: number,
  sink: Entity | null,
): void {
  const eq = world.tryGet(settler, Equipment);
  const previous = eq === undefined ? null : equipSlotValue(eq, group, slot);
  if (eq === undefined || previous === null) return; // nothing worn there - the errand just returns
  world.write(settler, Equipment, (v) => writeEquipSlot(v, group, slot, null));
  if (isUsed(previous)) {
    advanceOrder(world, settler, 'return'); // destroyed on the spot - nothing to stow
    return;
  }
  addCarry(world, settler, previous.goodType, 1);
  if (sink !== null) pileupIntoStore(world, ctx, settler, sink);
  // Stow finishes the errand: emptied hands fall through to return, a leftover (sink gone/full or
  // null) re-plans the deposit.
  advanceOrder(world, settler, 'stow');
}
