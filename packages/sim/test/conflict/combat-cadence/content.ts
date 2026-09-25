import { type ContentSet, parseContentSet } from '@open-northland/data';
import { WEAPON_MAIN_TYPE } from '../../../src/systems/index.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';

/**
 * Combat cadence + hit-frame + stagger + need-drain + fight-XP - the "make a melee exchange run at the
 * data's cadence" slice (combat rework part 1). The shared fixture's attack animations are length-only
 * (no ATTACK event, no need-drain, no weapon `mainType`), so those tests exercise only the fallback
 * paths; THIS fixture mirrors the real soldier data (`atomicanimations12/atomicanimations.ini` +
 * `weapons.ini`, verified 2026-07-03) - attack animations carrying the `event <frame> 25` ATTACK cue
 * and the `event 2 {1,2} -20`/`-100` need-drains, the AP-asymmetric spear/sword `damagevalue` columns,
 * and the civilian `setatomic 82 "..._attacked"` stagger binding - so the mechanics can be pinned to
 * the exact frames/values the data specifies. Synthetic (no copyrighted bytes), but numerically faithful.
 */

export const VIKING = 1;
export const SAXON = 2;
export const OTHER = 99; // a tribe with NO content record - a valid PvP enemy (not an animal), never fights back
export const WOLF_TRIBE = 20; // an animal tribe (carries an `animals` row) - its swings must train nothing

export const WOMAN = 5;
export const SOLDIER_UNARMED = 31;
export const SOLDIER_SPEAR = 33;
export const SOLDIER_SWORD_SHORT = 34;
export const SOLDIER_SWORD_LONG = 35;
export const SOLDIER_SABER = 36;
/** A short-bow soldier: a ranged weapon with a dead zone, `minimumrange 3`. */
export const SOLDIER_BOW = 37;
export const BOW_MIN_RANGE = 3;
/** The saber's and the axe's `mainType` in `weapons.ini`, classes the sim does not know: no fight bucket
 *  reads them. */
export const SABER_MAIN_TYPE = 4;
export const AXE_MAIN_TYPE = 5;
export const HERO = 42; // hero band - its swings feed the `hero general` track (70), not soldier's (69)

export const CHAIN_CLASS = 3; // armor typeId/material 3
export const PLATE_CLASS = 4; // armor typeId/material 4
/** The `blockingValue` of both armor records, the base data's 5. */
export const ARMOR_BLOCKING = 5;

export const ATTACK_ATOMIC = 81;
export const ATTACKED_ATOMIC = 82;

// Real weapon damagevalue columns (viking, verified in the extracted IR) - the AP asymmetry the test pins:
// the iron spear is anti-plate (2090 vs plate 4 / 950 vs chain 3); the long sword is anti-chain (the mirror).
export const IRON_SPEAR_DAMAGE = { '0': 3800, '1': 1900, '2': 2850, '3': 950, '4': 2090, '6': 200, '7': 500 };
export const LONG_SWORD_DAMAGE = { '0': 3800, '1': 1900, '2': 2850, '3': 2090, '4': 950, '6': 200, '7': 500 };
export const SHORT_SWORD_DAMAGE = { '0': 1600, '1': 800, '2': 1200, '3': 400, '4': 400, '6': 60, '7': 225 };
export const WOMAN_FIST_DAMAGE = { '0': 400, '1': 80, '2': 300, '3': 40, '4': 40, '6': 20, '7': 50 };

export const SOLDIER_DRAIN = -20; // soldier swings carry `event 2 1 -20` + `event 2 2 -20`
export const WOMAN_DRAIN = -100; // woman/civilist swings carry `event 2 1 -100` + `event 2 2 -100`

/** The REST/HUNGER channel event pair a swing carries, at frame 2 (`event 2 1 <d>` + `event 2 2 <d>`). */
export function drainEvents(delta: number): Array<{ at: number; type: number; value: number }> {
  return [
    { at: 2, type: 1, value: delta },
    { at: 2, type: 2, value: delta },
  ];
}

/** A synthetic-but-numerically-faithful soldier combat content: real damage columns, real ATTACK-event
 *  frames, real need-drains, real stagger bindings. Two playable tribes (viking/saxon) so the two-squad
 *  scenario runs a mutual exchange; the saxon mirrors the viking's spear so both sides fight identically. */
export function combatCadenceContent(): ContentSet {
  const soldierJobs = [
    SOLDIER_UNARMED,
    SOLDIER_SPEAR,
    SOLDIER_SWORD_SHORT,
    SOLDIER_SWORD_LONG,
    SOLDIER_SABER,
    SOLDIER_BOW,
  ];
  // Both tribes bind the same (job → attack animation) rows - the animation names are tribe-agnostic join
  // keys; the per-tribe asymmetry lives in the weapons. The woman alone carries the ATTACKED (82) stagger.
  const bindings = [
    { jobType: WOMAN, atomicId: ATTACK_ATOMIC, animation: 'woman_attack' },
    { jobType: WOMAN, atomicId: ATTACKED_ATOMIC, animation: 'woman_attacked' },
    { jobType: SOLDIER_UNARMED, atomicId: ATTACK_ATOMIC, animation: 'soldier_attack_unarmed' },
    { jobType: SOLDIER_SPEAR, atomicId: ATTACK_ATOMIC, animation: 'soldier_attack_spear_iron' },
    { jobType: SOLDIER_SWORD_SHORT, atomicId: ATTACK_ATOMIC, animation: 'soldier_attack_sword_short' },
    { jobType: SOLDIER_SWORD_LONG, atomicId: ATTACK_ATOMIC, animation: 'soldier_attack_sword_long' },
    // The saber attack animation carries NO ATTACK event - the completion-fallback + saber-has-no-fight-XP case.
    { jobType: SOLDIER_SABER, atomicId: ATTACK_ATOMIC, animation: 'soldier_attack_saber' },
    { jobType: SOLDIER_BOW, atomicId: ATTACK_ATOMIC, animation: 'soldier_attack_spear_iron' },
  ];
  const weaponsFor = (tribe: number) => [
    {
      typeId: 2,
      id: 'woman_fist',
      tribeType: tribe,
      jobType: WOMAN,
      mainType: WEAPON_MAIN_TYPE.UNARMED,
      minRange: 1,
      maxRange: 1,
      damage: WOMAN_FIST_DAMAGE,
    },
    {
      typeId: 1,
      id: 'fist',
      tribeType: tribe,
      jobType: SOLDIER_UNARMED,
      mainType: WEAPON_MAIN_TYPE.UNARMED,
      minRange: 1,
      maxRange: 1,
      damage: WOMAN_FIST_DAMAGE,
    },
    {
      typeId: 5,
      id: 'iron_spear',
      tribeType: tribe,
      jobType: SOLDIER_SPEAR,
      mainType: WEAPON_MAIN_TYPE.SPEAR,
      minRange: 1,
      maxRange: 2,
      damage: IRON_SPEAR_DAMAGE,
    },
    {
      typeId: 7,
      id: 'short_sword',
      tribeType: tribe,
      jobType: SOLDIER_SWORD_SHORT,
      mainType: WEAPON_MAIN_TYPE.SWORD,
      minRange: 1,
      maxRange: 1,
      damage: SHORT_SWORD_DAMAGE,
    },
    {
      typeId: 8,
      id: 'long_sword',
      tribeType: tribe,
      jobType: SOLDIER_SWORD_LONG,
      mainType: WEAPON_MAIN_TYPE.SWORD,
      minRange: 1,
      maxRange: 2,
      damage: LONG_SWORD_DAMAGE,
    },
    {
      typeId: 11,
      id: 'short_bow',
      tribeType: tribe,
      jobType: SOLDIER_BOW,
      mainType: WEAPON_MAIN_TYPE.BOW,
      minRange: BOW_MIN_RANGE,
      maxRange: 12,
      munitionType: 1,
      speed: 3,
      damage: SHORT_SWORD_DAMAGE,
    },
    {
      typeId: 10,
      id: 'saber',
      tribeType: tribe,
      jobType: SOLDIER_SABER,
      mainType: SABER_MAIN_TYPE,
      minRange: 1,
      maxRange: 1,
      damage: SHORT_SWORD_DAMAGE,
    },
  ];

  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: 35, id: 'chain', classification: { producedInHouse: true } },
      { typeId: 36, id: 'plate', classification: { producedInHouse: true } },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOMAN, id: 'woman' },
      // `jobtypes.ini` marks every soldier and hero `ignoresHomeHouseFlag 1`: they never go home, so
      // what a swing costs their rest is not halved for being out in the field.
      ...soldierJobs.map((typeId) => ({ typeId, id: `soldier_${typeId}`, ignoresHomeHouse: true })),
      { typeId: HERO, id: 'hero', ignoresHomeHouse: true },
    ],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'storage' as const }],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    weapons: [...weaponsFor(VIKING), ...weaponsFor(SAXON)],
    armor: [
      {
        typeId: CHAIN_CLASS,
        id: 'chain_armor',
        goodType: 35,
        materialType: 3,
        blockingValue: ARMOR_BLOCKING,
      },
      {
        typeId: PLATE_CLASS,
        id: 'plate_armor',
        goodType: 36,
        materialType: 4,
        blockingValue: ARMOR_BLOCKING,
      },
    ],
    tribes: [
      // A `jobEnables` edge makes each a civilization (not an animal - isAnimalTribe is false), so the two
      // tribes are mutually hostile through the real `mayAttack` relation. The edge kind is irrelevant here.
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: bindings,
        jobEnables: [{ jobType: SOLDIER_SPEAR, kind: 'house', targetId: 1 }],
      },
      {
        typeId: SAXON,
        id: 'saxon',
        atomicBindings: bindings,
        jobEnables: [{ jobType: SOLDIER_SPEAR, kind: 'house', targetId: 1 }],
      },
      { typeId: WOLF_TRIBE, id: 'wolves' },
    ],
    animals: [{ id: 'wolf', tribeType: WOLF_TRIBE, hitpointsAdult: 500, maximumGroupSize: 3 }],
    atomicAnimations: [
      // The ATTACK event frame (type 25) is the exact frame the extracted IR carries for each weapon.
      {
        id: 'soldier_attack_unarmed',
        name: 'soldier_attack_unarmed',
        length: 12,
        events: [...drainEvents(SOLDIER_DRAIN), { at: 6, type: 25 }],
      },
      {
        id: 'soldier_attack_spear_iron',
        name: 'soldier_attack_spear_iron',
        length: 27,
        events: [...drainEvents(SOLDIER_DRAIN), { at: 17, type: 25 }],
      },
      {
        id: 'soldier_attack_sword_short',
        name: 'soldier_attack_sword_short',
        length: 12,
        events: [...drainEvents(SOLDIER_DRAIN), { at: 9, type: 25 }],
      },
      {
        id: 'soldier_attack_sword_long',
        name: 'soldier_attack_sword_long',
        length: 29,
        events: [...drainEvents(SOLDIER_DRAIN), { at: 16, type: 25 }],
      },
      // The saber swing has the drains but NO ATTACK event (type 25) - the completion-fallback case.
      {
        id: 'soldier_attack_saber',
        name: 'soldier_attack_saber',
        length: 12,
        events: [...drainEvents(SOLDIER_DRAIN)],
      },
      {
        id: 'woman_attack',
        name: 'woman_attack',
        length: 16,
        events: [...drainEvents(WOMAN_DRAIN), { at: 6, type: 25 }],
      },
      // The stagger animation: length 50, zero events (purely visual flinch), NOT interruptible.
      { id: 'woman_attacked', name: 'woman_attacked', length: 50, interruptible: false },
    ],
    // The `soldier general` track (type 69) whose experienceFactor is the per-swing fight-XP rate,
    // and the `hero general` sibling (70) the hero band accrues instead.
    jobExperience: [
      {
        typeId: 69,
        id: 'soldier_general',
        name: 'soldier general',
        jobType: SOLDIER_UNARMED,
        experienceFactor: 1,
      },
      { typeId: 70, id: 'hero_general', name: 'hero general', jobType: HERO, experienceFactor: 1 },
    ],
  });
}
