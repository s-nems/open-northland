import {
  ANIMAL_TRIBE_BEARS,
  ANIMAL_TRIBE_LIONESSES,
  ANIMAL_TRIBE_LIONS,
  ANIMAL_TRIBE_POLAR_BEARS,
  ANIMAL_TRIBE_WOLVES,
} from './animal-tribes.js';
import { JOB_SOLDIER_UNARMED } from './jobs.js';

export const MONSTER_TRIBE_WERESNAKE = 5;
export const MONSTER_TRIBE_WEREWOLF = 6;
export const MONSTER_TRIBES: ReadonlySet<number> = new Set([MONSTER_TRIBE_WERESNAKE, MONSTER_TRIBE_WEREWOLF]);

/** `weapontype` id 1, the claw/fist slot a monster's natural weapon binds at (tribe-scoped, extracted). */
export const NATURAL_WEAPON_TYPE = 1;

export const SANDBOX_MONSTER_TRIBES = [
  { typeId: MONSTER_TRIBE_WERESNAKE, id: 'weresnake', naturalWeaponType: NATURAL_WEAPON_TYPE },
  { typeId: MONSTER_TRIBE_WEREWOLF, id: 'werewolf', naturalWeaponType: NATURAL_WEAPON_TYPE },
] as const;

// Readable setatomic and atomicanimation rows. Event 25 lands a blow, 34 cues sound, and 26 moves
// the animal forward. The two monster clips author three blows each.
export const CREATURE_ATTACKS = [
  {
    tribeType: MONSTER_TRIBE_WERESNAKE,
    jobType: JOB_SOLDIER_UNARMED,
    name: 'weresnake_soldier_attack',
    length: 32,
    events: [
      { at: 2, type: 1, value: -100 },
      { at: 2, type: 2, value: -100 },
      { at: 4, type: 34, value: 64 },
      { at: 6, type: 25 },
      { at: 9, type: 34, value: 65 },
      { at: 10, type: 25 },
      { at: 17, type: 34, value: 66 },
      { at: 22, type: 25 },
    ],
  },
  {
    tribeType: MONSTER_TRIBE_WEREWOLF,
    jobType: JOB_SOLDIER_UNARMED,
    name: 'werewolf_soldier_attack',
    length: 33,
    events: [
      { at: 2, type: 1, value: -100 },
      { at: 2, type: 2, value: -100 },
      { at: 4, type: 34, value: 119 },
      { at: 6, type: 25 },
      { at: 8, type: 34, value: 119 },
      { at: 10, type: 25 },
      { at: 20, type: 34, value: 119 },
      { at: 22, type: 25 },
    ],
  },
  {
    tribeType: ANIMAL_TRIBE_BEARS,
    jobType: 49,
    name: 'animal_bear_attack',
    length: 20,
    events: [
      { at: 1, type: 34, value: 101 },
      { at: 6, type: 25 },
    ],
  },
  {
    tribeType: ANIMAL_TRIBE_POLAR_BEARS,
    jobType: 49,
    name: 'animal_bear_attack',
    length: 20,
    events: [
      { at: 1, type: 34, value: 101 },
      { at: 6, type: 25 },
    ],
  },
  {
    tribeType: ANIMAL_TRIBE_WOLVES,
    jobType: 49,
    name: 'animal_wolve_attack',
    length: 25,
    events: [
      { at: 1, type: 34, value: 104 },
      { at: 2, type: 25 },
      { at: 23, type: 26 },
    ],
  },
  {
    tribeType: ANIMAL_TRIBE_LIONS,
    jobType: 49,
    name: 'animal_lion_male_attack',
    length: 25,
    events: [
      { at: 1, type: 34, value: 107 },
      { at: 9, type: 25 },
      { at: 22, type: 26 },
    ],
  },
  {
    tribeType: ANIMAL_TRIBE_LIONESSES,
    jobType: 49,
    name: 'animal_lion_female_attack',
    length: 25,
    events: [
      { at: 1, type: 34, value: 107 },
      { at: 9, type: 25 },
      { at: 22, type: 26 },
    ],
  },
  {
    tribeType: MONSTER_TRIBE_WERESNAKE,
    jobType: 35,
    name: 'animal_bear_attack',
    length: 20,
    events: [
      { at: 1, type: 34, value: 101 },
      { at: 6, type: 25 },
    ],
  },
  {
    tribeType: MONSTER_TRIBE_WERESNAKE,
    jobType: 33,
    name: 'animal_wolve_attack',
    length: 25,
    events: [
      { at: 1, type: 34, value: 104 },
      { at: 2, type: 25 },
      { at: 23, type: 26 },
    ],
  },
  {
    tribeType: MONSTER_TRIBE_WERESNAKE,
    jobType: 32,
    name: 'animal_lion_male_attack',
    length: 25,
    events: [
      { at: 1, type: 34, value: 107 },
      { at: 9, type: 25 },
      { at: 22, type: 26 },
    ],
  },
  {
    tribeType: MONSTER_TRIBE_WERESNAKE,
    jobType: 18,
    name: 'weresnake_chicken_attack',
    length: 50,
    events: [{ at: 6, type: 34, value: 0 }],
  },
  {
    tribeType: MONSTER_TRIBE_WERESNAKE,
    jobType: 16,
    name: 'weresnake_chicken_attack',
    length: 50,
    events: [{ at: 6, type: 34, value: 0 }],
  },
] as const;

// Natural weapon type 1 is scoped by tribe. The columns are damagevalue armor classes 0,1,2,3,4,6,7.
const BEAR_DAMAGE = { '0': 800, '1': 400, '2': 600, '3': 200, '4': 200, '6': 50, '7': 50 };
const POLAR_BEAR_DAMAGE = { '0': 1300, '1': 650, '2': 975, '3': 325, '4': 325, '6': 50, '7': 50 };
const WOLF_DAMAGE = { '0': 350, '1': 175, '2': 260, '3': 85, '4': 85, '6': 50, '7': 50 };
const LION_DAMAGE = { '0': 800, '1': 400, '2': 600, '3': 200, '4': 200, '6': 50, '7': 50 };
const CLAW_DAMAGE = { '0': 1600, '1': 800, '2': 1200, '3': 400, '4': 400, '6': 40, '7': 150 };

export const CREATURE_WEAPONS = [
  { tribeType: ANIMAL_TRIBE_BEARS, id: 'bearfist', damage: BEAR_DAMAGE },
  { tribeType: ANIMAL_TRIBE_POLAR_BEARS, id: 'evilrabbitbit', damage: POLAR_BEAR_DAMAGE },
  { tribeType: ANIMAL_TRIBE_WOLVES, id: 'wolvefist', damage: WOLF_DAMAGE },
  { tribeType: ANIMAL_TRIBE_LIONS, id: 'lionmalefist', damage: LION_DAMAGE },
  { tribeType: ANIMAL_TRIBE_LIONESSES, id: 'lionfemalefist', damage: LION_DAMAGE },
  { tribeType: MONSTER_TRIBE_WERESNAKE, id: 'claw', jobType: JOB_SOLDIER_UNARMED, damage: CLAW_DAMAGE },
  { tribeType: MONSTER_TRIBE_WEREWOLF, id: 'claw', jobType: JOB_SOLDIER_UNARMED, damage: CLAW_DAMAGE },
] as const;
