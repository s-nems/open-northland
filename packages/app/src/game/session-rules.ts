import type { Simulation } from '@open-northland/sim';
import { fogModeParam } from './fog.js';
import { progressionOverride } from './progression.js';

/** The world rules a URL flag reshapes: `?fog=off|reveal|recon` and `?progression=on|off`. Null keeps
 *  whatever the world set for itself. */
export interface SessionRuleOverrides {
  readonly fog: number | null;
  readonly progression: boolean | null;
}

export function sessionRuleOverrides(params: URLSearchParams): SessionRuleOverrides {
  return { fog: fogModeParam(params), progression: progressionOverride(params) };
}

/**
 * Apply the overrides to a freshly built sim: enqueued after the world's own rules (FIFO - the later
 * write wins), so a flag overrides a scene's mode in either direction. An absent flag enqueues nothing,
 * so an untouched URL keeps the command stream - and any golden derived from it - byte-identical.
 */
export function applySessionRuleOverrides(sim: Simulation, overrides: SessionRuleOverrides): void {
  if (overrides.fog !== null) sim.enqueue({ kind: 'setFogMode', mode: overrides.fog });
  if (overrides.progression !== null) {
    sim.enqueue({ kind: 'setProfessionProgression', enabled: overrides.progression });
  }
}
