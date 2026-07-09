import type { Command } from '@vinland/sim';
import { PLAYER_COLOR_NAMES } from '../../catalog/roster.js';
import { PRIMARY_TRIBE } from '../../game/rules.js';
import {
  GATHERERS,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_CARRIER,
  JOB_IDLE,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  WEAPON_BROADSWORD,
  WEAPON_LONG_BOW,
  WEAPON_SHORT_BOW,
  WEAPON_SPEAR,
  WEAPON_SWORD,
} from '../../game/sandbox/ids.js';

/**
 * The DATA the admin/debug spawn palette offers — unit presets, resource entries and the player
 * (team-colour) swatches — kept apart from the panel wiring ({@link import('./index.js')}) so the catalog
 * of "what can I spawn" is one obvious table. Everything is driven off the shared sandbox ids/{@link
 * GATHERERS} table (never bare numbers), so a new soldier class or gatherer shows up here for free.
 */

/** One spawnable unit: its `spawnSettler` job + (for a warrior) the weapon it wields. */
export interface UnitPreset {
  readonly id: string;
  readonly label: string;
  readonly jobType: number;
  /** A combatant's wielded weapon (a warrior); omitted for a civilian (no weapon). */
  readonly weaponTypeId?: number;
}

/** The per-spawn knobs the palette applies to every unit it drops (a resource ignores them). */
export interface UnitSpawnOptions {
  /** The player that owns the spawned unit (a slot in `[0, MAX_PLAYERS)`). */
  readonly player: number;
  /** The combatant hitpoint pool; `<= 0` spawns a non-combatant (no `Health`). */
  readonly hitpoints: number;
  /** The worn armor class (1..4); `<= 0` spawns unarmored. */
  readonly armorClass: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Build the `spawnSettler` command for a unit preset at a tile — the pure command mapping the palette
 * enqueues (extracted so it is unit-testable without the DOM). HP/armor/weapon are the separate-optional
 * stamps the command supports: a non-positive `hitpoints`/`armorClass` and a civilian's absent weapon are
 * simply omitted, so a civilian spawns as the plain non-combatant it is.
 */
export function unitSpawnCommand(preset: UnitPreset, opts: UnitSpawnOptions): Command {
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
  };
}

/** The five soldier classes, each paired with its own weapon so the drawn body + attack animation
 *  match the weapon (the same job↔weapon pairing the combat scene uses). */
export const WARRIOR_PRESETS: readonly UnitPreset[] = [
  { id: 'spear', label: 'Włócznik', jobType: JOB_SOLDIER_SPEAR, weaponTypeId: WEAPON_SPEAR },
  { id: 'sword', label: 'Miecznik', jobType: JOB_SOLDIER_SWORD, weaponTypeId: WEAPON_SWORD },
  {
    id: 'broadsword',
    label: 'Miecznik 2H',
    jobType: JOB_SOLDIER_BROADSWORD,
    weaponTypeId: WEAPON_BROADSWORD,
  },
  { id: 'bow', label: 'Łucznik', jobType: JOB_ARCHER, weaponTypeId: WEAPON_SHORT_BOW },
  { id: 'longbow', label: 'Łucznik (długi łuk)', jobType: JOB_ARCHER_LONG, weaponTypeId: WEAPON_LONG_BOW },
];

/** The civilian units: an idle townsperson, a carrier, and one worker per gatherer profession. */
export const CIVILIAN_PRESETS: readonly UnitPreset[] = [
  { id: 'civilian', label: 'Cywil', jobType: JOB_IDLE },
  { id: 'carrier', label: 'Tragarz', jobType: JOB_CARRIER },
  ...GATHERERS.map((g) => ({ id: `gatherer_${g.id}`, label: g.label, jobType: g.job })),
];

/** One spawnable resource node: its good + a short material label (the gatherer label without the
 *  "Zbieracz (…)" wrapper). */
export interface ResourceEntry {
  readonly good: number;
  readonly label: string;
}

/** Strip the gatherer wrapper ("Zbieracz (Drewno)" → "Drewno") to the bare material name. */
function materialLabel(gathererLabel: string): string {
  return gathererLabel.replace(/^Zbieracz \((.+)\)$/, '$1');
}

/** The resource nodes the palette can drop — every gatherable good (wood tree, ore/clay/stone deposits,
 *  mushrooms). Each becomes a `placeResource` command via {@link resourceCommand}. */
export const RESOURCE_ENTRIES: readonly ResourceEntry[] = GATHERERS.map((g) => ({
  good: g.good,
  label: materialLabel(g.label),
}));

/** The armour tiers the palette applies to a spawned unit — 0 (unarmoured) plus the `[armortype]`
 *  classes 1..4 that `spawnSettler` mitigates an incoming hit by. */
export const ARMOR_CLASSES: readonly { readonly value: number; readonly label: string }[] = [
  { value: 0, label: 'Brak' },
  { value: 1, label: 'Klasa 1' },
  { value: 2, label: 'Klasa 2' },
  { value: 3, label: 'Klasa 3' },
  { value: 4, label: 'Klasa 4' },
];

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
  readonly name: string;
  readonly css: string;
}

/** The player selector swatches: the first N player slots for which an approximate swatch colour is
 *  authored (the sim itself supports up to `MAX_PLAYERS`). Each carries id, LUT colour name, and CSS fill. */
export const PLAYER_SWATCHES: readonly PlayerSwatch[] = PLAYER_SWATCH_CSS.map((css, player) => ({
  player,
  name: PLAYER_COLOR_NAMES[player] ?? `gracz ${player}`,
  css,
}));

/** How many player slots the palette exposes — derived from the authored swatch colours (no drift). */
export const PLAYER_COUNT = PLAYER_SWATCHES.length;
