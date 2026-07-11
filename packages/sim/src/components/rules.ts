import { defineComponent, type Entity, type World } from '../ecs/world.js';

/**
 * The world-rules SINGLETON — global gameplay toggles that are part of simulated, HASHED state (they
 * change behavior, so they must hash and replay like any component; a plain `Simulation` field would
 * escape both). At most one entity carries it: the `setNeedsEnabled` command creates it on first use
 * and mutates it thereafter. An absent singleton means every rule sits at its default — so a command
 * stream that never touches a rule leaves the world's entity set (and its golden hash) untouched, the
 * separate-optional-component pattern at world scope.
 */
export const WorldRules = defineComponent<{
  /** Whether the needs mechanic runs (hunger/fatigue/piety/enjoyment rise + starvation). Default true.
   *  A dev/admin lever (user decision 2026-07-11): acceptance scenes run with needs OFF by default so
   *  test units don't starve mid-checklist; live maps keep them on. */
  needsEnabled: boolean;
}>('WorldRules');

/** The rules singleton's entity, or null when no rule was ever set. Canonical: the LOWEST-id carrier
 *  wins should more than one ever exist (the command handler only ever creates one). */
export function worldRulesEntity(world: World): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(WorldRules)) {
    if (best === null || e < best) best = e;
  }
  return best;
}

/** Whether the needs mechanic is on — the {@link WorldRules} value, defaulting to TRUE when the
 *  singleton is absent (a world that never toggled it behaves as before). */
export function needsEnabled(world: World): boolean {
  const e = worldRulesEntity(world);
  return e === null ? true : world.get(e, WorldRules).needsEnabled;
}

/**
 * The fog-of-war modes the `setFogMode` command selects between. OUR design (no readable fog source —
 * the original's exploration behaviour is observed, the grey layer is a deliberate modern addition):
 *
 *  - **OFF** — no fog at all: everything visible, zero per-tick cost. The DEFAULT (an untouched world
 *    behaves exactly as before this feature — every golden/scene/slice keeps its hash).
 *  - **REVEAL** — the original's behaviour (observed): the map starts unexplored (black) and anything a
 *    unit/building ever sees becomes — and STAYS — fully visible.
 *  - **RECON** — the modern multiplayer courtesy mode (user decision 2026-07-11): terrain is known from
 *    the start (the whole map renders as explored/grey), current vision is fully visible, and an area
 *    out of every eye's reach falls back to grey (terrain only, no entities).
 *  - **FULL** — classic RTS fog (StarCraft-style): starts black, current vision is visible, and seen
 *    ground regresses to explored/grey when no eye covers it.
 */
export const FOG_MODE = {
  OFF: 0,
  REVEAL: 1,
  RECON: 2,
  FULL: 3,
} as const;

/** Whether `mode` is one of the four {@link FOG_MODE} ids — the `setFogMode` validity gate (a bad
 *  mode is a recoverable bad input, skipped-but-logged like a bad `setStance` mode). */
export function isFogMode(mode: number): boolean {
  return (
    mode === FOG_MODE.OFF || mode === FOG_MODE.REVEAL || mode === FOG_MODE.RECON || mode === FOG_MODE.FULL
  );
}

/**
 * The fog-of-war rules SINGLETON — the {@link FOG_MODE} the VisionSystem runs under. A separate
 * singleton beside {@link WorldRules} (not a field on it) so a command stream that never touches fog
 * leaves the needs-rules value shape — and every existing golden hash — untouched; like `WorldRules`,
 * at most one entity carries it (the `setFogMode` command creates it on first use). The MASKS the mode
 * drives live outside the ECS (`Simulation.fog`, a world resource like the terrain graph — a dense
 * per-player byte grid would be pathological to clone per snapshot); they are still covered by
 * `hashState`, which mixes the raw mask bytes in after the components.
 */
export const FogRules = defineComponent<{ mode: number }>('FogRules');

/** The fog-rules singleton's entity, or null when the mode was never set. Canonical: lowest id wins
 *  (the command handler only ever creates one — the {@link worldRulesEntity} convention). */
export function fogRulesEntity(world: World): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(FogRules)) {
    if (best === null || e < best) best = e;
  }
  return best;
}

/** The active fog mode — the {@link FogRules} value, defaulting to {@link FOG_MODE.OFF} when the
 *  singleton is absent (a world that never set a mode has no fog, exactly as before the feature). */
export function fogMode(world: World): number {
  const e = fogRulesEntity(world);
  return e === null ? FOG_MODE.OFF : world.get(e, FogRules).mode;
}
