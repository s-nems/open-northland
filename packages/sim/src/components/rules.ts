import type { World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import { isValidPlayer, MAX_PLAYERS } from './players/ownership.js';

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

const alliedVisionRules = defineWorldSingleton<{ enabled: boolean }>('AlliedVisionRules', 'fog', () => ({
  enabled: false,
}));

/** Whether allies see through one fog mask (`systems/vision/allies.ts`), in every fog mode. Off by
 *  default, a project rule: the original keeps one explored bit per player. */
export const AlliedVisionRules = alliedVisionRules.component;

export function alliedVisionEnabled(world: World): boolean {
  return alliedVisionRules.read(world).enabled;
}

export function setAlliedVision(world: World, enabled: boolean): void {
  alliedVisionRules.write(world, (rules) => {
    rules.enabled = enabled;
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

const bioGroundRules = defineWorldSingleton<{ waived: boolean }>('BioGroundRules', 'players', () => ({
  waived: false,
}));

/** Whether a `buildOnBioPattern` building (well, hive) may stand on any buildable ground instead of only
 *  plantable ground. Off by default; a debug rule, the original always demands the ground. The computer
 *  player's build order still plans those buildings on grass. */
export const BioGroundRules = bioGroundRules.component;

export function bioGroundWaived(world: World): boolean {
  return bioGroundRules.read(world).waived;
}

export function setBioGroundWaived(world: World, waived: boolean): void {
  bioGroundRules.write(world, (rules) => {
    rules.waived = waived;
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
function isDiplomacyState(state: string): state is DiplomacyState {
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

/** A player-slot bitmask naming every slot: players are < {@link MAX_PLAYERS}, which fits one integer. */
export const EVERY_PLAYER = (1 << MAX_PLAYERS) - 1;

/** One world's {@link hostilePlayerMasks} with the stance store generations they were derived at. */
interface HeldHostileMasks {
  readonly masks: readonly number[];
  readonly diplomacy: number;
  readonly diplomacyValues: number;
}
const heldHostileMasks = new WeakMap<World, HeldHostileMasks>();

function hostileMasksCurrent(world: World, held: HeldHostileMasks): boolean {
  return (
    held.diplomacy === world.componentGeneration(DiplomacyRules) &&
    held.diplomacyValues === world.componentValueGeneration(DiplomacyRules)
  );
}

/** Per player slot, the slot bits of the players it holds `enemy` toward or from: the either-way rule a fight
 *  and a body block share. Held per world until a stance generation moves; the registered verifier
 *  re-derives it. */
export function hostilePlayerMasks(world: World): readonly number[] {
  const held = heldHostileMasks.get(world);
  if (held !== undefined && hostileMasksCurrent(world, held)) return held.masks;
  if (held === undefined) {
    world.registerCacheVerifier('hostilePlayerMasks', () => {
      const current = heldHostileMasks.get(world);
      if (current === undefined || !hostileMasksCurrent(world, current)) return [];
      const derived = deriveHostilePlayerMasks(world);
      return current.masks.every((m, p) => m === derived[p]) ? [] : ['hostilePlayerMasks is stale'];
    });
  }
  const masks = deriveHostilePlayerMasks(world);
  heldHostileMasks.set(world, {
    masks,
    diplomacy: world.componentGeneration(DiplomacyRules),
    diplomacyValues: world.componentValueGeneration(DiplomacyRules),
  });
  return masks;
}

function deriveHostilePlayerMasks(world: World): number[] {
  const masks: number[] = [];
  for (let p = 0; p < MAX_PLAYERS; p++) {
    let mask = 0;
    for (let q = 0; q < MAX_PLAYERS; q++) {
      if (q === p) continue;
      if (diplomacyStance(world, p, q) === 'enemy' || diplomacyStance(world, q, p) === 'enemy')
        mask |= 1 << q;
    }
    masks.push(mask);
  }
  return masks;
}

/** The slot bits of the players `player` holds 'enemy' toward: whom it fights, one way. Every slot for
 *  a player outside the slots, whom {@link diplomacyStance} reads as everyone's enemy. */
export function enemyPlayerMask(world: World, player: number): number {
  if (!isValidPlayer(player)) return EVERY_PLAYER;
  let mask = 0;
  for (let q = 0; q < MAX_PLAYERS; q++) {
    if (q !== player && diplomacyStance(world, player, q) === 'enemy') mask |= 1 << q;
  }
  return mask;
}

/** `player`'s entry of {@link hostilePlayerMasks}; every slot for a player outside them, whom
 *  {@link diplomacyStance} reads as everyone's enemy. */
export function hostileMaskOf(masks: readonly number[], player: number): number {
  return isValidPlayer(player) ? (masks[player] ?? EVERY_PLAYER) : EVERY_PLAYER;
}

export function setDiplomacyStance(world: World, from: number, to: number, state: string): void {
  if (!isValidPlayer(from) || !isValidPlayer(to) || !isDiplomacyState(state)) return;
  diplomacyRules.write(world, (rules) => {
    rules.stances.set(stanceKey(from, to), state);
  });
}

const peaceRules = defineWorldSingleton<{
  /** The match tick the peace ends at, kept after it ended. */
  untilTick: number;
  /** The slot bits of the seats the peace binds. */
  players: number;
  /** Whether the peace still holds: cleared at the head of tick {@link untilTick}. */
  holds: boolean;
}>('PeaceRules', 'players', () => ({ untilTick: 0, players: 0, holds: false }));

/**
 * A lobby match's timed peace: while it holds, its member seats cannot harm each other, whatever their
 * diplomacy stances say. The stance table stays untouched, so victory, mission goals and trade read
 * it unchanged; the combat and harm gates read {@link fightsPlayer} and {@link combatHostileMasks}. A
 * project rule: the original has no peace time.
 */
export const PeaceRules = peaceRules.component;

/** Open a peace among `players` until match tick `untilTick`, replacing any earlier one. A deadline not
 *  after `tick` opens none; an invalid slot is dropped. */
export function setPeaceTime(
  world: World,
  tick: number,
  untilTick: number,
  players: readonly number[],
): void {
  let bits = 0;
  for (const p of players) if (isValidPlayer(p)) bits |= 1 << p;
  peaceRules.write(world, (rules) => {
    rules.untilTick = untilTick;
    rules.players = bits;
    rules.holds = untilTick > tick;
  });
}

/** End a holding peace; false when none held. */
export function endPeace(world: World): boolean {
  if (!peaceRules.read(world).holds) return false;
  peaceRules.write(world, (rules) => {
    rules.holds = false;
  });
  return true;
}

/** Whether a peace binds `a` and `b`: it still holds, they are two seats, and both are members. */
export function atPeace(world: World, a: number, b: number): boolean {
  if (a === b) return false;
  return (peacePartnerBits(world, a) & (isValidPlayer(b) ? 1 << b : 0)) !== 0;
}

/** The match tick the holding peace ends at; null with no peace or once it ended. */
export function peaceHoldsUntilTick(world: World): number | null {
  const rules = peaceRules.read(world);
  return rules.holds ? rules.untilTick : null;
}

/** The tick `player`'s peace ends or ended at, kept after the end, so a computer seat ramps its waves
 *  from it; 0, the match start, for a seat outside the peace or a match without one. */
export function seatPeaceEndTick(world: World, player: number): number {
  const rules = peaceRules.read(world);
  return isValidPlayer(player) && (rules.players & (1 << player)) !== 0 ? rules.untilTick : 0;
}

/** The slot bits of the seats a holding peace binds `player` to, itself excluded. */
export function peacePartnerBits(world: World, player: number): number {
  const rules = peaceRules.read(world);
  if (!rules.holds || !isValidPlayer(player)) return 0;
  const self = 1 << player;
  return (rules.players & self) === 0 ? 0 : rules.players & ~self;
}

/** Whether `from` fights `to`: it holds the `enemy` stance toward it and no peace binds them. The player
 *  axis every combat and harm gate reads. */
export function fightsPlayer(world: World, from: number, to: number): boolean {
  return diplomacyStance(world, from, to) === 'enemy' && !atPeace(world, from, to);
}

/** One world's {@link combatHostileMasks}, with the stance and peace store generations it was derived at:
 *  any stance or peace write, or a carrier added or removed, moves one of them. */
interface HeldCombatMasks {
  readonly masks: readonly number[];
  readonly diplomacy: number;
  readonly diplomacyValues: number;
  readonly peace: number;
  readonly peaceValues: number;
}
const heldCombatMasks = new WeakMap<World, HeldCombatMasks>();

function holdsCurrent(world: World, held: HeldCombatMasks): boolean {
  return (
    held.diplomacy === world.componentGeneration(DiplomacyRules) &&
    held.diplomacyValues === world.componentValueGeneration(DiplomacyRules) &&
    held.peace === world.componentGeneration(PeaceRules) &&
    held.peaceValues === world.componentValueGeneration(PeaceRules)
  );
}

function deriveCombatHostileMasks(world: World): number[] {
  const masks = [...hostilePlayerMasks(world)];
  for (let p = 0; p < MAX_PLAYERS; p++) masks[p] = (masks[p] ?? 0) & ~peacePartnerBits(world, p);
  return masks;
}

/** {@link hostilePlayerMasks} without the pairs a peace binds: the either-way rule a fight reads. A body
 *  block keeps the bare masks. Held per world until a stance or peace generation moves; the registered
 *  verifier re-derives it. */
export function combatHostileMasks(world: World): readonly number[] {
  const held = heldCombatMasks.get(world);
  if (held !== undefined && holdsCurrent(world, held)) return held.masks;
  if (held === undefined) {
    world.registerCacheVerifier('combatHostileMasks', () => {
      const current = heldCombatMasks.get(world);
      if (current === undefined || !holdsCurrent(world, current)) return [];
      const derived = deriveCombatHostileMasks(world);
      return current.masks.every((m, p) => m === derived[p]) ? [] : ['combatHostileMasks is stale'];
    });
  }
  const masks = deriveCombatHostileMasks(world);
  heldCombatMasks.set(world, {
    masks,
    diplomacy: world.componentGeneration(DiplomacyRules),
    diplomacyValues: world.componentValueGeneration(DiplomacyRules),
    peace: world.componentGeneration(PeaceRules),
    peaceValues: world.componentValueGeneration(PeaceRules),
  });
  return masks;
}

/** {@link enemyPlayerMask} without the seats a peace binds `player` to: whom it fights, one way. */
export function combatEnemyMask(world: World, player: number): number {
  return enemyPlayerMask(world, player) & ~peacePartnerBits(world, player);
}

const playerContacts = defineWorldSingleton<{
  /** viewer player → bitmask of player slots seen (fits one integer: slots are < {@link MAX_PLAYERS}). */
  met: Map<number, number>;
}>('PlayerContacts', 'players', () => ({ met: new Map() }), { simOnly: true });

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
