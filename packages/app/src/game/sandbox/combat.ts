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
 * are TRANSCRIBED from the extracted viking `atomicanimations.ini` records; damages are on the sandbox's
 * own synthetic scale (see the per-constant notes).
 */

/** Munition type 1 = arrow — what the bows fire. */
export const ARROW_MUNITION = 1;
/** The ranged weapon main-type (projectile weapons). */
export const RANGED_MAIN_TYPE = 6;
/** The real short/long-bow projectile speed. */
export const BOW_SPEED = 8;
/** ATTACK event type (25): the frame a melee blow lands / a bow draw looses its arrow. */
export const ATTACK_EVENT_TYPE = 25;
// Swing lengths + hit/release frames, TRANSCRIBED from the extracted viking `atomicanimations.ini`
// records (`viking_soldier_attack_*` — length + the `event <frame> 25`). The sim swing duration must
// equal the decoded gfx frame-list length (`[gfxanimatomic]` per-direction counts: sword 12, spear 27,
// broadsword 29, bows 12/28) or the DRAWN swing truncates mid-animation — the sandbox previously ran a
// made-up 4-tick sword swing against the 12-frame decoded swing, playing only its wind-up.
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
// Damage on the sandbox's own synthetic scale (the real per-material tables live in the extracted
// content; scene hitpoints are chosen so a duel takes several full swings — see the combat scene).
export const BOW_DAMAGE = 34;
export const SWORD_DAMAGE = 40;
export const SPEAR_DAMAGE = 45;
export const BROADSWORD_DAMAGE = 55;
// The fist is the weakest strike — a quarter of the short sword's, matching weapons.ini's fist
// damagevalue 0 (400) vs the short sword's (1600). Keeps the unarmed warrior a real but feeble brawler.
export const FIST_DAMAGE = 10;

/** The equip classification (slot + wear) per good typeId, so `sandboxContent()` can merge it onto the
 *  global catalog good of the same typeId (an equippable good is declared ONCE, in `EXTENDED_GOODS`). */
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
      damage: { '0': FIST_DAMAGE },
    },
    {
      typeId: WEAPON_SPEAR,
      id: 'viking_spear',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_SOLDIER_SPEAR,
      minRange: 1,
      maxRange: 2, // a spear pokes one cell further than a sword (the original's long-melee band)
      damage: { '0': SPEAR_DAMAGE },
    },
    {
      typeId: WEAPON_SWORD,
      id: 'viking_sword',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_SOLDIER_SWORD,
      minRange: 1,
      maxRange: 1,
      damage: { '0': SWORD_DAMAGE },
    },
    {
      typeId: WEAPON_BROADSWORD,
      id: 'viking_broadsword',
      tribeType: PRIMARY_TRIBE,
      jobType: JOB_SOLDIER_BROADSWORD,
      minRange: 1,
      maxRange: 2, // the original's long sword reaches 1–2
      damage: { '0': BROADSWORD_DAMAGE },
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
      damage: { '0': BOW_DAMAGE },
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
      damage: { '0': BOW_DAMAGE },
    },
  ];
}
