export { ctxOf } from '../../fixtures/context.js';

import { CurrentAtomic } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { type AtomicEffect, fx, type Simulation } from '../../../src/index.js';

/**
 * Unit + integration tests for the AtomicSystem — the executor half of the settler planner. It
 * advances a {@link CurrentAtomic}'s progress to ONE over `duration` ticks, and on completion applies
 * the typed {@link AtomicEffect} (harvest/pickup → Carrying, pileup → Stockpile, eat → hunger),
 * emits an `atomicCompleted` event, and removes the component. The fixture's goods are 1 = wood,
 * 2 = plank; the sawmill (buildingType 2) caps wood at 20.
 */

export const WOOD = 1;
export const PLANK = 2;
export const SAWMILL = 2; // fixture buildingType: wood capacity 20

/** Give an entity a CurrentAtomic with the given effect/duration (progress starts at 0). */
export function startAtomic(
  sim: Simulation,
  e: Entity,
  effect: AtomicEffect,
  duration: number,
  atomicId = 1,
): void {
  sim.world.add(e, CurrentAtomic, {
    atomicId,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration,
    effect,
    targetEntity: null,
    targetTile: null,
  });
}
