import type { EquipClass } from '@open-northland/data';

/** The gathered goods and coin carry their real `goodtypes.ini` typeIds, so a placed wood or stone
 *  resolves against either content base. The rest ride `EXTENDED_GOOD_TYPE_OFFSET`, with synthetic
 *  goods in a band above. */

export const GOOD_NONE = 0;
export const GOOD_MUD = 2;
export const GOOD_STONE = 3;
export const GOOD_WOOD = 5;
export const GOOD_IRON = 6;
export const GOOD_GOLD = 7;
export const GOOD_COIN = 8;
export const GOOD_MUSHROOM = 14;

/** Synthetic sandbox-only goods have no ir.json counterpart, so they sit above the real (1-65) and
 *  extended (101-165) id ranges and never collide with a real good. */
const SYNTHETIC_GOOD_BASE = 200;
export const GOOD_PLANK = SYNTHETIC_GOOD_BASE;

// The ids below are the raw `goodtypes.ini` id at `EXTENDED_GOOD_TYPE_OFFSET` (100), the same ids the
// global goods catalog declares, so an equipped good is the same good as the one stored in a warehouse.
export const GOOD_WATER = 101;
export const GOOD_WHEAT = 104;
export const GOOD_FLOUR = 111;
export const GOOD_HERB = 113;
export const GOOD_HOLY_OIL = 115;
export const GOOD_BREAD = 119;
export const GOOD_BRICK = 124;
export const GOOD_TILE = 125;
export const GOOD_CROCKERY = 128;
export const GOOD_FURNITURE = 129;
/** The `food_` slug prefix is what the sim's `isFood` recognizes as edible. */
export const GOOD_FOOD_SIMPLE = 116;
export const GOOD_FOOD_EXTRA = 117;
// Sheep and cattle are the fed-animal tokens the animal farm stocks in-house, not storable wares.
export const GOOD_LEATHER = 109;
export const GOOD_WOOL = 110;
export const GOOD_MEAT = 121;
export const GOOD_SHEEP = 157;
export const GOOD_CATTLE = 158;
export const GOOD_SHOES = 130;
export const GOOD_TOOL_WOODEN = 131;
export const GOOD_TOOL_IRON = 132;
export const GOOD_ARMOR_WOOL = 133;
export const GOOD_ARMOR_LEATHER = 134;
export const GOOD_ARMOR_CHAIN = 135;
export const GOOD_ARMOR_PLATE = 136;
// A settler carrying one of these in its `Equipment.weapon` slot draws that weapon's warrior body.
export const GOOD_BOW_SHORT = 137;
export const GOOD_BOW_LONG = 138;
export const GOOD_SPEAR_WOODEN = 139;
export const GOOD_SPEAR_IRON = 140;
export const GOOD_SWORD_SHORT = 141;
export const GOOD_SWORD_LONG = 142;
export const GOOD_MEAD = 143;
export const GOOD_POTION_FOOD_SMALL = 144;
export const GOOD_POTION_FOOD_BIG = 145;
export const GOOD_POTION_STAMINA_SMALL = 146;
export const GOOD_POTION_STAMINA_BIG = 147;
export const GOOD_POTION_HEAL_SMALL = 148;
export const GOOD_POTION_HEAL_BIG = 149;
export const GOOD_AMULET_STRENGTH = 152;

/** The classification only; the good itself, with its name and icon, lives once in the global catalog. */
export type EquipGoodSpec = EquipClass & {
  readonly typeId: number;
  readonly id: string;
};

// The balance magnitudes below are authored, not extracted, except where marked manual-pinned: the
// original fixes its own values and no readable source carries them.

/** A pair of shoes' condition points in the original:
 *  every node walked off spends its roughness, doubled while hauling. */
const SHOE_USES = 10000;
/** Rated uses for a tool: production cycles, gathering strokes, casts and build swings alike. */
const TOOL_USES = 100;
/** Original behavior, as the manual says: "Small potions can be used twice, large ones can be used five
 *  times". Mead is a small bottle. */
const SMALL_BOTTLE_USES = 2;
const BIG_BOTTLE_USES = 5;
/** One sip's restore in percent of a need bar or of max hitpoints. The original's values: mead half of
 *  each bar, a food or stamina potion a whole bar, a healing potion 2000 of a settler's 5000 hitpoints. */
const MEAD_RESTORE = { hunger: 50, fatigue: 50 } as const;
const NEED_POTION_RESTORE_PCT = 100;
const HEALING_POTION_RESTORE_PCT = 40;
/** Percent of the recipe outputs a worn tool adds per cycle, summed with the experience bonus rather
 *  than multiplied with it. The original's values. */
const WOODEN_TOOL_BONUS_PCT = 20;
const IRON_TOOL_BONUS_PCT = 70;
/** A tool's work factor for strokes and build swings, percent of bare hands. The original's values. */
const WOODEN_TOOL_WORK_FACTOR_PCT = 125;
const IRON_TOOL_WORK_FACTOR_PCT = 175;

/**
 * Set membership is pinned to `tribetypes.ini` `allowequip`. The slot category is derived from the
 * `goodtypes.ini` names and the manual's Equipment section, and `wears` from the manual's split between
 * items "slowly used up" and "unused items such as weapons, armour and amulets".
 */
export const EQUIP_GOODS: readonly EquipGoodSpec[] = [
  {
    typeId: GOOD_SHOES,
    id: 'shoes',
    category: 'boots',
    wears: true,
    uses: SHOE_USES,
  },
  {
    typeId: GOOD_TOOL_WOODEN,
    id: 'tool_wooden',
    category: 'tool',
    wears: true,
    productionBonusPct: WOODEN_TOOL_BONUS_PCT,
    workFactorPct: WOODEN_TOOL_WORK_FACTOR_PCT,
    uses: TOOL_USES,
  },
  {
    typeId: GOOD_TOOL_IRON,
    id: 'tool_iron',
    category: 'tool',
    wears: true,
    productionBonusPct: IRON_TOOL_BONUS_PCT,
    workFactorPct: IRON_TOOL_WORK_FACTOR_PCT,
    uses: TOOL_USES,
  },
  {
    typeId: GOOD_ARMOR_WOOL,
    id: 'armor_wool',
    category: 'armor',
    wears: false,
  },
  {
    typeId: GOOD_ARMOR_LEATHER,
    id: 'armor_leather',
    category: 'armor',
    wears: false,
  },
  {
    typeId: GOOD_ARMOR_CHAIN,
    id: 'armor_chain',
    category: 'armor',
    wears: false,
  },
  {
    typeId: GOOD_ARMOR_PLATE,
    id: 'armor_plate',
    category: 'armor',
    wears: false,
  },
  { typeId: GOOD_BOW_SHORT, id: 'bow_short', category: 'weapon', wears: false },
  { typeId: GOOD_BOW_LONG, id: 'bow_long', category: 'weapon', wears: false },
  {
    typeId: GOOD_SPEAR_WOODEN,
    id: 'spear_wooden',
    category: 'weapon',
    wears: false,
  },
  {
    typeId: GOOD_SPEAR_IRON,
    id: 'spear_iron',
    category: 'weapon',
    wears: false,
  },
  {
    typeId: GOOD_SWORD_SHORT,
    id: 'sword_shord',
    category: 'weapon',
    wears: false,
  },
  {
    typeId: GOOD_SWORD_LONG,
    id: 'sword_long',
    category: 'weapon',
    wears: false,
  },
  {
    typeId: GOOD_MEAD,
    id: 'mead',
    category: 'misc',
    wears: true,
    uses: SMALL_BOTTLE_USES,
    restorePct: MEAD_RESTORE,
  },
  {
    typeId: GOOD_POTION_FOOD_SMALL,
    id: 'potion_food_small',
    category: 'misc',
    wears: true,
    uses: SMALL_BOTTLE_USES,
    restorePct: { hunger: NEED_POTION_RESTORE_PCT },
  },
  {
    typeId: GOOD_POTION_FOOD_BIG,
    id: 'potion_food_big',
    category: 'misc',
    wears: true,
    uses: BIG_BOTTLE_USES,
    restorePct: { hunger: NEED_POTION_RESTORE_PCT },
  },
  {
    typeId: GOOD_POTION_STAMINA_SMALL,
    id: 'potion_stamina_small',
    category: 'misc',
    wears: true,
    uses: SMALL_BOTTLE_USES,
    restorePct: { fatigue: NEED_POTION_RESTORE_PCT },
  },
  {
    typeId: GOOD_POTION_STAMINA_BIG,
    id: 'potion_stamina_big',
    category: 'misc',
    wears: true,
    uses: BIG_BOTTLE_USES,
    restorePct: { fatigue: NEED_POTION_RESTORE_PCT },
  },
  {
    typeId: GOOD_POTION_HEAL_SMALL,
    id: 'potion_heal_small',
    category: 'misc',
    wears: true,
    uses: SMALL_BOTTLE_USES,
    restorePct: { healthMax: HEALING_POTION_RESTORE_PCT },
  },
  {
    typeId: GOOD_POTION_HEAL_BIG,
    id: 'potion_heal_big',
    category: 'misc',
    wears: true,
    uses: BIG_BOTTLE_USES,
    restorePct: { healthMax: HEALING_POTION_RESTORE_PCT },
  },
  { typeId: 150, id: 'amulet_food', category: 'misc', wears: false },
  { typeId: 151, id: 'amulet_stamina', category: 'misc', wears: false },
  {
    typeId: GOOD_AMULET_STRENGTH,
    id: 'amulet_strength',
    category: 'misc',
    wears: false,
  },
  { typeId: 153, id: 'amulet_defense', category: 'misc', wears: false },
  { typeId: 154, id: 'amulet_crithit', category: 'misc', wears: false },
  { typeId: 155, id: 'amulet_speed', category: 'misc', wears: false },
];
