import type { EquipCategory } from '@vinland/data';
import {
  CLAY_HARVEST_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  STONE_HARVEST_ATOMIC,
} from '../../catalog/atomics.js';
import {
  CLAY_DEPOSIT_UNITS,
  GOLD_DEPOSIT_UNITS,
  IRON_DEPOSIT_UNITS,
  MINE_LEVELS,
  STONE_DEPOSIT_UNITS,
} from '../../catalog/mining.js';

/**
 * The sandbox content's semantic type ids — goods, jobs, buildings, weapons — plus the per-good
 * {@link GATHERERS} table that drives the gathering half of the content, the placement helpers and the
 * scene checks. The ids are the ONE place a sandbox `typeId` gets a name; everything else refers to
 * these constants, never a bare number (repo no-magic-numbers rule).
 */

export const GOOD_NONE = 0;
export const GOOD_WOOD = 1;
export const GOOD_PLANK = 2;
export const GOOD_COIN = 3;
export const GOOD_STONE = 4;
export const GOOD_MUD = 5;
export const GOOD_IRON = 6;
export const GOOD_GOLD = 7;
export const GOOD_MUSHROOM = 8;

// The equippable goods ride the SANDBOX-SCOPED catalog ids — `EXTENDED_GOOD_TYPE_OFFSET` (100) + the raw
// `goodtypes.ini` id (30–55) = 130–155 — the SAME ids the global goods catalog (`catalog/goods.ts`
// `EXTENDED_GOODS`) declares them at. So an EQUIPPED good is the same good as the one dropped on the ground
// or stored in a warehouse: one id, one `ls_goods` icon, one name. The demo equipment scene stamps these;
// EQUIP_GOODS below adds only the equip CLASSIFICATION (slot + wear), merged onto the catalog by good id.
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
 * The equip CLASSIFICATION for the original's equippable goods (`goodtypes.ini` ids 30–55, carried by the
 * global catalog at the sandbox-scoped 130–155). The GOODS themselves — id, name, icon — live once in
 * `catalog/goods.ts` (`EXTENDED_GOODS`); `sandboxContent()` merges this slot/wear axis onto them by
 * `typeId`, so a good is declared once. Set MEMBERSHIP is source-pinned to `tribetypes.ini` `allowequip`;
 * the per-good SLOT CATEGORY is derived from the `goodtypes.ini` good names + the manual's Equipment
 * section (shoes/tools/mead/potions/amulets for anyone, weapons/armour for soldiers). `wears` is pinned to
 * the manual's two-axis split: potions, shoes and tools are "slowly used up" while "unused items such as
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

export const JOB_IDLE = 0;
export const JOB_GATHERER_WOOD = 20;
export const JOB_GATHERER_STONE = 21;
export const JOB_GATHERER_MUD = 22;
export const JOB_GATHERER_IRON = 23;
export const JOB_GATHERER_GOLD = 24;
export const JOB_GATHERER_MUSHROOM = 25;
// Deliberately OUTSIDE the real soldier band (31..41) so the job→body map draws the civilian body — the
// previous 36 was the real `soldier_saber_short`, so the carrier drew an armoured swordsman. 26 is the
// real `jobtypes.ini` `trader_sea`, borrowed here only because it isn't in `ADULT_CHARACTER_BY_JOB` (so
// it falls to the civilian body); the REAL carrier id (type 24) is taken by the synthetic gatherer band
// (20..25) above. Renumbering the sandbox id space onto the real trade/carrier ids is its own cleanup.
export const JOB_CARRIER = 26;
// Soldier jobs ride the REAL viking `jobtypes.ini` ids (soldiers 31..41) so the render's job→body map
// (`ADULT_CHARACTER_BY_JOB`) draws each class's own warrior body + weapon animation set.
export const JOB_SOLDIER_UNARMED = 31; // soldier_unarmed — the fists warrior (empty-hand body, brawls)
// The base, UNARMED soldier (`jobtypes.ini` type 31) is also the single profession the picker offers: a
// weapon (a later step) specializes it into a spear/sword/bow class — only a soldier carries a weapon, so
// the base soldier stands unarmed until armed. Same job as {@link JOB_SOLDIER_UNARMED}, named for the picker.
export const JOB_SOLDIER = JOB_SOLDIER_UNARMED;
export const JOB_SOLDIER_SPEAR = 33; // soldier_spear_iron
export const JOB_SOLDIER_SWORD = 34; // soldier_sword_short
export const JOB_SOLDIER_BROADSWORD = 35; // soldier_sword_long
export const JOB_ARCHER = 40; // soldier_bow_short
export const JOB_ARCHER_LONG = 41; // soldier_bow_long

/**
 * Base offset the extracted building worker-slot job ids are lifted by so they clear the sandbox's own
 * job band (idle 0, gatherers 20..25, carrier 26, soldiers 31..41, the picker professions — all < 1000).
 * A rebased slot job is `BASE + originalId`; the carrier keeps its own {@link JOB_CARRIER} id. See
 * `content.ts` {@link import('./content.js')} BUILDING_WORKER_SLOTS for why the rebase is needed (the
 * original `logicworker` ids overlap the bands above).
 */
export const WORKER_SLOT_JOB_BASE = 1000;

/**
 * The extracted worker-slot trades that are OUTDOOR RESOURCE GATHERERS (`jobtypes.ini`: 8 collector,
 * 15 hunter, 22 fisher), keyed by their ORIGINAL id. A gatherer roams the map collecting a raw good and
 * drops it at a flag — so, like the sandbox's own gatherers, it is NEVER hand-assigned to a building by
 * right-click and draws the gatherer badge colour (it happens to sit in a storehouse's or workshop's
 * `logicworker` pool, but that is the economy's to fill, not the player's).
 *
 * Source basis: hand-classified from the `jobtypes.ini` roaming semantics (an approximation — `ir.json`
 * carries no role field to pin to). It agrees with the one real signal `jobtypes.ini` does carry,
 * `UserShouldAttachWorkPlaceAfterJobChangeFlag`, which is absent/0 for these three. The sea fisher
 * (`fisher_sea` 23) is deliberately EXCLUDED: it sets that flag to 1 (the game DOES want it attached to a
 * workplace), and it staffs no sandbox building anyway.
 */
export const EXTRACTED_GATHERER_TRADES: ReadonlySet<number> = new Set([8, 15, 22]);

/** Rebase one extracted slot job clear of the sandbox band ({@link WORKER_SLOT_JOB_BASE}) — the carrier
 *  keeps its own {@link JOB_CARRIER} id (the hauler the badge/assignment UI single out). */
export function rebaseSlotJob(jobType: number): number {
  return jobType === JOB_CARRIER ? JOB_CARRIER : WORKER_SLOT_JOB_BASE + jobType;
}

/** The FARMER worker-slot job (`jobtypes.ini` 18, rebased like every extracted slot trade) — the one
 *  slot job with real behaviour: it runs the field loop (sow/water/reap wheat around its farm), so the
 *  sandbox content defines it explicitly with the farmer atomics instead of the generic backfill. */
export const JOB_FARMER_SLOT = WORKER_SLOT_JOB_BASE + 18;

/** The grain farm (`houses.ini` logictype 12 — "work farm 00"). */
export const BUILDING_FARM = 12;
/** The mill (`houses.ini` logictype 13 — "work mill 00"): grinds wheat into flour. */
export const BUILDING_MILL = 13;
/** The MILLER worker-slot job (`jobtypes.ini` 19, rebased like every extracted slot trade) — the
 *  mill's recipe operator; the generic producer drive (fetch wheat → grind → haul flour out) needs
 *  no job-specific atomics, so the backfilled slot job carries the behaviour as-is. */
export const JOB_MILLER_SLOT = WORKER_SLOT_JOB_BASE + 19;

// The builder trade — the REAL viking `jobtypes.ini` id 7 (below the soldier band, so the job→body map
// draws a civilian body). Permitted to run the build-house atomic; the planner's builder drive puts a
// settler of this job on a foundation. Used by the construction scene.
export const JOB_BUILDER = 7;
// The build-house atomic (`setatomic 7 39`) lives in the shared atomics catalog beside the harvest/attack
// ids — re-exported here so the sandbox id space stays the ONE place these constants are named for scenes.
export { BUILD_HOUSE_ATOMIC } from '../../catalog/atomics.js';

export const BUILDING_HEADQUARTERS = 1;
/** The base-tier residence (`home_level_00`) — the "house" the construction scene raises from a foundation. */
export const BUILDING_HOME_00 = 2;
/** The three warehouse levels (`stock_00`/`stock_01`/`stock_02`) — general-goods stores like the HQ. */
export const BUILDING_WAREHOUSE_00 = 7;
export const BUILDING_WAREHOUSE_01 = 8;
export const BUILDING_WAREHOUSE_02 = 9;
export const BUILDING_JOINERY = 23;

// Weapon typeIds ride the REAL viking `weapons.ini` ids (fist 1, iron_spear 5, short_sword 7,
// long_sword 8, short_bow 16, long_bow 17) — the previous synthetic 20/21 bows collided with the real
// house_bow (20) and catapult (21), a scoped-id trap for anyone joining these against extracted data.
export const WEAPON_FISTS = 1; // "fist" (weapons.ini type 1, jobtype 31) — the unarmed warrior's melee
export const WEAPON_SPEAR = 5;
export const WEAPON_SWORD = 7;
export const WEAPON_BROADSWORD = 8;
export const WEAPON_SHORT_BOW = 16;
export const WEAPON_LONG_BOW = 17;

/**
 * Soldier `jobType` → the weapon GOOD it carries in its `Equipment.weapon` slot. So EVERY warrior — a
 * scene-placed one, an imported-map `sethuman`, or an admin spawn — fills its Broń slot and draws the
 * weapon that matches its class (the slot DRIVES the look, `WARRIOR_SPEC_BY_WEAPON_GOOD`). The bare-handed
 * job (`JOB_SOLDIER_UNARMED`, 31) is deliberately absent → an empty slot → the fists body.
 */
export const WEAPON_GOOD_BY_JOB: Readonly<Record<number, number>> = {
  [JOB_SOLDIER_SPEAR]: GOOD_SPEAR_IRON,
  [JOB_SOLDIER_SWORD]: GOOD_SWORD_SHORT,
  [JOB_SOLDIER_BROADSWORD]: GOOD_SWORD_LONG,
  [JOB_ARCHER]: GOOD_BOW_SHORT,
  [JOB_ARCHER_LONG]: GOOD_BOW_LONG,
};

/**
 * The `spawnSettler` `equipment` payload a soldier job spawns with — just its weapon in the equipment
 * slot — or `undefined` for a job with no weapon good (civilians, the bare-handed warrior). The one place
 * every spawn path derives a warrior's equipment weapon, so they can't drift.
 */
export function weaponEquipmentFor(
  jobType: number,
): { readonly weapon: { readonly goodType: number } } | undefined {
  const goodType = WEAPON_GOOD_BY_JOB[jobType];
  return goodType !== undefined ? { weapon: { goodType } } : undefined;
}

/** How a good leaves the landscape: chop a tree down, dig a finite deposit, or pluck a small node. */
export type GatherMode = 'fell' | 'mine' | 'pick';

export interface GathererSpec {
  readonly good: number;
  readonly id: string;
  readonly job: number;
  readonly label: string;
  readonly atomic: number;
  readonly animation: string;
  readonly mode: GatherMode;
  readonly nodes: number;
  readonly depositUnits?: number;
  readonly depositLevels?: number;
}

/** One row per gatherable good: its job, harvest atomic + clip, and how its nodes deplete. */
export const GATHERERS: readonly GathererSpec[] = [
  {
    good: GOOD_WOOD,
    id: 'wood',
    job: JOB_GATHERER_WOOD,
    label: 'Zbieracz (Drewno)',
    atomic: HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_tree',
    mode: 'fell',
    nodes: 2,
  },
  {
    good: GOOD_STONE,
    id: 'stone',
    job: JOB_GATHERER_STONE,
    label: 'Zbieracz (Kamien)',
    atomic: STONE_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_stone',
    mode: 'mine',
    nodes: 1,
    depositUnits: STONE_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_MUD,
    id: 'mud',
    job: JOB_GATHERER_MUD,
    label: 'Zbieracz (Glina)',
    atomic: CLAY_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_mud',
    mode: 'mine',
    nodes: 1,
    depositUnits: CLAY_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_IRON,
    id: 'iron',
    job: JOB_GATHERER_IRON,
    label: 'Zbieracz (Zelazo)',
    atomic: IRON_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_iron',
    mode: 'mine',
    nodes: 1,
    depositUnits: IRON_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_GOLD,
    id: 'gold',
    job: JOB_GATHERER_GOLD,
    label: 'Zbieracz (Zloto)',
    atomic: GOLD_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_gold',
    mode: 'mine',
    nodes: 1,
    depositUnits: GOLD_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOOD_MUSHROOM,
    id: 'mushroom',
    job: JOB_GATHERER_MUSHROOM,
    label: 'Zbieracz (Grzyby)',
    atomic: MUSHROOM_HARVEST_ATOMIC,
    animation: 'viking_collector_harvest_mushroom',
    mode: 'pick',
    nodes: 3,
  },
] as const;
