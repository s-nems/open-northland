import type { Simulation } from '@open-northland/sim';
import { fogModeParam } from './fog.js';
import { progressionOverride } from './progression.js';

/** The world rules a URL flag reshapes; null keeps whatever the world set for itself. */
export interface SessionRuleOverrides {
  readonly fog: number | null;
  readonly progression: boolean | null;
}

export function sessionRuleOverrides(params: URLSearchParams): SessionRuleOverrides {
  return { fog: fogModeParam(params), progression: progressionOverride(params) };
}

/**
 * Apply the overrides to a freshly built sim. The queue is FIFO and these land after the world's own
 * rules, so a flag wins in either direction; an absent flag enqueues nothing, keeping the command
 * stream byte-identical.
 */
export function applySessionRuleOverrides(sim: Simulation, overrides: SessionRuleOverrides): void {
  if (overrides.fog !== null) sim.enqueue({ kind: 'setFogMode', mode: overrides.fog });
  if (overrides.progression !== null) {
    sim.enqueue({ kind: 'setProfessionProgression', enabled: overrides.progression });
  }
}
