import type { EquipCategory } from '@open-northland/data';

/** Goods and equipment ids in the sandbox-scoped economy namespace. */

export const GOOD_NONE = 0;
export const GOOD_WOOD = 1;
export const GOOD_PLANK = 2;
export const GOOD_COIN = 3;
export const GOOD_STONE = 4;
export const GOOD_MUD = 5;
export const GOOD_IRON = 6;
export const GOOD_GOLD = 7;
export const GOOD_MUSHROOM = 8;

// The equippable goods ride the sandbox-scoped catalog ids — `EXTENDED_GOOD_TYPE_OFFSET` (100) + the raw
// `goodtypes.ini` id (30–55) = 130–155 — the same ids the global goods catalog (`catalog/goods.ts`
// `EXTENDED_GOODS`) declares them at, so an equipped good is the same good as the one dropped on the ground
// or stored in a warehouse: one id, one `ls_goods` icon, one name.
/** Wheat — the field-farmed grain (`goodtypes.ini` type 4, at the +100 catalog offset). */
export const GOOD_WHEAT = 104;
/** Flour — the mill's in-house product ground from wheat (`goodtypes.ini` type 11, at the +100 offset). */
export const GOOD_FLOUR = 111;
export const GOOD_SHOES = 130;
export const GOOD_TOOL_IRON = 132;
export const GOOD_ARMOR_CHAIN = 135;
// Weapon goods — the equippable side of the weapons. A settler carrying one in its `Equipment.weapon`
// slot draws that weapon's warrior body (WARRIOR_SPEC_BY_WEAPON_GOOD).
export const GOOD_BOW_SHORT = 137;
export const GOOD_BOW_LONG = 138;
export const GOOD_SPEAR_WOODEN = 139;
export const GOOD_SPEAR_IRON = 140;
export const GOOD_SWORD_SHORT = 141;
export const GOOD_SWORD_LONG = 142;
export const GOOD_MEAD = 143;
export const GOOD_POTION_FOOD_SMALL = 144;
export const GOOD_POTION_STAMINA_SMALL = 146;
export const GOOD_AMULET_STRENGTH = 152;

/** One equippable good's equip axis: its slot category ({@link EquipCategory}, the shared data-package
 *  vocabulary) + whether it wears out. The good ITSELF (name, icon) lives once in the global catalog
 *  (`catalog/goods.ts`); this is only the classification, keyed to it by `typeId`. */
export interface EquipGoodSpec {
  readonly typeId: number;
  readonly id: string;
  readonly category: EquipCategory;
  readonly wears: boolean;
}

/**
 * The equip classification for the original's equippable goods (`goodtypes.ini` ids 30–55, carried by the
 * global catalog at the sandbox-scoped 130–155); `sandboxContent()` merges this slot/wear axis onto the
 * catalog goods by `typeId`. Set membership is source-pinned to `tribetypes.ini` `allowequip`; the per-good
 * slot category is derived from the `goodtypes.ini` good names + the manual's Equipment section
 * (shoes/tools/mead/potions/amulets for anyone, weapons/armour for soldiers). `wears` is pinned to the
 * manual's two-axis split: potions, shoes and tools are "slowly used up" while "unused items such as
 * weapons, armour and amulets can be used again" (amulets "never wear out"). No per-good numeric
 * consumption rate exists in any readable `.ini` (engine-hardcoded), so none is modelled here — a wearing
 * item just carries a "degree of use".
 */
export const EQUIP_GOODS: readonly EquipGoodSpec[] = [
  { typeId: GOOD_SHOES, id: 'shoes', category: 'boots', wears: true },
  { typeId: 131, id: 'tool_wooden', category: 'tool', wears: true },
  { typeId: GOOD_TOOL_IRON, id: 'tool_iron', category: 'tool', wears: true },
  { typeId: 133, id: 'armor_wool', category: 'armor', wears: false },
  { typeId: 134, id: 'armor_leather', category: 'armor', wears: false },
  { typeId: GOOD_ARMOR_CHAIN, id: 'armor_chain', category: 'armor', wears: false },
  { typeId: 136, id: 'armor_plate', category: 'armor', wears: false },
  { typeId: GOOD_BOW_SHORT, id: 'bow_short', category: 'weapon', wears: false },
  { typeId: GOOD_BOW_LONG, id: 'bow_long', category: 'weapon', wears: false },
  { typeId: GOOD_SPEAR_WOODEN, id: 'spear_wooden', category: 'weapon', wears: false },
  { typeId: GOOD_SPEAR_IRON, id: 'spear_iron', category: 'weapon', wears: false },
  { typeId: GOOD_SWORD_SHORT, id: 'sword_shord', category: 'weapon', wears: false },
  { typeId: GOOD_SWORD_LONG, id: 'sword_long', category: 'weapon', wears: false },
  { typeId: GOOD_MEAD, id: 'mead', category: 'misc', wears: true },
  { typeId: GOOD_POTION_FOOD_SMALL, id: 'potion_food_small', category: 'misc', wears: true },
  { typeId: 145, id: 'potion_food_big', category: 'misc', wears: true },
  { typeId: GOOD_POTION_STAMINA_SMALL, id: 'potion_stamina_small', category: 'misc', wears: true },
  { typeId: 147, id: 'potion_stamina_big', category: 'misc', wears: true },
  { typeId: 148, id: 'potion_heal_small', category: 'misc', wears: true },
  { typeId: 149, id: 'potion_heal_big', category: 'misc', wears: true },
  { typeId: 150, id: 'amulet_food', category: 'misc', wears: false },
  { typeId: 151, id: 'amulet_stamina', category: 'misc', wears: false },
  { typeId: GOOD_AMULET_STRENGTH, id: 'amulet_strength', category: 'misc', wears: false },
  { typeId: 153, id: 'amulet_defense', category: 'misc', wears: false },
  { typeId: 154, id: 'amulet_crithit', category: 'misc', wears: false },
  { typeId: 155, id: 'amulet_speed', category: 'misc', wears: false },
];
