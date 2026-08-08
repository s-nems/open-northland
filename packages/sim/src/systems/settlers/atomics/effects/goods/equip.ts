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
import { layDownWeaponGood, takeUpWeaponGood } from './weapon-class.js';
import { isUsed } from './wear.js';

// Take-off rule: a part-used unit is destroyed when it is taken off or swapped out, a fresh one survives.
// Source basis, Wonders manual p. 27: "Partly used items (potions, shoes, ...) you drop are lost. Unused
// items such as weapons, armour and amulets can be used again."

/** The settler's Equipment component, created empty on first wear; a bare settler carries none. */
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
  const order = world.tryMut(settler, EquipOrder);
  if (order !== undefined) order.stage = stage;
}

/**
 * Resolve one completed `equip`: move one unit of `goodType` out of `from`'s {@link Stockpile} straight
 * into the settler's equipment slot. A still-fresh swapped-out good lands on the back for the errand's stow
 * step, a part-used one is destroyed by the take-off rule. A source gone or emptied since the planner chose
 * it wears nothing and the errand re-searches. The settler reached here empty-handed, so {@link addCarry}
 * cannot throw on a foreign load.
 */
export function equipFromStore(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  from: Entity,
  goodType: number,
  group: EquipCategory,
  slot: number,
): void {
  const stock = world.tryGet(from, Stockpile);
  if (stock === undefined) return;
  const have = stock.amounts.get(goodType) ?? 0;
  if (have <= 0) return;
  setStockAmount(world, from, goodType, have - 1);
  reapEmptyLoosePile(world, from);
  const previous = equipSlotValue(ensureEquipment(world, settler), group, slot);
  writeEquipSlot(world.mut(settler, Equipment), group, slot, { goodType, degreeOfUse: fx.fromInt(0) });
  if (group === 'weapon') takeUpWeaponGood(world, ctx, settler, goodType);
  const stows = previous !== null && !isUsed(previous);
  if (stows) addCarry(world, settler, previous.goodType, 1);
  advanceOrder(world, settler, stows ? 'stow' : 'return');
}

/**
 * Resolve one completed `unequip`: take the good in the addressed slot off. A part-used unit is destroyed
 * where the settler stands by the take-off rule; a fresh one deposits into `sink`, capacity-capped, with
 * any overflow left on the back for the stow leg. A null `sink` leaves the whole unit on the back.
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
  if (eq === undefined || previous === null) return;
  writeEquipSlot(world.mut(settler, Equipment), group, slot, null);
  if (group === 'weapon') layDownWeaponGood(world, ctx, settler); // an armed class never stays weaponless
  if (isUsed(previous)) {
    advanceOrder(world, settler, 'return');
    return;
  }
  addCarry(world, settler, previous.goodType, 1);
  if (sink !== null) pileupIntoStore(world, ctx, settler, sink);
  // Stow either way: emptied hands fall through to return, a leftover re-plans the deposit.
  advanceOrder(world, settler, 'stow');
}
