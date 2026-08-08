import { type Component, defineComponent, type Entity, type World } from '../ecs/world.js';
import { isValidPlayer, MAX_PLAYERS } from './ownership.js';

/** The lowest-id carrier of a world-scope singleton `component`, or null when none exists. Ascending id
 *  wins, so hashed state stays deterministic should a command handler ever leave more than one carrier. */
function singletonCarrier(world: World, component: Component<unknown>): Entity | null {
  return world.lowestEntityWith(component);
}

/**
 * The world-rules singleton - global gameplay toggles that are part of simulated, hashed state, which a
 * plain `Simulation` field would escape. At most one entity carries it, created on first use; an absent
 * singleton means every rule sits at its default, so a command stream that never touches a rule leaves the
 * world's entity set and hash untouched.
 */
export const WorldRules = defineComponent<{
  /** Whether the needs mechanic runs: the hunger, fatigue and enjoyment rise, the per-swing combat need
   *  cost, the forge's piety charge, and starvation. Default true. */
  needsEnabled: boolean;
}>('WorldRules');

export function worldRulesEntity(world: World): Entity | null {
  return singletonCarrier(world, WorldRules);
}

export function needsEnabled(world: World): boolean {
  const e = worldRulesEntity(world);
  return e === null ? true : world.get(e, WorldRules).needsEnabled;
}

export function setNeedsEnabled(world: World, enabled: boolean): void {
  const rules = worldRulesEntity(world);
  if (rules === null) world.add(world.create(), WorldRules, { needsEnabled: enabled });
  else world.mut(rules, WorldRules).needsEnabled = enabled;
}

/**
 * The fog-of-war modes the `setFogMode` command selects between. No readable fog source exists:
 *
 *  - OFF - no fog at all: everything visible, zero per-tick cost. The default.
 *  - REVEAL - observation: the map starts unexplored and anything ever seen stays fully visible.
 *  - RECON - authored: terrain is known from the start, current vision is fully visible, and ground out of
 *    every eye's reach falls back to grey terrain with no entities.
 */
export const FOG_MODE = {
  OFF: 0,
  REVEAL: 1,
  RECON: 2,
} as const;

export type FogMode = (typeof FOG_MODE)[keyof typeof FOG_MODE];

/** The `setFogMode` validity gate: a bad mode is a recoverable bad input, skipped rather than thrown. */
export function isFogMode(mode: number): mode is FogMode {
  return mode === FOG_MODE.OFF || mode === FOG_MODE.REVEAL || mode === FOG_MODE.RECON;
}

/**
 * The fog-of-war rules singleton - the {@link FOG_MODE} the VisionSystem runs under, kept apart from
 * {@link WorldRules} so a command stream that never touches fog leaves that value shape untouched. The
 * masks the mode drives live outside the ECS, in `Simulation.fog`, which `hashState` mixes in too.
 */
export const FogRules = defineComponent<{ mode: FogMode }>('FogRules');

export function fogRulesEntity(world: World): Entity | null {
  return singletonCarrier(world, FogRules);
}

export function fogMode(world: World): FogMode {
  const e = fogRulesEntity(world);
  return e === null ? FOG_MODE.OFF : world.get(e, FogRules).mode;
}

export function setFogMode(world: World, mode: number): void {
  if (!isFogMode(mode)) return;
  const rules = fogRulesEntity(world);
  if (rules === null) world.add(world.create(), FogRules, { mode });
  else world.mut(rules, FogRules).mode = mode;
}

/**
 * The signpost-navigation rules singleton - whether civilian settlers are confined to the signpost
 * work-area network (`systems/signposts/`). Default off, an approximation: the original always confines,
 * but maps and scenes here opt in through the `setSignpostNavigation` command.
 */
export const SignpostRules = defineComponent<{ navigationEnabled: boolean }>('SignpostRules');

export function signpostRulesEntity(world: World): Entity | null {
  return singletonCarrier(world, SignpostRules);
}

export function signpostNavigationEnabled(world: World): boolean {
  const e = signpostRulesEntity(world);
  return e === null ? false : world.get(e, SignpostRules).navigationEnabled;
}

export function setSignpostNavigation(world: World, enabled: boolean): void {
  const rules = signpostRulesEntity(world);
  if (rules === null) world.add(world.create(), SignpostRules, { navigationEnabled: enabled });
  else world.mut(rules, SignpostRules).navigationEnabled = enabled;
}

/**
 * The profession-progression rules singleton - whether the experience tech tree gates who may work what.
 * While disabled the `needfor*` XP thresholds and the `jobEnables` presence graph stop gating civilian jobs
 * and goods; fighter-band jobs stay gated regardless, reserved for barracks training, and XP keeps accruing
 * either way. Default on - the original always gates.
 */
export const ProgressionRules = defineComponent<{ professionProgressionEnabled: boolean }>(
  'ProgressionRules',
);

export function progressionRulesEntity(world: World): Entity | null {
  return singletonCarrier(world, ProgressionRules);
}

export function professionProgressionEnabled(world: World): boolean {
  const e = progressionRulesEntity(world);
  return e === null ? true : world.get(e, ProgressionRules).professionProgressionEnabled;
}

export function setProfessionProgression(world: World, enabled: boolean): void {
  const rules = progressionRulesEntity(world);
  if (rules === null) world.add(world.create(), ProgressionRules, { professionProgressionEnabled: enabled });
  else world.mut(rules, ProgressionRules).professionProgressionEnabled = enabled;
}

/** A directed player-to-player stance, the values map `diplomacy <from> <to> <state>` rows author. */
export type DiplomacyState = 'friend' | 'neutral' | 'enemy';

/** The `setDiplomacy` validity gate: an unknown state string is a recoverable bad input, skipped. */
export function isDiplomacyState(state: string): state is DiplomacyState {
  return state === 'friend' || state === 'neutral' || state === 'enemy';
}

/**
 * The diplomacy rules singleton - the directed stance table combat hostility consults when both sides
 * are player-owned. A pair never set reads `enemy`, so an absent singleton keeps the everyone-hostile
 * default and a command stream that never sets a stance leaves the hash untouched.
 */
export const DiplomacyRules = defineComponent<{
  /** Stances keyed `from * MAX_PLAYERS + to` - directed, so the two directions of a pair can differ. */
  stances: Map<number, DiplomacyState>;
}>('DiplomacyRules');

function stanceKey(from: number, to: number): number {
  return from * MAX_PLAYERS + to;
}

/** The diplomacy-rules singleton's entity, or null when no stance was ever set. */
export function diplomacyRulesEntity(world: World): Entity | null {
  return singletonCarrier(world, DiplomacyRules);
}

/** The directed stance `from` holds toward `to`, defaulting to `enemy` when never set. An invalid
 *  slot also reads `enemy` - the key arithmetic is injective over valid slots only. */
export function diplomacyStance(world: World, from: number, to: number): DiplomacyState {
  if (!isValidPlayer(from) || !isValidPlayer(to)) return 'enemy';
  const e = diplomacyRulesEntity(world);
  if (e === null) return 'enemy';
  return world.get(e, DiplomacyRules).stances.get(stanceKey(from, to)) ?? 'enemy';
}

/** Create the {@link DiplomacyRules} singleton on first use and mutate it thereafter. An invalid player
 *  slot or unknown state is skipped. */
export function setDiplomacyStance(world: World, from: number, to: number, state: string): void {
  if (!isValidPlayer(from) || !isValidPlayer(to) || !isDiplomacyState(state)) return;
  const rules = diplomacyRulesEntity(world);
  if (rules === null) {
    world.add(world.create(), DiplomacyRules, { stances: new Map([[stanceKey(from, to), state]]) });
  } else {
    world.mut(rules, DiplomacyRules).stances.set(stanceKey(from, to), state);
  }
}
