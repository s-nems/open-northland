import type { ContentSet } from '@open-northland/data';
import { type Command, systems } from '@open-northland/sim';
import { MONSTER_TRIBE_WERESNAKE, MONSTER_TRIBE_WEREWOLF } from '../../catalog/creatures.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BREEDER,
  JOB_CHILD_FEMALE,
  JOB_CHILD_MALE,
  JOB_CIVILIST,
  JOB_FARMER,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  JOB_WOMAN,
} from '../../catalog/jobs.js';
import { BYZANTINE } from '../../catalog/unit-variants.js';
import {
  GATHERERS,
  WEAPON_BROADSWORD,
  WEAPON_FISTS,
  WEAPON_GOOD_SLUG_BY_JOB,
  WEAPON_LONG_BOW,
  WEAPON_SHORT_BOW,
  WEAPON_SPEAR,
  WEAPON_SWORD,
  WEAPON_WOODEN_SPEAR,
  type WeaponGoodLookup,
  weaponEquipmentFor,
} from '../../game/sandbox/ids/index.js';

/**
 * The tables the debug tools' spawn tab offers. Everything is driven off the shared sandbox ids, so a new
 * soldier class or gatherer shows up here for free.
 */

/** Who a person spawn is: the job decides the sex, and a child job the age. */
export interface PersonPreset {
  readonly id: 'man' | 'woman' | 'boy' | 'girl';
  readonly jobType: number;
  /** Takes professions, so the panel may spawn it with all of them learned. */
  readonly learns?: boolean;
}

export const PERSON_PRESETS: readonly PersonPreset[] = [
  { id: 'man', jobType: JOB_CIVILIST, learns: true },
  { id: 'woman', jobType: JOB_WOMAN },
  { id: 'boy', jobType: JOB_CHILD_MALE },
  { id: 'girl', jobType: JOB_CHILD_FEMALE },
];

/** A soldier's weapon: the class whose body and attack it draws, and the weapon it wields. */
export interface SoldierWeapon {
  readonly jobType: number;
  readonly weaponTypeId: number;
}

/** A soldier's weapon until another is picked. */
export const DEFAULT_SOLDIER_WEAPON: SoldierWeapon = {
  jobType: JOB_SOLDIER_SWORD,
  weaponTypeId: WEAPON_SWORD,
};

/** In the panel's order: bare hands, then swords, bows and spears, the lighter first. */
export const SOLDIER_WEAPONS: readonly SoldierWeapon[] = [
  { jobType: JOB_SOLDIER_UNARMED, weaponTypeId: WEAPON_FISTS },
  DEFAULT_SOLDIER_WEAPON,
  { jobType: JOB_SOLDIER_BROADSWORD, weaponTypeId: WEAPON_BROADSWORD },
  { jobType: JOB_ARCHER, weaponTypeId: WEAPON_SHORT_BOW },
  { jobType: JOB_ARCHER_LONG, weaponTypeId: WEAPON_LONG_BOW },
  { jobType: JOB_SOLDIER_SPEAR_WOODEN, weaponTypeId: WEAPON_WOODEN_SPEAR },
  { jobType: JOB_SOLDIER_SPEAR, weaponTypeId: WEAPON_SPEAR },
];

/** The weapon good a soldier holds, by slug; undefined for bare hands. */
export function weaponGoodSlug(weapon: SoldierWeapon): string | undefined {
  return WEAPON_GOOD_SLUG_BY_JOB[weapon.jobType];
}

/** One wearable armor: its `[armortype]` class and the good worn in the armor slot. */
export interface ArmorEntry {
  readonly armorClass: number;
  readonly good: number;
  readonly id: string;
}

/** The content's armor classes in class order, each with the good it is worn as. */
export function armorEntriesOf(content: Pick<ContentSet, 'armor' | 'goods'>): ArmorEntry[] {
  return content.armor
    .flatMap((armor) => {
      const good = content.goods.find((g) => g.typeId === armor.goodType);
      return good === undefined ? [] : [{ armorClass: armor.typeId, good: good.typeId, id: good.id }];
    })
    .sort((a, b) => a.armorClass - b.armorClass);
}

/** The per-spawn settings shared by every person the panel drops. */
export interface PersonSpawnOptions {
  /** A slot in `[0, MAX_PLAYERS)`. */
  readonly player: number;
  /** The spawned settler's tribe, which decides whose buildings it may staff. */
  readonly tribe: number;
  /** `<= 0` defers to the sim's default settler pool. */
  readonly hitpoints: number;
  readonly x: number;
  readonly y: number;
}

/** A person spawn; `experience` lines it starts with (see {@link everyJobExperience}). */
export function personSpawnCommand(
  preset: PersonPreset,
  opts: PersonSpawnOptions & { readonly experience?: readonly (readonly [number, number])[] },
): Command {
  return {
    kind: 'spawnSettler',
    jobType: preset.jobType,
    x: opts.x,
    y: opts.y,
    tribe: opts.tribe,
    owner: opts.player,
    ...(opts.hitpoints > 0 ? { hitpoints: opts.hitpoints } : {}),
    ...(opts.experience !== undefined && opts.experience.length > 0 ? { experience: opts.experience } : {}),
  };
}

export interface SoldierSpawnOptions extends PersonSpawnOptions {
  readonly weapon: SoldierWeapon;
  /** Null spawns unarmored. */
  readonly armor: ArmorEntry | null;
  /** Resolves the weapon's good slug into the id space the sim actually plays on. */
  readonly goods: WeaponGoodLookup;
}

/**
 * A soldier spawn: the weapon's class and wielded weapon, the armor's class, and both goods in their
 * equipment slots, so the settler panel shows what it fights with. A soldier preset is a human soldier,
 * so a class with a creature form spawns its human form; the creature presets spawn the creatures.
 */
export function soldierSpawnCommand(opts: SoldierSpawnOptions): Command {
  // Shared with the scene and map spawns; bare hands leave the slot empty.
  const weapon = weaponEquipmentFor(opts.weapon.jobType, opts.goods)?.weapon;
  const armor = opts.armor;
  const equipment = {
    ...(weapon !== undefined ? { weapon } : {}),
    ...(armor !== null ? { armor: { goodType: armor.good } } : {}),
  };
  return {
    kind: 'spawnSettler',
    jobType: opts.weapon.jobType,
    x: opts.x,
    y: opts.y,
    tribe: opts.tribe,
    owner: opts.player,
    humanForm: true,
    ...(opts.hitpoints > 0 ? { hitpoints: opts.hitpoints } : {}),
    weaponTypeId: opts.weapon.weaponTypeId,
    ...(armor !== null ? { armorClass: armor.armorClass } : {}),
    ...(weapon !== undefined || armor !== null ? { equipment } : {}),
  };
}

/**
 * Starting experience that clears every `needfor*` and `trainfor*` row of the content's tribes: each
 * named track at the largest amount a row asks of it. A row naming two tracks sums them, so each alone
 * at that amount clears it too.
 */
export function everyJobExperience(
  content: Pick<ContentSet, 'tribes' | 'jobExperience'>,
): [number, number][] {
  const repeats = new Map<number, number>();
  for (const tribe of content.tribes) {
    for (const row of tribe.jobRequirements) {
      for (const track of row.experienceTypes)
        repeats.set(track, Math.max(repeats.get(track) ?? 0, row.amount));
    }
  }
  return [...repeats].map(([id, amount]) => [
    id,
    systems.rawXpForRepeats(
      content.jobExperience.find((track) => track.typeId === id),
      amount,
    ),
  ]);
}

/** Creature bodies have fixed tribes and natural weapons; they carry no human inventory goods. */
export interface CreaturePreset {
  readonly id: string;
  readonly tribe: number;
  readonly jobType: number;
}

export const CREATURE_PRESETS: readonly CreaturePreset[] = [
  { id: 'weresnake', tribe: MONSTER_TRIBE_WERESNAKE, jobType: JOB_SOLDIER_UNARMED },
  { id: 'werewolf', tribe: MONSTER_TRIBE_WEREWOLF, jobType: JOB_SOLDIER_UNARMED },
  { id: 'weresnakeSheep', tribe: MONSTER_TRIBE_WERESNAKE, jobType: JOB_BREEDER },
  { id: 'weresnakeChicken', tribe: MONSTER_TRIBE_WERESNAKE, jobType: JOB_FARMER },
  { id: 'weresnakeLion', tribe: MONSTER_TRIBE_WERESNAKE, jobType: JOB_SOLDIER_SPEAR_WOODEN },
  { id: 'weresnakeWolf', tribe: MONSTER_TRIBE_WERESNAKE, jobType: JOB_SOLDIER_SPEAR },
  { id: 'weresnakeBear', tribe: MONSTER_TRIBE_WERESNAKE, jobType: JOB_SOLDIER_BROADSWORD },
  { id: 'dragon', tribe: BYZANTINE, jobType: JOB_SOLDIER_SPEAR_WOODEN },
];

export function creatureSpawnCommand(
  preset: CreaturePreset,
  opts: Pick<PersonSpawnOptions, 'player' | 'hitpoints' | 'x' | 'y'>,
): Command {
  return {
    kind: 'spawnSettler',
    jobType: preset.jobType,
    x: opts.x,
    y: opts.y,
    tribe: preset.tribe,
    owner: opts.player,
    humanForm: false,
    ...(opts.hitpoints > 0 ? { hitpoints: opts.hitpoints } : {}),
  };
}

/** One spawnable species: its tribe plus the tribe's content id. */
export interface AnimalEntry {
  readonly tribe: number;
  readonly id: string;
}

/** Group size, leader and scatter come from the species' `animaltypes` record, which the sim owns. */
export function animalSpawnCommand(tribe: number, x: number, y: number): Command {
  return { kind: 'spawnAnimalHerd', tribe, x, y };
}

/** One spawnable vehicle type from the running content, with its localized name. */
export interface VehicleEntry {
  readonly vehicleType: number;
  readonly label: string;
}

/** A vehicle owned like a unit: the chosen player and that seat's tribe, whose body it draws. */
export interface VehicleSpawnOptions {
  readonly player: number;
  readonly tribe: number;
  readonly x: number;
  readonly y: number;
}

/** Full hit points, an empty hold and no crew; a ship stands moored at the berth nearest the click, or
 *  not at all when no shore is near. */
export function vehicleSpawnCommand(vehicleType: number, opts: VehicleSpawnOptions): Command {
  return {
    kind: 'createVehicle',
    vehicleType,
    x: opts.x,
    y: opts.y,
    tribe: opts.tribe,
    owner: opts.player,
    berth: true,
  };
}

/** One spawnable resource node: its good's typeId plus a short material label. */
export interface ResourceEntry {
  readonly good: number;
  readonly id: string;
}

/** Every gatherable good, each of which becomes a `placeResource` command. */
export const RESOURCE_ENTRIES: readonly ResourceEntry[] = GATHERERS.map((g) => ({
  good: g.good,
  id: g.id,
}));

/** One droppable good: its `dropGood` goodType plus the stable string id used for label and icon keying. */
export interface GoodEntry {
  readonly good: number;
  readonly id: string;
}

/** One unit per click; the sim stacks repeat clicks on a tile up to its ground-stack cap. */
export const ADMIN_DROP_AMOUNT = 1;

export function goodDropCommand(good: number, x: number, y: number): Command {
  return { kind: 'dropGood', good, x, y, amount: ADMIN_DROP_AMOUNT };
}
