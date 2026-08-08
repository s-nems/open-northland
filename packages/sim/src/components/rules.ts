import { type Component, defineComponent, type Entity, type World } from '../ecs/world.js';

/** The lowest-id carrier of a world-scope singleton `component`, or null when none exists. Ascending id
 *  wins, so hashed state stays deterministic should a command handler ever leave more than one carrier.
 *  Reads through {@link World.lowestEntityWith}: rules are consulted per candidate in hot gates, and the
 *  no-singleton default must not allocate a query iterator. */
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

/** The rules singleton's entity, or null when no rule was ever set. */
export function worldRulesEntity(world: World): Entity | null {
  return singletonCarrier(world, WorldRules);
}

/** Whether the needs mechanic is on, defaulting to true when the singleton is absent. */
export function needsEnabled(world: World): boolean {
  const e = worldRulesEntity(world);
  return e === null ? true : world.get(e, WorldRules).needsEnabled;
}

/** Create the {@link WorldRules} singleton on first use and mutate it thereafter. */
export function setNeedsEnabled(world: World, enabled: boolean): void {
  const rules = worldRulesEntity(world);
  if (rules === null) world.add(world.create(), WorldRules, { needsEnabled: enabled });
  else world.get(rules, WorldRules).needsEnabled = enabled;
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

/** A fog mode id; {@link isFogMode} is the runtime gate that narrows an incoming command payload to it. */
export type FogMode = (typeof FOG_MODE)[keyof typeof FOG_MODE];

/** The `setFogMode` validity gate: a bad mode is a recoverable bad input, skipped rather than thrown. */
export function isFogMode(mode: number): mode is FogMode {
  return mode === FOG_MODE.OFF || mode === FOG_MODE.REVEAL || mode === FOG_MODE.RECON;
}

/**
 * The fog-of-war rules singleton - the {@link FOG_MODE} the VisionSystem runs under. A separate singleton
 * beside {@link WorldRules} so a command stream that never touches fog leaves that value shape untouched.
 * The masks the mode drives live outside the ECS (`Simulation.fog`, a world resource like the terrain
 * graph); `hashState` still mixes their raw bytes in after the components.
 */
export const FogRules = defineComponent<{ mode: FogMode }>('FogRules');

/** The fog-rules singleton's entity, or null when the mode was never set. */
export function fogRulesEntity(world: World): Entity | null {
  return singletonCarrier(world, FogRules);
}

/** The active fog mode, defaulting to {@link FOG_MODE.OFF} when the singleton is absent. */
export function fogMode(world: World): FogMode {
  const e = fogRulesEntity(world);
  return e === null ? FOG_MODE.OFF : world.get(e, FogRules).mode;
}

/** Create the {@link FogRules} singleton on first use and mutate it thereafter. A mode outside the three
 *  {@link FOG_MODE} ids is skipped. The VisionSystem sees the new mode the same tick. */
export function setFogMode(world: World, mode: number): void {
  if (!isFogMode(mode)) return;
  const rules = fogRulesEntity(world);
  if (rules === null) world.add(world.create(), FogRules, { mode });
  else world.get(rules, FogRules).mode = mode;
}

/**
 * The signpost-navigation rules singleton - whether civilian settlers are confined to the signpost
 * work-area network (`systems/signposts/`). Default OFF, a named deviation: the original always confines,
 * but maps and scenes here opt in through the `setSignpostNavigation` command.
 */
export const SignpostRules = defineComponent<{ navigationEnabled: boolean }>('SignpostRules');

/** The signpost-rules singleton's entity, or null when it was never set. */
export function signpostRulesEntity(world: World): Entity | null {
  return singletonCarrier(world, SignpostRules);
}

/** Whether signpost navigation confinement is on; defaults to false when the singleton is absent. */
export function signpostNavigationEnabled(world: World): boolean {
  const e = signpostRulesEntity(world);
  return e === null ? false : world.get(e, SignpostRules).navigationEnabled;
}

/** Create the {@link SignpostRules} singleton on first use and mutate it thereafter. */
export function setSignpostNavigation(world: World, enabled: boolean): void {
  const rules = signpostRulesEntity(world);
  if (rules === null) world.add(world.create(), SignpostRules, { navigationEnabled: enabled });
  else world.get(rules, SignpostRules).navigationEnabled = enabled;
}

/**
 * The profession-progression rules singleton - whether the experience tech tree gates who may work what.
 * While disabled the `needfor*` XP thresholds and the `jobEnables` presence graph stop gating civilian jobs
 * and goods; fighter-band jobs stay gated regardless, reserved for barracks training, and XP keeps accruing
 * either way. Default ON - the original always gates.
 */
export const ProgressionRules = defineComponent<{ professionProgressionEnabled: boolean }>(
  'ProgressionRules',
);

/** The progression-rules singleton's entity, or null when it was never set. */
export function progressionRulesEntity(world: World): Entity | null {
  return singletonCarrier(world, ProgressionRules);
}

/** Whether profession progression gates job and good access; defaults to true when the singleton is
 *  absent. */
export function professionProgressionEnabled(world: World): boolean {
  const e = progressionRulesEntity(world);
  return e === null ? true : world.get(e, ProgressionRules).professionProgressionEnabled;
}

/** Create the {@link ProgressionRules} singleton on first use and mutate it thereafter. */
export function setProfessionProgression(world: World, enabled: boolean): void {
  const rules = progressionRulesEntity(world);
  if (rules === null) world.add(world.create(), ProgressionRules, { professionProgressionEnabled: enabled });
  else world.get(rules, ProgressionRules).professionProgressionEnabled = enabled;
}
