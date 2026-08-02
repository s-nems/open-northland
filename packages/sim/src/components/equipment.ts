import type { EquipCategory } from '@open-northland/data';
import type { Fixed } from '../core/fixed.js';
import { defineComponent } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/**
 * The number of general "misc" consumable slots a character carries (mead / potions / amulets). The
 * equipment categories are source-pinned (see {@link Equipment}), but the per-category slot counts are
 * not present in readable data. `4` is a named approximation from the feature specification; revise it
 * if observation or extracted data establishes the original count.
 */
export const MISC_EQUIP_SLOTS = 4;

/**
 * One occupied equipment slot: the worn good + how used-up it is.
 *
 * `goodType` is the equip good's `typeId` (the original's equippable ids 30–55 - shoes/tools/armour/
 * weapons/mead/potions/amulets), resolved against the content `goods` table for its icon, name and
 * {@link import('@open-northland/data').EquipClass}.
 *
 * `degreeOfUse` is a {@link Fixed} fraction in `[0, ONE]` - how used-up a WEARING item is (`0` = fresh,
 * `ONE` = spent), the original's "degree of use" the equip window shows as a percentage. It is always
 * `0` for a non-wearing good (weapons/armour/amulets never wear - the good's `equip.wears` is false;
 * source basis: manual "Unused items ... can be used again"). Use accrues in wear steps of
 * `ONE/equip.uses` (walking for boots, production cycles for tools, sips for consumables - see
 * `systems/equipment/`); at `ONE` the item breaks and its slot clears.
 */
export interface EquipmentSlot {
  readonly goodType: number;
  readonly degreeOfUse: Fixed;
}

/**
 * A character's worn **equipment** - the player-facing inventory the original's equip window shows. The
 * slot kinds are source-pinned to the manual's Equipment section: everyone can wear `boots` (shoes), a
 * `tool` (wooden/iron), and {@link MISC_EQUIP_SLOTS} `misc` consumables (mead/potions/amulets); a
 * soldier additionally carries a `weapon` and `armor`. Each slot holds one {@link EquipmentSlot} or is
 * `null` (empty). `misc` is a fixed-length array of {@link MISC_EQUIP_SLOTS} entries.
 *
 * This is the equipment INVENTORY/display axis, distinct from the combat {@link Weapon}/{@link Armor}
 * components (which carry the `weaponTypeId`/`armorClass` the CombatSystem resolves damage through).
 * The armor half is wired: a worn `armor` good overrides a stamped {@link Armor} tier at damage
 * resolution (`conflict/weapons.ts` `targetMaterial`). Wiring the weapon half (equipping a weapon good
 * granting the combat `Weapon`) is a deferred phase; a scene stamps both when it wants a unit that
 * both displays and fights with one.
 *
 * It is a **separate optional component** (like {@link Weapon}/{@link Armor}/{@link JobAssignment}):
 * only an explicitly-equipped unit carries one, so a bare settler - every animal, every golden/slice
 * settler - has none and the state hash stays byte-identical (adding this component changes no existing
 * scenario). Determinism: every field is a whole integer id or a {@link Fixed} scaled integer, stamped
 * from command data and read by pure UI/queries - no RNG, no wall-clock.
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
 * A player equip errand in flight on a settler: one slot address (`group` + `slot`, the misc row
 * indexed, 0 elsewhere) and one intent - `goodType` set puts that good on (a swap when the slot is
 * worn), null takes the worn good off. Stamped by the `equipGood`/`unequipGood` order handlers;
 * `settlers/drives/equip-order.ts` owns the stage protocol that drives it and removes it. `returnTo` is the
 * node the settler stood on at issue - the errand ends where it began (user-specified design: the
 * manual describes the window's item list, not how the settler fetches). `stage` only advances
 * (acquire → stow → return).
 *
 * `issuer` separates the player's click from the assistant's hand-out: a player order is urgent enough
 * to set a carried load down mid-errand, the assistant's is dropped instead
 * (`settlers/drives/equip-order.ts`).
 */
export const EquipOrder = defineComponent<{
  group: EquipCategory;
  slot: number;
  goodType: number | null;
  returnTo: NodeId;
  stage: 'acquire' | 'stow' | 'return';
  issuer: 'player' | 'assistant';
}>('EquipOrder');
