import { beforeEach } from 'vitest';
import { Carrying, CurrentAtomic, Resource, Settler } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, type Simulation } from '../../../src/index.js';
import type { SystemContext } from '../../../src/systems/index.js';

/**
 * ProgressionSystem (XP-accrual half) — completing a work atomic trains a settler's `(job, good)`
 * specialization. The fixture's woodcutter (job 1) has a wood-specific track (typeId 1, good 1,
 * `experienceFactor` 10) and a general track (typeId 2, no good, factor 1); XP is keyed by the
 * track's typeId on `Settler.experience`. Goods: 1 = wood; the wood harvest atomic is 24.
 */

export const WOODCUTTER = 1;
export const WOOD = 1;
export const WOOD_TRACK = 1; // fixture jobExperience typeId for "woodcutter wood"
export const GENERAL_TRACK = 2; // fixture jobExperience typeId for "woodcutter general"

beforeEach(() => {
  CurrentAtomic.store.clear();
  Carrying.store.clear();
  Settler.store.clear();
  Resource.store.clear();
});

export function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

export function makeSettler(sim: Simulation, jobType: number | null): Entity {
  const e = sim.world.create();
  sim.world.add(e, Settler, {
    tribe: 1,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  return e;
}
