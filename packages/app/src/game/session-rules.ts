import type { SessionRules } from '@open-northland/lockstep';
import type { Simulation } from '@open-northland/sim';
import { fogModeParam } from './fog.js';

/** Parse an `on`/`off` rule URL flag; null for absent or unrecognized, which keeps the world's rule. */
export function onOffParam(params: URLSearchParams, name: string): boolean | null {
  const value = params.get(name);
  if (value === 'on') return true;
  if (value === 'off') return false;
  return null;
}

/** The `?fog=`, `?progression=` and `?needs=` flags as the session's rule overrides. */
export function sessionRuleOverrides(params: URLSearchParams): SessionRules & { readonly missions: boolean | null } {
  return {
    fog: fogModeParam(params),
    progression: onOffParam(params, 'progression'),
    needs: onOffParam(params, 'needs'),
    missions: onOffParam(params, 'missions'),
  };
}

/**
 * Apply the overrides to a freshly built sim. The queue is FIFO and these land after the world's own
 * rules, so a flag wins in either direction; an absent flag enqueues nothing, keeping the command
 * stream byte-identical.
 */
export function applySessionRuleOverrides(sim: Simulation, overrides: SessionRules): void {
  if (overrides.fog !== null) sim.enqueueSetup({ kind: 'setFogMode', mode: overrides.fog });
  if (overrides.progression !== null) {
    sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: overrides.progression });
  }
  if (overrides.needs !== null) sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: overrides.needs });
  if (overrides.missions !== null) {
    sim.enqueueSetup({ kind: 'setMissionsEnabled', enabled: overrides.missions });
  }
}
