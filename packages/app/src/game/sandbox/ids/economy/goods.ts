import type { EquipClass } from '@open-northland/data';

/** Goods and equipment ids in the sandbox-scoped economy namespace. The six gathered goods + coin carry
 *  their real `goodtypes.ini` (ir.json) typeIds, so a placed wood/stone/… resolves against either the
 *  sandbox or the real content base; the rest of the catalog — including the food chain (wheat 104 /
 *  flour 111) — rides `EXTENDED_GOOD_TYPE_OFFSET`, and synthetic goods sit in a band above. */

export const GOOD_NONE = 0;
export const GOOD_MUD = 2;
export const GOOD_STONE = 3;
export const GOOD_WOOD = 5;
export const GOOD_IRON = 6;
export const GOOD_GOLD = 7;
export const GOOD_COIN = 8;
export const GOOD_MUSHROOM = 14;

/** Synthetic sandbox-only goods have no ir.json counterpart, so they sit above the real (1–65) and
 *  extended (101–165) id ranges and never collide with a real good. */
const SYNTHETIC_GOOD_BASE = 200;
/** `plank` — the joinery slice's synthetic demo output (sawn `wood`); no real good matches it, so it
 *  lives in the {@link SYNTHETIC_GOOD_BASE} band rather than among the real economy ids. */
export const GOOD_PLANK = SYNTHETIC_GOOD_BASE;

// The equippable goods ride the sandbox-scoped catalog ids — `EXTENDED_GOOD_TYPE_OFFSET` (100) + the raw
// `goodtypes.ini` id (30–55) = 130–155 — the same ids the global goods catalog (`catalog/goods.ts`
// `EXTENDED_GOODS`) declares them at, so an equipped good is the same good as the one dropped on the ground
// or stored in a warehouse: one id, one `ls_goods` icon, one name.
/** Water — the well's in-house product, a bakery input (`goodtypes.ini` type 1, at the +100 catalog offset). */
export const GOOD_WATER = 101;
/** Wheat — the field-farmed grain (`goodtypes.ini` type 4, at the +100 catalog offset). */
export const GOOD_WHEAT = 104;
/** Flour — the mill's in-house product ground from wheat (`goodtypes.ini` type 11, at the +100 offset). */
export const GOOD_FLOUR = 111;
/** Bread — the bakery's in-house product baked from water + flour (`goodtypes.ini` type 19, at the +100 offset). */
export const GOOD_BREAD = 119;
/** The two eat-slot foods homes stock (`goodtypes.ini` types 16/17, at the +100 offset) — the `food_`
 *  slug prefix is what the sim's `isFood` recognizes as edible. */
export const GOOD_FOOD_SIMPLE = 116;
export const GOOD_FOOD_EXTRA = 117;
export const GOOD_SHOES = 130;
export const GOOD_TOOL_IRON = 132;
export const GOOD_ARMOR_CHAIN = 135;
// Weapon goods — the equippable side of the weapons. A settler carrying one in its `Equipment.weapon`
// slot draws that weapon's warrior body (WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG, joined by good id-slug).
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

/** One equippable good's full equip axis (the shared data-package {@link EquipClass}: slot category,
 *  wear flag, and the effect/wear numbers). The good itself (name, icon) lives once in the global
 *  catalog (`catalog/goods.ts`); this is only the classification, keyed to it by `typeId`. */
export type EquipGoodSpec = EquipClass & {
  readonly typeId: number;
  readonly id: string;
};

// The balance magnitudes below are user rules (2026-07-24) except where marked manual-pinned; no
// readable source carries any of them (the engine hardcodes its values - see the EquipClass doc).

/** Rated waypoint-arrivals for a pair of shoes: ~1% per 30 walked cells at ~2 route waypoints per
 *  cell (named approximation - anisotropic by heading mix). */
const SHOE_USES = 6000;
/** Rated production cycles for a tool (~1% per completed cycle). */
const TOOL_USES = 100;
/** Sips in a small bottle (mead, small potions) and a big one - manual-pinned ("Small potions can
 *  be used twice, large ones can be used five times"; mead sized like a small bottle). */
const SMALL_BOTTLE_USES = 2;
const BIG_BOTTLE_USES = 5;
/** One sip's restore percents: mead +40 hunger AND +40 fatigue (matches one meal -
 *  EAT_HUNGER_RESTORE is 40%); a potion +50 of its one bar (heal: percent of max HP). */
const MEAD_RESTORE = { hunger: 40, fatigue: 40 } as const;
const POTION_RESTORE_PCT = 50;
/** Boots walk-gait bonus, percent. The manual also promises shoes slow hunger/fatigue ("uses up
 *  less energy"); that half is deliberately DROPPED - boots are speed-only here (named deviation). */
const SHOE_SPEED_BONUS_PCT = 40;
/** ADDITIVE per-cycle production credit, percent of the recipe outputs - added to the experience
 *  bonus, never multiplied. */
const WOODEN_TOOL_BONUS_PCT = 30;
const IRON_TOOL_BONUS_PCT = 60;

/**
 * The equip classification for the original's equippable goods (`goodtypes.ini` ids 30–55, carried by the
 * global catalog at the sandbox-scoped 130–155); `sandboxContent()` merges this axis onto the
 * catalog goods by `typeId`. Set membership is source-pinned to `tribetypes.ini` `allowequip`; the per-good
 * slot category is derived from the `goodtypes.ini` good names + the manual's Equipment section
 * (shoes/tools/mead/potions/amulets for anyone, weapons/armour for soldiers). `wears` is pinned to the
 * manual's two-axis split: potions, shoes and tools are "slowly used up" while "unused items such as
 * weapons, armour and amulets can be used again" (amulets "never wear out"). Effect/wear magnitudes are
 * the named constants above; amulet and weapon/armor effects are the deferred combat phase's.
 */
export const EQUIP_GOODS: readonly EquipGoodSpec[] = [
  {
    typeId: GOOD_SHOES,
    id: 'shoes',
    category: 'boots',
    wears: true,
    speedBonusPct: SHOE_SPEED_BONUS_PCT,
    uses: SHOE_USES,
  },
  {
    typeId: 131,
    id: 'tool_wooden',
    category: 'tool',
    wears: true,
    productionBonusPct: WOODEN_TOOL_BONUS_PCT,
    uses: TOOL_USES,
  },
  {
    typeId: GOOD_TOOL_IRON,
    id: 'tool_iron',
    category: 'tool',
    wears: true,
    productionBonusPct: IRON_TOOL_BONUS_PCT,
    uses: TOOL_USES,
  },
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
    restorePct: { hunger: POTION_RESTORE_PCT },
  },
  {
    typeId: 145,
    id: 'potion_food_big',
    category: 'misc',
    wears: true,
    uses: BIG_BOTTLE_USES,
    restorePct: { hunger: POTION_RESTORE_PCT },
  },
  {
    typeId: GOOD_POTION_STAMINA_SMALL,
    id: 'potion_stamina_small',
    category: 'misc',
    wears: true,
    uses: SMALL_BOTTLE_USES,
    restorePct: { fatigue: POTION_RESTORE_PCT },
  },
  {
    typeId: 147,
    id: 'potion_stamina_big',
    category: 'misc',
    wears: true,
    uses: BIG_BOTTLE_USES,
    restorePct: { fatigue: POTION_RESTORE_PCT },
  },
  {
    typeId: 148,
    id: 'potion_heal_small',
    category: 'misc',
    wears: true,
    uses: SMALL_BOTTLE_USES,
    restorePct: { healthMax: POTION_RESTORE_PCT },
  },
  {
    typeId: 149,
    id: 'potion_heal_big',
    category: 'misc',
    wears: true,
    uses: BIG_BOTTLE_USES,
    restorePct: { healthMax: POTION_RESTORE_PCT },
  },
  { typeId: 150, id: 'amulet_food', category: 'misc', wears: false },
  { typeId: 151, id: 'amulet_stamina', category: 'misc', wears: false },
  { typeId: GOOD_AMULET_STRENGTH, id: 'amulet_strength', category: 'misc', wears: false },
  { typeId: 153, id: 'amulet_defense', category: 'misc', wears: false },
  { typeId: 154, id: 'amulet_crithit', category: 'misc', wears: false },
  { typeId: 155, id: 'amulet_speed', category: 'misc', wears: false },
];
