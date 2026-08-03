import type { EquipCategory } from '@open-northland/data';
import type { Fixed } from '../core/fixed.js';
import { defineComponent } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/**
 * The number of general "misc" consumable slots a character carries (mead / potions / amulets). The
 * equipment categories are source-pinned (see {@link Equipment}), but the per-category slot counts are not
 * present in readable data, so `4` is a named approximation.
 */
export const MISC_EQUIP_SLOTS = 4;

/**
 * One occupied equipment slot: the worn good and how used-up it is.
 *
 * `goodType` is the equip good's `typeId` (the original's equippable ids 30-55), resolved against the
 * content `goods` table. `degreeOfUse` is a {@link Fixed} fraction in `[0, ONE]` - `0` fresh, `ONE` spent -
 * the original's "degree of use". It is always `0` for a good whose `equip.wears` is false (manual:
 * "Unused items ... can be used again"). Use accrues in steps of `ONE/equip.uses`, and at `ONE` the item
 * breaks and its slot clears.
 */
export interface EquipmentSlot {
  readonly goodType: number;
  readonly degreeOfUse: Fixed;
}

/**
 * A character's worn equipment - the player-facing inventory the original's equip window shows. The slot
 * kinds are source-pinned to the manual's Equipment section: everyone can wear `boots`, a `tool`, and
 * {@link MISC_EQUIP_SLOTS} `misc` consumables; a soldier additionally carries a `weapon` and `armor`.
 *
 * This is the inventory/display axis, distinct from the combat {@link Weapon}/{@link Armor} components.
 * Only the armor half is wired: a worn `armor` good overrides a stamped {@link Armor} tier at damage
 * resolution. A scene stamps both when it wants a unit that both displays and fights with one.
 */
export interface EquipmentData {
  boots: EquipmentSlot | null;
  tool: EquipmentSlot | null;
  weapon: EquipmentSlot | null;
  armor: EquipmentSlot | null;
  misc: ReadonlyArray<EquipmentSlot | null>;
}

export const Equipment = defineComponent<EquipmentData>('Equipment');

/** The good worn in one addressed equipment slot, or null when the slot is empty / out of range. */
export function equipSlotValue(eq: EquipmentData, group: EquipCategory, slot: number): EquipmentSlot | null {
  if (group === 'misc') return eq.misc[slot] ?? null;
  return eq[group];
}

/** Write one addressed equipment slot (the misc array is replaced, never mutated in place). */
export function writeEquipSlot(
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

/**
 * A player equip errand in flight on a settler: one slot address (`group` plus `slot`, the misc row indexed
 * and 0 elsewhere) and one intent - `goodType` set puts that good on, null takes the worn good off.
 * `settlers/drives/equip-order.ts` owns the stage protocol that drives and removes it, and `stage` only
 * advances. `returnTo` is the node the settler stood on at issue, so the errand ends where it began
 * (authored: the manual describes the window's item list, not how the settler fetches).
 *
 * `issuer` separates the player's click from the assistant's hand-out: a player order is urgent enough to
 * set a carried load down mid-errand, the assistant's is dropped instead.
 */
export const EquipOrder = defineComponent<{
  group: EquipCategory;
  slot: number;
  goodType: number | null;
  returnTo: NodeId;
  stage: 'acquire' | 'stow' | 'return';
  issuer: 'player' | 'assistant';
}>('EquipOrder');
