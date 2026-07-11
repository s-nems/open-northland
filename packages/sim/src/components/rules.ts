import { type Entity, type World, defineComponent } from '../ecs/world.js';

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
