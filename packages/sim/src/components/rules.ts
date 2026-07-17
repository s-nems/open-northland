import { type Component, defineComponent, type Entity, type World } from '../ecs/world.js';

/** The lowest-id carrier of a world-scope singleton `component`, or null when none exists. The canonical pick
 *  (ascending id wins) shared by the {@link WorldRules} and {@link FogRules} singletons: their command handlers
 *  only ever create one, but the tie-break keeps hashed state deterministic should more than one ever appear. */
function singletonCarrier(world: World, component: Component<unknown>): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(component)) {
    if (best === null || e < best) best = e;
  }
  return best;
}

/**
 * The world-rules singleton — global gameplay toggles that are part of simulated, hashed state (they change
 * behavior, so they must hash and replay like any component; a plain `Simulation` field would escape both). At
 * most one entity carries it: the `setNeedsEnabled` command creates it on first use and mutates it thereafter.
 * An absent singleton means every rule sits at its default, so a command stream that never touches a rule
 * leaves the world's entity set (and its golden hash) untouched.
 */
export const WorldRules = defineComponent<{
  /** Whether the needs mechanic runs (hunger/fatigue/piety/enjoyment rise + starvation). Default true. A
   *  dev/admin lever (user decision): acceptance scenes run with needs off by default so test units don't
   *  starve mid-checklist; live maps keep them on. */
  needsEnabled: boolean;
}>('WorldRules');

/** The rules singleton's entity, or null when no rule was ever set. Canonical: the lowest-id carrier wins
 *  should more than one ever exist (the command handler only ever creates one). */
export function worldRulesEntity(world: World): Entity | null {
  return singletonCarrier(world, WorldRules);
}

/** Whether the needs mechanic is on — the {@link WorldRules} value, defaulting to true when the singleton is
 *  absent (a world that never toggled it behaves as before). */
export function needsEnabled(world: World): boolean {
  const e = worldRulesEntity(world);
  return e === null ? true : world.get(e, WorldRules).needsEnabled;
}

/** Set the {@link WorldRules} singleton, creating it on first use and mutating it thereafter — the
 *  `setNeedsEnabled` command's whole body. Idempotent re-sends just overwrite. */
export function setNeedsEnabled(world: World, enabled: boolean): void {
  const rules = worldRulesEntity(world);
  if (rules === null) world.add(world.create(), WorldRules, { needsEnabled: enabled });
  else world.get(rules, WorldRules).needsEnabled = enabled;
}

/**
 * The fog-of-war modes the `setFogMode` command selects between. Our design (no readable fog source — the
 * original's exploration behaviour is observed, the grey layer is a deliberate modern addition):
 *
 *  - **OFF** — no fog at all: everything visible, zero per-tick cost. The default (an untouched world keeps its
 *    hash).
 *  - **REVEAL** — the original's behaviour (observed): the map starts unexplored (black) and anything a
 *    unit/building ever sees becomes — and stays — fully visible.
 *  - **RECON** — the terrain-known mode (user decision): terrain is known from the start (the whole map renders
 *    as explored/grey), current vision is fully visible, and an area out of every eye's reach falls back to grey
 *    (terrain only, no entities).
 */
export const FOG_MODE = {
  OFF: 0,
  REVEAL: 1,
  RECON: 2,
} as const;

/** Whether `mode` is one of the three {@link FOG_MODE} ids — the `setFogMode` validity gate (a bad
 *  mode is a recoverable bad input, skipped-but-logged like a bad `setStance` mode). */
export function isFogMode(mode: number): boolean {
  return mode === FOG_MODE.OFF || mode === FOG_MODE.REVEAL || mode === FOG_MODE.RECON;
}

/**
 * The fog-of-war rules singleton — the {@link FOG_MODE} the VisionSystem runs under. A separate singleton
 * beside {@link WorldRules} (not a field on it) so a command stream that never touches fog leaves the
 * needs-rules value shape — and every existing golden hash — untouched; like `WorldRules`, at most one entity
 * carries it (the `setFogMode` command creates it on first use). The masks the mode drives live outside the ECS
 * (`Simulation.fog`, a world resource like the terrain graph — a dense per-player byte grid would be
 * pathological to clone per snapshot); they are still covered by `hashState`, which mixes the raw mask bytes in
 * after the components.
 */
export const FogRules = defineComponent<{ mode: number }>('FogRules');

/** The fog-rules singleton's entity, or null when the mode was never set. Canonical: lowest id wins
 *  (the command handler only ever creates one — the {@link worldRulesEntity} convention). */
export function fogRulesEntity(world: World): Entity | null {
  return singletonCarrier(world, FogRules);
}

/** The active fog mode — the {@link FogRules} value, defaulting to {@link FOG_MODE.OFF} when the
 *  singleton is absent (a world that never set a mode has no fog, exactly as before the feature). */
export function fogMode(world: World): number {
  const e = fogRulesEntity(world);
  return e === null ? FOG_MODE.OFF : world.get(e, FogRules).mode;
}

/** Set the {@link FogRules} singleton (the {@link setNeedsEnabled} pattern) — the `setFogMode` command's
 *  whole body. A mode outside the three {@link FOG_MODE} ids is skipped. The VisionSystem sees the new mode
 *  the same tick (it runs after commandSystem) and rebuilds the masks off-cadence. */
export function setFogMode(world: World, mode: number): void {
  if (!isFogMode(mode)) return;
  const rules = fogRulesEntity(world);
  if (rules === null) world.add(world.create(), FogRules, { mode });
  else world.get(rules, FogRules).mode = mode;
}

/**
 * The signpost-navigation rules singleton — whether civilian settlers are confined to the signpost
 * work-area network (`systems/signposts/`). A separate singleton beside {@link WorldRules}/{@link FogRules}
 * for the same reason those are separate: a command stream that never touches it leaves every existing
 * golden hash untouched. Default OFF — the original always confines, but our maps/scenes opt in via the
 * `setSignpostNavigation` command (a named deviation: existing scenes and goldens predate signposts).
 */
export const SignpostRules = defineComponent<{ navigationEnabled: boolean }>('SignpostRules');

/** The signpost-rules singleton's entity, or null when never set (lowest id wins — the
 *  {@link worldRulesEntity} convention). */
export function signpostRulesEntity(world: World): Entity | null {
  return singletonCarrier(world, SignpostRules);
}

/** Whether signpost navigation confinement is on — defaults to false when the singleton is absent. */
export function signpostNavigationEnabled(world: World): boolean {
  const e = signpostRulesEntity(world);
  return e === null ? false : world.get(e, SignpostRules).navigationEnabled;
}

/** Set the {@link SignpostRules} singleton (the {@link setNeedsEnabled} pattern) — the
 *  `setSignpostNavigation` command's whole body. */
export function setSignpostNavigation(world: World, enabled: boolean): void {
  const rules = signpostRulesEntity(world);
  if (rules === null) world.add(world.create(), SignpostRules, { navigationEnabled: enabled });
  else world.get(rules, SignpostRules).navigationEnabled = enabled;
}
