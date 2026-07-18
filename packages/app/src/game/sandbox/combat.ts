import type { EquipCategory } from '@open-northland/data';
import { PRIMARY_TRIBE } from '../rules.js';
import {
  EQUIP_GOODS,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  WEAPON_BROADSWORD,
  WEAPON_FISTS,
  WEAPON_LONG_BOW,
  WEAPON_SHORT_BOW,
  WEAPON_SPEAR,
  WEAPON_SWORD,
} from './ids/index.js';

/**
 * The sandbox combat content — the weapon swing timings, damages, and the {@link sandboxWeapons} table
 * the global {@link import('./content/index.js').sandboxContent} set assembles from. Swing lengths + hit frames
 * are transcribed from the extracted viking `atomicanimations.ini` records; the bare-target damages from the
 * readable `weapons.ini` `damagevalue 0` (same source basis), so sandbox combat resolves on the real scale —
 * a headless scene fights like the browser on real content, no separate sandbox-scale tuning.
 */

/** Munition type 1 = arrow — what the bows fire. */
const ARROW_MUNITION = 1;
/** The ranged weapon main-type (projectile weapons). */
const RANGED_MAIN_TYPE = 6;
/** The real short/long-bow projectile speed. */
const BOW_SPEED = 8;
/** ATTACK event type (25): the frame a melee blow lands / a bow draw looses its arrow. */
export const ATTACK_EVENT_TYPE = 25;
// Each swing's length + hit/release frame is its `viking_soldier_attack_*` record's length + `event
// <frame> 25`. The sim swing duration must equal the decoded gfx frame-list length (`[gfxanimatomic]`
// per-direction counts: sword 12, spear 27, broadsword 29, bows 12/28) or the drawn swing truncates
// mid-animation.
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
// Bare-target damage (`weapons.ini` `damagevalue 0`) per weapon, transcribed from the readable source like
// the swing timings above, so sandbox combat runs on the real scale (a ~5000-HP fighter takes several
// swings — see the battle scene). The per-armor-material columns stay in the extracted IR; the sandbox
// models only the bare-target column each soldier job actually swings with.
const FIST_DAMAGE = 400; // fist
const SWORD_DAMAGE = 1600; // short_sword
const SPEAR_DAMAGE = 3800; // iron_spear
const BROADSWORD_DAMAGE = 3800; // long_sword
const BOW_DAMAGE = 500; // short_bow
const LONG_BOW_DAMAGE = 700; // long_bow

// vs-BUILDING damage — the weapon's HOUSE column (`weapons.ini` `damagevalue 7`,
// {@link import('@open-northland/sim').ARMOR_MATERIAL} `HOUSE`), what a warrior does to a structure.
// A NAMED SANDBOX APPROXIMATION (the real per-material columns live in the extracted IR, which the browser
// loads): melee weapons chop a wall near their flesh rate, arrows barely scratch masonry. Sized so a
// warband razes a home / watchtower / HQ (30k / 60k / 100k HP — `construction.ts`) in a watchable siege,
// not instantly and not forever.
const FIST_VS_BUILDING = 120;
const SWORD_VS_BUILDING = 1000;
const SPEAR_VS_BUILDING = 1400;
const BROADSWORD_VS_BUILDING = 2000;
const SHORT_BOW_VS_BUILDING = 140;
const LONG_BOW_VS_BUILDING = 200;

/** The equip classification (slot + wear) per good typeId, so `sandboxContent()` can merge it onto the
 *  global catalog good of the same typeId (an equippable good is declared once, in `EXTENDED_GOODS`). */
export const EQUIP_CLASS_BY_TYPE: ReadonlyMap<number, { category: EquipCategory; wears: boolean }> = new Map(
  EQUIP_GOODS.map((g) => [g.typeId, { category: g.category, wears: g.wears }]),
);

/**
 * The sandbox weapon set — each viking soldier job's weapon with its range band and synthetic damage.
 * Bound to `sandboxContent().weapons`; the melee weapons swing at range 1(-2), the bows fire arrows.
 */
export function sandboxWeapons() {
  return [
    {
      typeId: WEAPON_FISTS,
      id: 'viking_fist',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_SOLDIER_UNARMED,
      minRange: 1,
      maxRange: 1,
      damage: { '0': FIST_DAMAGE, '7': FIST_VS_BUILDING },
    },
    {
      typeId: WEAPON_SPEAR,
      id: 'viking_spear',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_SOLDIER_SPEAR,
      minRange: 1,
      maxRange: 2, // a spear pokes one cell further than a sword (the original's long-melee band)
      damage: { '0': SPEAR_DAMAGE, '7': SPEAR_VS_BUILDING },
    },
    {
      typeId: WEAPON_SWORD,
      id: 'viking_sword',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_SOLDIER_SWORD,
      minRange: 1,
      maxRange: 1,
      damage: { '0': SWORD_DAMAGE, '7': SWORD_VS_BUILDING },
    },
    {
      typeId: WEAPON_BROADSWORD,
      id: 'viking_broadsword',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_SOLDIER_BROADSWORD,
      minRange: 1,
      maxRange: 2, // the original's long sword reaches 1–2
      damage: { '0': BROADSWORD_DAMAGE, '7': BROADSWORD_VS_BUILDING },
    },
    {
      typeId: WEAPON_SHORT_BOW,
      id: 'viking_short_bow',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_ARCHER,
      mainType: RANGED_MAIN_TYPE,
      munitionType: ARROW_MUNITION,
      speed: BOW_SPEED,
      minRange: 3,
      maxRange: 15,
      damage: { '0': BOW_DAMAGE, '7': SHORT_BOW_VS_BUILDING },
    },
    {
      typeId: WEAPON_LONG_BOW,
      id: 'viking_long_bow',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_ARCHER_LONG,
      mainType: RANGED_MAIN_TYPE,
      munitionType: ARROW_MUNITION,
      speed: BOW_SPEED,
      minRange: 4,
      maxRange: 23,
      damage: { '0': LONG_BOW_DAMAGE, '7': LONG_BOW_VS_BUILDING },
    },
  ];
}
