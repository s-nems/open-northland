import type { EquipCategory } from '@open-northland/data';
import type { Fixed } from '../core/fixed.js';
import { defineComponent } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/**
 * How many "misc" consumable slots (mead / potions / amulets) a character carries. Approximation: the
 * categories are source-pinned (see {@link Equipment}), but no readable data carries the slot counts.
 */
export const MISC_EQUIP_SLOTS = 4;

/**
 * One occupied equipment slot. `goodType` is the equip good's `typeId` (the original's equippable ids
 * 30-55); `degreeOfUse` is the original's "degree of use" as a {@link Fixed} fraction in `[0, ONE]`, `ONE`
 * meaning spent, held at `0` for a good whose `equip.wears` is false (manual: "Unused items ... can be
 * used again").
 */
export interface EquipmentSlot {
  readonly goodType: number;
  readonly degreeOfUse: Fixed;
}

/**
 * A character's worn equipment - the player-facing inventory the original's equip window shows, its slot
 * kinds source-pinned to the manual's Equipment section.
 *
 * This is the inventory/display axis, distinct from the combat {@link Weapon}/{@link Armor} components.
 * Only the armor half is wired: a worn `armor` good overrides a stamped {@link Armor} tier at damage
 * resolution.
 */
export interface EquipmentData {
  boots: EquipmentSlot | null;
  tool: EquipmentSlot | null;
  weapon: EquipmentSlot | null;
  armor: EquipmentSlot | null;
  misc: ReadonlyArray<EquipmentSlot | null>;
}

export const Equipment = defineComponent<EquipmentData>('Equipment', 'settlers');

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

export interface EquipOrderIntent {
  group: EquipCategory;
  /** The misc row; 0 for every single-slot group. */
  slot: number;
  goodType: number | null;
  /** The node the settler stood on at issue, so the errand ends where it began (authored: the manual
   *  describes the window's item list, not how the settler fetches). */
  returnTo: NodeId;
}

/**
 * An equip errand in flight on a settler. Player orders for other slots wait in `queued`, preserving the
 * click order; another order for the active slot still replaces it. `settlers/drives/equip-order.ts` owns
 * the stage protocol.
 */
export const EquipOrder = defineComponent<
  EquipOrderIntent & {
    stage: 'acquire' | 'stow' | 'return';
    /** The player's click or one of the assistant's automatic hand-outs. Player orders set a carried load
     *  down mid-errand; automatic orders yield it. Recruit arming additionally finishes at the stock source. */
    issuer: 'player' | 'assistant-grant' | 'assistant-recruit';
    /** Later player intents for different slots, in click order. */
    queued: EquipOrderIntent[];
  }
>('EquipOrder', 'settlers');
