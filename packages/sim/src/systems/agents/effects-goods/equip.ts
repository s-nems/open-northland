import type { EquipCategory } from '@open-northland/data';
import {
  Equipment,
  type EquipmentData,
  type EquipmentSlot,
  EquipOrder,
  MISC_EQUIP_SLOTS,
  Stockpile,
  setStockAmount,
} from '../../../components/index.js';
import { fx } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { addCarry } from './carry.js';
import { reapEmptyLoosePile } from './piles.js';

// The equip errand's two goods effects: wear a unit lifted out of a store (`equip`), and take a worn
// unit off onto the back (`unequip`). Both conserve goods - a worn unit came out of a store or goes
// onto the back, never out of thin air (the fresh `degreeOfUse` is the one named approximation, see
// the `equip` effect doc).

/** The good worn in one addressed equipment slot, or null when the slot is empty / out of range. */
export function equipSlotValue(eq: EquipmentData, group: EquipCategory, slot: number): EquipmentSlot | null {
  if (group === 'misc') return eq.misc[slot] ?? null;
  return eq[group];
}

/** Write one addressed equipment slot (the misc array is replaced, never mutated in place). */
function writeEquipSlot(
  eq: EquipmentData,
  group: EquipCategory,
  slot: number,
  value: EquipmentSlot | null,
): void {
  if (group === 'misc') {
    eq.misc = eq.misc.map((held, i) => (i === slot ? value : held));
    return;
  }
  eq[group] = value;
}

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

/**
 * Resolve one completed `equip`: move one unit of `goodType` out of `from`'s {@link Stockpile}
 * straight into the settler's equipment slot; a swapped-out good lands on the back (the errand's stow
 * step deposits it). A source gone or emptied since the planner chose it whiffs - nothing is worn and
 * the errand re-searches. The settler reached here empty-handed (the equip rung drops a foreign load
 * first), so {@link addCarry} never merges a foreign good.
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
  setStockAmount(world, stock.amounts, goodType, have - 1);
  reapEmptyLoosePile(world, from); // a fully-collected ground pile vanishes (a warehouse stays)
  const eq = ensureEquipment(world, settler);
  const previous = equipSlotValue(eq, group, slot);
  writeEquipSlot(eq, group, slot, { goodType, degreeOfUse: fx.fromInt(0) });
  if (previous !== null) addCarry(world, settler, previous.goodType, 1);
  advanceOrder(world, settler, previous !== null ? 'stow' : 'return');
}

/**
 * Resolve one completed `unequip`: move the good in the addressed slot onto the settler's back (the
 * errand's stow step deposits it). An already-empty slot whiffs - the errand walks home with nothing.
 */
export function unequipToCarry(world: World, settler: Entity, group: EquipCategory, slot: number): void {
  const eq = world.tryGet(settler, Equipment);
  const previous = eq === undefined ? null : equipSlotValue(eq, group, slot);
  if (eq === undefined || previous === null) return; // nothing worn there - the errand just returns
  writeEquipSlot(eq, group, slot, null);
  addCarry(world, settler, previous.goodType, 1);
  advanceOrder(world, settler, 'stow');
}
