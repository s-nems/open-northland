import type { ArmorType, EquipClass } from '@open-northland/data';
import { HUNTER_BOW_BALANCE } from '../../catalog/hunting.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_HUNTER,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
} from '../../catalog/jobs.js';
import { PRIMARY_TRIBE } from '../rules.js';
import { ANIMAL_TRIBE_BEARS, ANIMAL_TRIBE_WOLVES } from './content/catalog/animals.js';
import {
  EQUIP_GOODS,
  GOOD_ARMOR_CHAIN,
  GOOD_ARMOR_LEATHER,
  GOOD_ARMOR_PLATE,
  GOOD_ARMOR_WOOL,
  GOOD_BOW_LONG,
  GOOD_BOW_SHORT,
  GOOD_SPEAR_IRON,
  GOOD_SWORD_LONG,
  GOOD_SWORD_SHORT,
  WEAPON_BROADSWORD,
  WEAPON_FISTS,
  WEAPON_HOUSE_BOW,
  WEAPON_HUNTER_BOW,
  WEAPON_LONG_BOW,
  WEAPON_SHORT_BOW,
  WEAPON_SPEAR,
  WEAPON_SWORD,
} from './ids/index.js';

const ARROW_MUNITION = 1;
/** The `logicdefines.inc` `WEAPON_MAIN_TYPE_*` classes the viking rows carry. */
const UNARMED_MAIN_TYPE = 1;
const SPEAR_MAIN_TYPE = 2;
const SWORD_MAIN_TYPE = 3;
const RANGED_MAIN_TYPE = 6;
/** The real short/long-bow projectile speed. */
const BOW_SPEED = 8;
/** The `atomicanimations.ini` event code marking the frame a blow lands or an arrow looses. */
export const ATTACK_EVENT_TYPE = 25;
// Extracted from each `viking_soldier_attack_*` record's length and `event <frame> 25`. A swing
// duration must equal the decoded gfx frame-list length or the drawn swing truncates mid-animation.
export const FIST_SWING_LENGTH = 12; // viking_soldier_attack_unarmed
export const FIST_HIT_FRAME = 6;
export const SWORD_SWING_LENGTH = 12; // viking_soldier_attack_sword_short
export const SWORD_HIT_FRAME = 9;
export const SPEAR_SWING_LENGTH = 27; // viking_soldier_attack_spear_iron
export const SPEAR_HIT_FRAME = 17;
export const BROADSWORD_SWING_LENGTH = 29; // viking_soldier_attack_sword_long
export const BROADSWORD_HIT_FRAME = 16;
export const SHORT_BOW_DRAW_LENGTH = 12; // viking_soldier_attack_bow_short
export const SHORT_BOW_RELEASE_FRAME = 10;
export const LONG_BOW_DRAW_LENGTH = 28; // viking_soldier_attack_bow_long
export const LONG_BOW_RELEASE_FRAME = 22;
// Bare-target damage per weapon, extracted from `weapons.ini` `damagevalue 0`, so sandbox combat
// resolves on the same scale as real content.
const FIST_DAMAGE = 400; // fist
const SWORD_DAMAGE = 1600; // short_sword
const SPEAR_DAMAGE = 3800; // iron_spear
const BROADSWORD_DAMAGE = 3800; // long_sword
const BOW_DAMAGE = 500; // short_bow
const LONG_BOW_DAMAGE = 700; // long_bow
// The house bow, extracted from the mod `weapons.ini` type 20: band, speed and the damage columns by
// target material (bare, wool, leather, chain, plate, wood, house).
const HOUSE_BOW_MIN_RANGE = 0;
const HOUSE_BOW_MAX_RANGE = 29;
const HOUSE_BOW_SPEED = 7;
const HOUSE_BOW_DAMAGE: Readonly<Record<string, number>> = {
  '0': 375,
  '1': 240,
  '2': 300,
  '3': 150,
  '4': 150,
  '6': 9,
  '7': 50,
};
// Extracted from the mod `weapons.ini` `bearfist`/`wolvefist` rows. Both share weapon type 1 because
// the lookup key is `(tribeType, typeId)`. The source `goodtype 0` is dropped on purpose: carrying it
// would count good 0 among the military goods.
const ANIMAL_FIST_TYPE = 1;
const BEAR_FIST_DAMAGE = 800;
const WOLF_FIST_DAMAGE = 350;

// The weapon's HOUSE column (`weapons.ini` `damagevalue 7`). A named sandbox approximation, not
// extracted: sized so a warband razes a home, watchtower or HQ in a watchable siege.
const FIST_VS_BUILDING = 120;
const SWORD_VS_BUILDING = 1000;
const SPEAR_VS_BUILDING = 1400;
const BROADSWORD_VS_BUILDING = 2000;
const SHORT_BOW_VS_BUILDING = 140;
const LONG_BOW_VS_BUILDING = 200;

// Extracted per-material columns (`damagevalue <material> <value>`, materials 1..4 are wool, leather,
// chain, plate). The iron spear vs long sword chain/plate flip is the source's own data, not a typo.
const FIST_VS_MATERIALS = { '1': 80, '2': 300, '3': 40, '4': 40 };
const SPEAR_VS_MATERIALS = { '1': 1900, '2': 2850, '3': 950, '4': 2090 };
const SWORD_VS_MATERIALS = { '1': 800, '2': 1200, '3': 400, '4': 400 };
const BROADSWORD_VS_MATERIALS = { '1': 1900, '2': 2850, '3': 2090, '4': 950 };
const SHORT_BOW_VS_MATERIALS = { '1': 128, '2': 400, '3': 100, '4': 100 };
const LONG_BOW_VS_MATERIALS = { '1': 448, '2': 560, '3': 360, '4': 360 };

export const EQUIP_CLASS_BY_TYPE: ReadonlyMap<number, EquipClass> = new Map(
  EQUIP_GOODS.map(({ typeId, id: _id, ...equip }) => [typeId, equip]),
);

/** The same axis keyed by slug, because typeIds differ across id spaces (`shoes` is 130 here, 30 in
 *  real content). */
export const EQUIP_CLASS_BY_SLUG: ReadonlyMap<string, EquipClass> = new Map(
  EQUIP_GOODS.map(({ typeId: _typeId, id, ...equip }) => [id, equip]),
);

/** The four base tiers extracted from `armortypes.ini`, rebased onto the sandbox armor good ids. */
export function sandboxArmor(): ArmorType[] {
  return [
    {
      typeId: 1,
      id: 'armor_wool',
      mainType: 1,
      goodType: GOOD_ARMOR_WOOL,
      materialType: 1,
      weight: 1,
      blockingValue: 5,
    },
    {
      typeId: 2,
      id: 'armor_leather',
      mainType: 1,
      goodType: GOOD_ARMOR_LEATHER,
      materialType: 2,
      weight: 0,
      blockingValue: 5,
    },
    {
      typeId: 3,
      id: 'armor_chain',
      mainType: 2,
      goodType: GOOD_ARMOR_CHAIN,
      materialType: 3,
      weight: 3,
      blockingValue: 5,
    },
    {
      typeId: 4,
      id: 'armor_plate',
      mainType: 2,
      goodType: GOOD_ARMOR_PLATE,
      materialType: 4,
      weight: 3,
      blockingValue: 5,
    },
  ];
}

export function sandboxWeapons() {
  return [
    {
      typeId: WEAPON_FISTS,
      id: 'viking_fist',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_SOLDIER_UNARMED,
      mainType: UNARMED_MAIN_TYPE,
      minRange: 1,
      maxRange: 1,
      damage: { '0': FIST_DAMAGE, ...FIST_VS_MATERIALS, '7': FIST_VS_BUILDING },
    },
    // An armed class carries the extracted `goodtype`, so equipping the good takes the class up. The
    // wooden spear good binds no class here because its job 32 is outside the sandbox job set.
    {
      typeId: WEAPON_SPEAR,
      id: 'viking_spear',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_SOLDIER_SPEAR,
      mainType: SPEAR_MAIN_TYPE,
      goodType: GOOD_SPEAR_IRON,
      minRange: 1,
      maxRange: 2, // the original's long-melee band
      damage: { '0': SPEAR_DAMAGE, ...SPEAR_VS_MATERIALS, '7': SPEAR_VS_BUILDING },
    },
    {
      typeId: WEAPON_SWORD,
      id: 'viking_sword',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_SOLDIER_SWORD,
      mainType: SWORD_MAIN_TYPE,
      goodType: GOOD_SWORD_SHORT,
      minRange: 1,
      maxRange: 1,
      damage: { '0': SWORD_DAMAGE, ...SWORD_VS_MATERIALS, '7': SWORD_VS_BUILDING },
    },
    {
      typeId: WEAPON_BROADSWORD,
      id: 'viking_broadsword',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_SOLDIER_BROADSWORD,
      mainType: SWORD_MAIN_TYPE,
      goodType: GOOD_SWORD_LONG,
      minRange: 1,
      maxRange: 2, // the original's long-melee band
      damage: { '0': BROADSWORD_DAMAGE, ...BROADSWORD_VS_MATERIALS, '7': BROADSWORD_VS_BUILDING },
    },
    {
      typeId: WEAPON_SHORT_BOW,
      id: 'viking_short_bow',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_ARCHER,
      mainType: RANGED_MAIN_TYPE,
      goodType: GOOD_BOW_SHORT,
      munitionType: ARROW_MUNITION,
      speed: BOW_SPEED,
      minRange: 3,
      maxRange: 15,
      damage: { '0': BOW_DAMAGE, ...SHORT_BOW_VS_MATERIALS, '7': SHORT_BOW_VS_BUILDING },
    },
    {
      typeId: WEAPON_LONG_BOW,
      id: 'viking_long_bow',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_ARCHER_LONG,
      mainType: RANGED_MAIN_TYPE,
      goodType: GOOD_BOW_LONG,
      munitionType: ARROW_MUNITION,
      speed: BOW_SPEED,
      minRange: 4,
      maxRange: 23,
      damage: { '0': LONG_BOW_DAMAGE, ...LONG_BOW_VS_MATERIALS, '7': LONG_BOW_VS_BUILDING },
    },
    // No `goodType`, as the extracted row ships: the hunter's bow is the trade's own implement,
    // outside the equipment economy.
    {
      typeId: WEAPON_HUNTER_BOW,
      id: 'hunter_bow',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_HUNTER,
      mainType: RANGED_MAIN_TYPE,
      munitionType: ARROW_MUNITION,
      speed: BOW_SPEED,
      minRange: HUNTER_BOW_BALANCE.minRange,
      maxRange: HUNTER_BOW_BALANCE.maxRange,
      damage: { ...HUNTER_BOW_BALANCE.damage },
    },
    // The bow a civilian shoots from a defence-mode building. It binds by typeId rather than job, so a
    // sheltering farmer keeps its trade, and carries no `goodType`: the bow belongs to the building.
    {
      typeId: WEAPON_HOUSE_BOW,
      id: 'house_bow',
      tribeType: PRIMARY_TRIBE,
      mainType: RANGED_MAIN_TYPE,
      munitionType: ARROW_MUNITION,
      speed: HOUSE_BOW_SPEED,
      minRange: HOUSE_BOW_MIN_RANGE,
      maxRange: HOUSE_BOW_MAX_RANGE,
      damage: { ...HOUSE_BOW_DAMAGE },
    },
    // One row per animal tribe, because a jobless animal binds combat through its tribe's first weapon
    // row. Without one an aggressive wolf disengages instead of hunting.
    {
      typeId: ANIMAL_FIST_TYPE,
      id: 'bearfist',
      tribeType: ANIMAL_TRIBE_BEARS,
      minRange: 1,
      maxRange: 1,
      damage: { '0': BEAR_FIST_DAMAGE },
    },
    {
      typeId: ANIMAL_FIST_TYPE,
      id: 'wolvefist',
      tribeType: ANIMAL_TRIBE_WOLVES,
      minRange: 1,
      maxRange: 1,
      damage: { '0': WOLF_FIST_DAMAGE },
    },
  ];
}
