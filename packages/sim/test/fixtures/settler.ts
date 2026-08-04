import type { ContentSet } from '@open-northland/data';
import { addPerson, addWildlife, Position, type SettlerState } from '../../src/components/index.js';
import { ZERO } from '../../src/core/fixed.js';
import type { Entity, World } from '../../src/ecs/world.js';
import type { Fixed, Simulation } from '../../src/index.js';
import { isAnimalTribe } from '../../src/systems/index.js';

/** Tribe 1 in the synthetic fixtures - the default settler tribe. */
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
 *
 * Personhood follows the tribe ({@link addSettlerOfTribe}), so a fixture asking for a bear gets a
 * creature and one asking for a viking gets a person, exactly as the two spawn paths do.
 */
export function settlerAt(sim: Simulation, spec: SettlerSpec): Entity {
  const e = sim.world.create();
  if (spec.position !== undefined) {
    sim.world.add(e, Position, { x: spec.position.x, y: spec.position.y });
  }
  addSettlerOfTribe(sim, e, {
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

/**
 * Add a `Settler` whose personhood follows its tribe: `addWildlife` for a tribe with an `[animaltype]`
 * record, `addPerson` otherwise - the fixture stand-in for choosing a spawn path. A fixture that always
 * means a person should call `addPerson` directly.
 *
 * Wildlife takes only its tribe, so a bear asked for in a trade throws rather than silently dropping
 * the rest of `state`: no spawn path produces that shape.
 */
export function addSettlerOfTribe(
  sim: { world: World; content: ContentSet },
  e: Entity,
  state: SettlerState,
): void {
  if (!isAnimalTribe(sim.content, state.tribe)) {
    addPerson(sim.world, e, state);
    return;
  }
  if (state.jobType !== null) {
    throw new Error(`fixture: tribe ${state.tribe} is wildlife, which holds no trade (got ${state.jobType})`);
  }
  addWildlife(sim.world, e, state.tribe);
}
