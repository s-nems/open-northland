import { Position, Settler } from '../../src/components/index.js';
import { ZERO } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import type { Fixed, Simulation } from '../../src/index.js';

/** Tribe 1 in the synthetic fixtures — the default settler tribe. */
const VIKING = 1;

/** Per-need overrides; any need left out defaults to `ZERO` (a freshly-spawned, contented settler). */
export interface SettlerNeeds {
  readonly hunger?: Fixed;
  readonly fatigue?: Fixed;
  readonly piety?: Fixed;
  readonly enjoyment?: Fixed;
}

export interface SettlerSpec {
  /** Trade the settler works; `null` for an unassigned settler. */
  readonly jobType: number | null;
  /** Owning tribe; defaults to {@link VIKING}. */
  readonly tribe?: number;
  /** Need levels; each omitted need is `ZERO`. */
  readonly needs?: SettlerNeeds;
  /** Where to place it. Omit to build a Position-less settler (e.g. XP-only progression tests). */
  readonly position?: { readonly x: Fixed; readonly y: Fixed };
}

/**
 * The one Settler factory the direct-fixture tests share: an entity carrying a `Settler` component
 * (needs default to `ZERO`, `experience` empty) and, when a position is given, a `Position`. Folder
 * wrappers layer their extras (Health, Owner, preset needs/job) on top of the entity this returns.
 */
export function settlerAt(sim: Simulation, spec: SettlerSpec): Entity {
  const e = sim.world.create();
  if (spec.position !== undefined) {
    sim.world.add(e, Position, { x: spec.position.x, y: spec.position.y });
  }
  sim.world.add(e, Settler, {
    tribe: spec.tribe ?? VIKING,
    jobType: spec.jobType,
    hunger: spec.needs?.hunger ?? ZERO,
    fatigue: spec.needs?.fatigue ?? ZERO,
    piety: spec.needs?.piety ?? ZERO,
    enjoyment: spec.needs?.enjoyment ?? ZERO,
    experience: new Map(),
  });
  return e;
}
