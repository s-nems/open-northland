import type { Command } from '@open-northland/sim';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_CARRIER,
  JOB_CIVILIST,
  JOB_COLLECTOR,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
} from '../../catalog/jobs.js';
import {
  GATHERERS,
  WEAPON_BROADSWORD,
  WEAPON_FISTS,
  WEAPON_LONG_BOW,
  WEAPON_SHORT_BOW,
  WEAPON_SPEAR,
  WEAPON_SWORD,
  type WeaponGoodLookup,
  weaponEquipmentFor,
} from '../../game/sandbox/ids/index.js';

/**
 * The tables the admin spawn palette offers. Everything is driven off the shared sandbox ids, so a new
 * soldier class or gatherer shows up here for free.
 */

/** One spawnable unit: its `spawnSettler` job plus, for a warrior, the weapon it wields. */
export interface UnitPreset {
  readonly id: string;
  readonly jobType: number;
  /** A warrior's wielded weapon, omitted for a civilian. The matching equipment-slot good is derived
   *  from `jobType`, so it cannot drift from the scene and map spawns. */
  readonly weaponTypeId?: number;
}

/** The per-spawn knobs the palette applies to every unit it drops; a resource ignores them. */
export interface UnitSpawnOptions {
  /** A slot in `[0, MAX_PLAYERS)`. */
  readonly player: number;
  /** The spawned settler's tribe, which decides whose buildings it may staff. */
  readonly tribe: number;
  /** `<= 0` defers to the sim's default settler pool. */
  readonly hitpoints: number;
  /** The worn armor class 1..4; `<= 0` spawns unarmored. */
  readonly armorClass: number;
  readonly x: number;
  readonly y: number;
  /** Resolves the class weapon's good slug into the id space the sim actually plays on. */
  readonly goods: WeaponGoodLookup;
}

/**
 * Build the `spawnSettler` command for a unit preset at a tile. A non-positive `hitpoints` or
 * `armorClass` and a civilian's absent weapon are omitted, leaving the sim's own defaults.
 */
export function unitSpawnCommand(preset: UnitPreset, opts: UnitSpawnOptions): Command {
  // Derived from the job and shared with the scene and map spawns; a bare-handed warrior gets none,
  // which leaves the slot empty and the body unarmed.
  const equipment = weaponEquipmentFor(preset.jobType, opts.goods);
  return {
    kind: 'spawnSettler',
    jobType: preset.jobType,
    x: opts.x,
    y: opts.y,
    tribe: opts.tribe,
    owner: opts.player,
    ...(opts.hitpoints > 0 ? { hitpoints: opts.hitpoints } : {}),
    ...(preset.weaponTypeId !== undefined ? { weaponTypeId: preset.weaponTypeId } : {}),
    ...(opts.armorClass > 0 ? { armorClass: opts.armorClass } : {}),
    ...(equipment !== undefined ? { equipment } : {}),
  };
}

/** The soldier classes, each paired with its weapon so the drawn body and attack animation match it. */
export const WARRIOR_PRESETS: readonly UnitPreset[] = [
  { id: 'unarmed', jobType: JOB_SOLDIER_UNARMED, weaponTypeId: WEAPON_FISTS },
  { id: 'spear', jobType: JOB_SOLDIER_SPEAR, weaponTypeId: WEAPON_SPEAR },
  { id: 'sword', jobType: JOB_SOLDIER_SWORD, weaponTypeId: WEAPON_SWORD },
  {
    id: 'broadsword',
    jobType: JOB_SOLDIER_BROADSWORD,
    weaponTypeId: WEAPON_BROADSWORD,
  },
  { id: 'bow', jobType: JOB_ARCHER, weaponTypeId: WEAPON_SHORT_BOW },
  { id: 'longbow', jobType: JOB_ARCHER_LONG, weaponTypeId: WEAPON_LONG_BOW },
];

/** The civilian trades. One collector preset covers every gathered good, since they share the trade. */
export const CIVILIAN_PRESETS: readonly UnitPreset[] = [
  { id: 'civilian', jobType: JOB_CIVILIST },
  { id: 'carrier', jobType: JOB_CARRIER },
  { id: 'collector', jobType: JOB_COLLECTOR },
];

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

/** Full hit points, an empty hold and no crew; a ship dropped within its door distance of land moors. */
export function vehicleSpawnCommand(vehicleType: number, opts: VehicleSpawnOptions): Command {
  return { kind: 'createVehicle', vehicleType, x: opts.x, y: opts.y, tribe: opts.tribe, owner: opts.player };
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

/** 0 is unarmoured, plus the `[armortype]` classes 1..4 that mitigate an incoming hit. */
export const ARMOR_CLASSES = [0, 1, 2, 3, 4] as const;

/**
 * Approximation: rough CSS stand-ins for the real team-colour LUT, so a swatch reads at a glance. Slot
 * order is the player id; a spawned unit is recoloured by the LUT, never by these hexes.
 */
const PLAYER_SWATCH_CSS = [
  '#4a7bd6', // blue (the human player)
  '#d64a4a', // red
  '#d6c84a', // yellow
  '#4ad6d6', // cyan
  '#5ad65a', // green
  '#9a4ad6', // purple
  '#9a9a9a', // grey
  '#d6884a', // orange
] as const;

export interface PlayerSwatch {
  readonly player: number;
  readonly css: string;
}

/** The first N player slots with an authored swatch colour; the sim itself supports up to `MAX_PLAYERS`. */
export const PLAYER_SWATCHES: readonly PlayerSwatch[] = PLAYER_SWATCH_CSS.map((css, player) => ({
  player,
  css,
}));
