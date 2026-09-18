import type { World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import { isValidPlayer, MAX_PLAYERS } from './ownership.js';

const worldRules = defineWorldSingleton<{
  /** Whether the needs mechanic runs: the hunger, fatigue and enjoyment rise, the per-swing combat need
   *  cost, the forge's piety charge, and starvation. */
  needsEnabled: boolean;
}>('WorldRules', 'players', () => ({ needsEnabled: true }));

/** Global gameplay toggles that are part of simulated, hashed state, which a plain `Simulation` field
 *  would escape. */
export const WorldRules = worldRules.component;

export function needsEnabled(world: World): boolean {
  return worldRules.read(world).needsEnabled;
}

export function setNeedsEnabled(world: World, enabled: boolean): void {
  worldRules.write(world, (rules) => {
    rules.needsEnabled = enabled;
  });
}

/**
 * The fog modes the `setFogMode` command selects between: OFF, or the product of the lobby's two
 * settings, the map and fog of war ({@link FogSettings}). No readable fog source exists: CLASSIC is the
 * original's observed behaviour (black start, anything ever seen stays fully visible); the other three
 * are authored.
 */
export const FOG_MODE = {
  /** No fog at all: everything visible, zero per-tick cost. The default. */
  OFF: 0,
  CLASSIC: 1,
  CLASSIC_FOG_OF_WAR: 2,
  RECON: 3,
  RECON_FOG_OF_WAR: 4,
} as const;

export type FogMode = (typeof FOG_MODE)[keyof typeof FOG_MODE];

/** The two settings every mode but OFF is the product of. */
export interface FogSettings {
  /** RECON: the terrain is known from the start as grey ground with no entities. CLASSIC: the map
   *  starts black. */
  readonly terrainKnown: boolean;
  /** Ground out of every eye's reach falls back to grey terrain with no entities; without it,
   *  anything ever seen stays fully visible. */
  readonly fogOfWar: boolean;
}

const FOG_MODE_SETTINGS: Readonly<Record<Exclude<FogMode, typeof FOG_MODE.OFF>, FogSettings>> = {
  [FOG_MODE.CLASSIC]: { terrainKnown: false, fogOfWar: false },
  [FOG_MODE.CLASSIC_FOG_OF_WAR]: { terrainKnown: false, fogOfWar: true },
  [FOG_MODE.RECON]: { terrainKnown: true, fogOfWar: false },
  [FOG_MODE.RECON_FOG_OF_WAR]: { terrainKnown: true, fogOfWar: true },
};

/** The settings `mode` is the product of; null for OFF. */
export function fogSettings(mode: FogMode): FogSettings | null {
  return mode === FOG_MODE.OFF ? null : FOG_MODE_SETTINGS[mode];
}

/** The mode two settings compose. */
export function fogModeOf(settings: FogSettings): FogMode {
  if (settings.terrainKnown) return settings.fogOfWar ? FOG_MODE.RECON_FOG_OF_WAR : FOG_MODE.RECON;
  return settings.fogOfWar ? FOG_MODE.CLASSIC_FOG_OF_WAR : FOG_MODE.CLASSIC;
}

/** The `setFogMode` validity gate: a bad mode is a recoverable bad input, skipped rather than thrown. */
export function isFogMode(mode: number): mode is FogMode {
  return Object.values(FOG_MODE).includes(mode as FogMode);
}

const fogRules = defineWorldSingleton<{ mode: FogMode }>('FogRules', 'fog', () => ({ mode: FOG_MODE.OFF }));

/** The {@link FOG_MODE} the VisionSystem runs under, kept apart from {@link WorldRules} so setting one
 *  rule never materializes the other. The masks the mode drives live outside the ECS, in `Simulation.fog`,
 *  which `hashState` mixes in too. */
export const FogRules = fogRules.component;

export function fogMode(world: World): FogMode {
  return fogRules.read(world).mode;
}

export function setFogMode(world: World, mode: number): void {
  if (!isFogMode(mode)) return;
  fogRules.write(world, (rules) => {
    rules.mode = mode;
  });
}

const signpostRules = defineWorldSingleton<{ navigationEnabled: boolean }>(
  'SignpostRules',
  'players',
  () => ({
    navigationEnabled: false,
  }),
);

/** Whether civilian settlers are confined to the signpost work-area network (`systems/signposts/`). Off by
 *  default, an approximation: the original always confines, but maps and scenes here opt in through the
 *  `setSignpostNavigation` command. */
export const SignpostRules = signpostRules.component;

export function signpostNavigationEnabled(world: World): boolean {
  return signpostRules.read(world).navigationEnabled;
}

export function setSignpostNavigation(world: World, enabled: boolean): void {
  signpostRules.write(world, (rules) => {
    rules.navigationEnabled = enabled;
  });
}

const progressionRules = defineWorldSingleton<{ professionProgressionEnabled: boolean }>(
  'ProgressionRules',
  'players',
  () => ({ professionProgressionEnabled: true }),
);

/**
 * Whether the experience tech tree gates who may work what. While disabled the `needfor*` XP thresholds
 * and the `jobEnables` presence graph stop gating civilian jobs and goods; fighter-band jobs stay gated
 * regardless, reserved for barracks training, and XP keeps accruing either way. The original always gates.
 */
export const ProgressionRules = progressionRules.component;

export function professionProgressionEnabled(world: World): boolean {
  return progressionRules.read(world).professionProgressionEnabled;
}

export function setProfessionProgression(world: World, enabled: boolean): void {
  progressionRules.write(world, (rules) => {
    rules.professionProgressionEnabled = enabled;
  });
}

const missionRules = defineWorldSingleton<{ enabled: boolean }>('MissionRules', 'players', () => ({
  enabled: false,
}));

/**
 * Whether the map's `[MissionData]` script runs (`systems/missions`). Off by default and off in every
 * world that wires no script, so a world without missions keeps the state and hash it had before the
 * mission system existed.
 */
export const MissionRules = missionRules.component;

export function missionsEnabled(world: World): boolean {
  return missionRules.read(world).enabled;
}

export function setMissionsEnabled(world: World, enabled: boolean): void {
  missionRules.write(world, (rules) => {
    rules.enabled = enabled;
  });
}

/** A directed player-to-player stance, the values map `diplomacy <from> <to> <state>` rows author. */
export const DIPLOMACY_STATES = ['friend', 'neutral', 'enemy'] as const;
export type DiplomacyState = (typeof DIPLOMACY_STATES)[number];

/** The `setDiplomacy` validity gate: an unknown state string is a recoverable bad input, skipped. */
export function isDiplomacyState(state: string): state is DiplomacyState {
  return (DIPLOMACY_STATES as readonly string[]).includes(state);
}

const diplomacyRules = defineWorldSingleton<{
  /** Stances keyed `from * MAX_PLAYERS + to` - directed, so the two directions of a pair can differ. */
  stances: Map<number, DiplomacyState>;
}>('DiplomacyRules', 'players', () => ({ stances: new Map() }));

/** The directed stance table combat hostility consults when both sides are player-owned. */
export const DiplomacyRules = diplomacyRules.component;

function stanceKey(from: number, to: number): number {
  return from * MAX_PLAYERS + to;
}

/** The directed stance `from` holds toward `to`. A pair never set reads `enemy`, the everyone-hostile
 *  default. An invalid slot also reads `enemy` - the key arithmetic is injective over valid slots only. */
export function diplomacyStance(world: World, from: number, to: number): DiplomacyState {
  if (!isValidPlayer(from) || !isValidPlayer(to)) return 'enemy';
  return diplomacyRules.read(world).stances.get(stanceKey(from, to)) ?? 'enemy';
}

export function setDiplomacyStance(world: World, from: number, to: number, state: string): void {
  if (!isValidPlayer(from) || !isValidPlayer(to) || !isDiplomacyState(state)) return;
  diplomacyRules.write(world, (rules) => {
    rules.stances.set(stanceKey(from, to), state);
  });
}

const playerContacts = defineWorldSingleton<{
  /** viewer player → bitmask of player slots seen (fits one integer: slots are < {@link MAX_PLAYERS}). */
  met: Map<number, number>;
}>('PlayerContacts', 'players', () => ({ met: new Map() }));

/**
 * Which players each player has ever seen an entity of. The vision system records a contact when an owned
 * entity stands in a cell the viewer's fog reads VISIBLE, and a contact never expires: a nation once met
 * stays known even after fog resets. Approximation: the maps' `noseenfirstmessage` rows prove the original
 * tracks first sighting per pair, but its exact trigger is unobserved.
 */
export const PlayerContacts = playerContacts.component;

/** The slots `viewer` has ever seen an entity of, as a bitmask - the raw table, with no fog-mode rule
 *  applied. Unguarded: an invalid viewer reads 0, since only valid slots are ever recorded. */
export function metContactBits(world: World, viewer: number): number {
  return playerContacts.read(world).met.get(viewer) ?? 0;
}

/** Whether `viewer` ever saw an entity of `other`. A player never holds a contact with itself, and an
 *  invalid slot reads false. */
export function hasMetContact(world: World, viewer: number, other: number): boolean {
  if (!isValidPlayer(viewer) || !isValidPlayer(other)) return false;
  return (metContactBits(world, viewer) & (1 << other)) !== 0;
}

/** Record that `viewer` saw an entity of `other`. A self-contact or an invalid slot is skipped. */
export function recordContact(world: World, viewer: number, other: number): void {
  if (viewer === other || !isValidPlayer(viewer) || !isValidPlayer(other)) return;
  const bits = metContactBits(world, viewer);
  const withOther = bits | (1 << other);
  // Re-recording a held contact is a no-op, kept off the write path so it never dirties the snapshot.
  if (withOther === bits) return;
  playerContacts.write(world, (contacts) => {
    contacts.met.set(viewer, withOther);
  });
}
