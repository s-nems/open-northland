import type { Simulation } from '@open-northland/sim';
import { fogModeParam } from './fog.js';

/** Parse an `on`/`off` rule URL flag; null for absent or unrecognized, which keeps the world's rule. */
export function onOffParam(params: URLSearchParams, name: string): boolean | null {
  const value = params.get(name);
  if (value === 'on') return true;
  if (value === 'off') return false;
  return null;
}

/** The world rules a URL flag reshapes; null keeps whatever the world set for itself. */
export interface SessionRuleOverrides {
  readonly fog: number | null;
  /** `?progression=` sets `ProgressionRules.professionProgressionEnabled`, which defines its reach. */
  readonly progression: boolean | null;
  /** `?needs=` sets the world's `WorldRules.needsEnabled`, which defines what the rule covers. */
  readonly needs: boolean | null;
}

export function sessionRuleOverrides(params: URLSearchParams): SessionRuleOverrides {
  return {
    fog: fogModeParam(params),
    progression: onOffParam(params, 'progression'),
    needs: onOffParam(params, 'needs'),
  };
}

/**
 * Apply the overrides to a freshly built sim. The queue is FIFO and these land after the world's own
 * rules, so a flag wins in either direction; an absent flag enqueues nothing, keeping the command
 * stream byte-identical.
 */
export function applySessionRuleOverrides(sim: Simulation, overrides: SessionRuleOverrides): void {
  if (overrides.fog !== null) sim.enqueueSetup({ kind: 'setFogMode', mode: overrides.fog });
  if (overrides.progression !== null) {
    sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: overrides.progression });
  }
  if (overrides.needs !== null) sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: overrides.needs });
}
