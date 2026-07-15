import type { Command } from '@open-northland/sim';
import { EXTENDED_GOODS } from '../../catalog/goods.js';
import { PRIMARY_TRIBE } from '../../game/rules.js';
import {
  GATHERERS,
  GOOD_COIN,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_PLANK,
  GOOD_STONE,
  GOOD_WOOD,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_CARRIER,
  JOB_COLLECTOR,
  JOB_IDLE,
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
  weaponEquipmentFor,
} from '../../game/sandbox/ids/index.js';

/**
 * The data the admin/debug spawn palette offers — unit presets, resource entries and the player
 * (team-colour) swatches — kept apart from the panel wiring ({@link import('./index.js')}) so the catalog
 * of "what can I spawn" is one obvious table. Everything is driven off the shared sandbox ids/{@link
 * GATHERERS} table (never bare numbers), so a new soldier class or gatherer shows up here for free.
 */

/** One spawnable unit: its `spawnSettler` job + (for a warrior) the weapon it wields. */
export interface UnitPreset {
  readonly id: string;
  readonly jobType: number;
  /** A combatant's wielded weapon (a warrior); omitted for a civilian (no weapon). The matching
   *  equipment-slot weapon good (which drives the drawn look + the Broń row) is derived from `jobType`
   *  via {@link weaponEquipmentFor}, so it can't drift from the scene/map spawns. */
  readonly weaponTypeId?: number;
}

/** The per-spawn knobs the palette applies to every unit it drops (a resource ignores them). */
export interface UnitSpawnOptions {
  /** The player that owns the spawned unit (a slot in `[0, MAX_PLAYERS)`). */
  readonly player: number;
  /** The spawned unit's hitpoint pool; `<= 0` defers to the sim's default pool (every settler
   *  carries `Health` — `DEFAULT_SETTLER_HITPOINTS`). */
  readonly hitpoints: number;
  /** The worn armor class (1..4); `<= 0` spawns unarmored. */
  readonly armorClass: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Build the `spawnSettler` command for a unit preset at a tile — the pure command mapping the palette
 * enqueues (extracted so it is unit-testable without the DOM). HP/armor/weapon are optional stamps: a
 * non-positive `hitpoints` is omitted (the sim then applies its default pool — every settler carries
 * `Health`), a non-positive `armorClass` and a civilian's absent weapon are omitted likewise.
 */
export function unitSpawnCommand(preset: UnitPreset, opts: UnitSpawnOptions): Command {
  // The class weapon also goes in the equipment slot (derived from the job, shared with the scene/map
  // spawns), which drives the drawn look + fills the Broń row. The bare-handed warrior gets none → empty
  // slot → unarmed body.
  const equipment = weaponEquipmentFor(preset.jobType);
  return {
    kind: 'spawnSettler',
    jobType: preset.jobType,
    x: opts.x,
    y: opts.y,
    tribe: PRIMARY_TRIBE,
    owner: opts.player,
    ...(opts.hitpoints > 0 ? { hitpoints: opts.hitpoints } : {}),
    ...(preset.weaponTypeId !== undefined ? { weaponTypeId: preset.weaponTypeId } : {}),
    ...(opts.armorClass > 0 ? { armorClass: opts.armorClass } : {}),
    ...(equipment !== undefined ? { equipment } : {}),
  };
}

/** The soldier classes, each paired with its own weapon so the drawn body + attack animation match the
 *  weapon (the same job↔weapon pairing the combat scene uses). A warrior is one profession — the weapon
 *  in hand decides its look — so the bare-handed warrior (fists) leads, then each armed variant. */
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

/** The civilian units: an idle townsperson, a carrier, and the collector (the one outdoor gatherer trade
 *  — every gathered good is worked by the same collector, so one preset, not one per good). */
export const CIVILIAN_PRESETS: readonly UnitPreset[] = [
  { id: 'civilian', jobType: JOB_IDLE },
  { id: 'carrier', jobType: JOB_CARRIER },
  { id: 'collector', jobType: JOB_COLLECTOR },
];

/** One spawnable resource node: its good + a short material label (the gatherer label without the
 *  "Zbieracz (…)" wrapper). */
export interface ResourceEntry {
  readonly good: number;
  readonly id: string;
}

/** The resource nodes the palette can drop — every gatherable good (wood tree, ore/clay/stone deposits,
 *  mushrooms). Each becomes a `placeResource` command via {@link resourceCommand}. */
export const RESOURCE_ENTRIES: readonly ResourceEntry[] = GATHERERS.map((g) => ({
  good: g.good,
  id: g.id,
}));

/** One droppable good: its `dropGood` goodType + a short label. */
export interface GoodEntry {
  readonly good: number;
  readonly id: string;
}

/** The core economy goods' Polish labels (the gathered set + plank + coin), paired with their sandbox
 *  typeIds — the extended catalog carries its own English `name`. */
const CORE_GOOD_ENTRIES: readonly GoodEntry[] = [
  { good: GOOD_WOOD, id: 'wood' },
  { good: GOOD_PLANK, id: 'plank' },
  { good: GOOD_COIN, id: 'coin' },
  { good: GOOD_STONE, id: 'stone' },
  { good: GOOD_MUD, id: 'mud' },
  { good: GOOD_IRON, id: 'iron' },
  { good: GOOD_GOLD, id: 'gold' },
  { good: GOOD_MUSHROOM, id: 'mushroom' },
];

/** Every good the catalog defines — the core economy goods followed by the whole extended catalog — each
 *  droppable on the ground as a loose pile via {@link goodDropCommand} (the admin "spawn any good" list). */
export const GOODS_ENTRIES: readonly GoodEntry[] = [
  ...CORE_GOOD_ENTRIES,
  ...EXTENDED_GOODS.map((g) => ({ good: g.typeId, id: g.id })),
];

/** Units dropped per admin click — one, like the in-game goods tool: each click adds a single unit and the
 *  sim stacks repeat clicks on the same tile up to its ground-stack cap, so the pile grows one at a time. */
export const ADMIN_DROP_AMOUNT = 1;

/** Build the `dropGood` command for a good at a tile — the pure command the admin palette enqueues. */
export function goodDropCommand(good: number, x: number, y: number): Command {
  return { kind: 'dropGood', good, x, y, amount: ADMIN_DROP_AMOUNT };
}

/** The armour tiers the palette applies to a spawned unit — 0 (unarmoured) plus the `[armortype]`
 *  classes 1..4 that `spawnSettler` mitigates an incoming hit by. */
export const ARMOR_CLASSES = [0, 1, 2, 3, 4] as const;

/**
 * Approximate CSS colours for the player swatches, slot order = player id — a rough stand-in for the
 * real team-colour LUT (`render`'s 256×16 player palette) purely so the swatch reads at a glance; the
 * actual spawned unit is recoloured by the LUT, not by these hexes. Names come from the shared
 * {@link PLAYER_COLOR_NAMES} so the slot order can't drift from the LUT.
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

/** The player selector swatches: the first N player slots for which an approximate swatch colour is
 *  authored (the sim itself supports up to `MAX_PLAYERS`). Each carries the player id and its CSS fill. */
export const PLAYER_SWATCHES: readonly PlayerSwatch[] = PLAYER_SWATCH_CSS.map((css, player) => ({
  player,
  css,
}));
