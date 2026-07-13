export { ctxOf } from '../../fixtures/context.js';

import { Position, Settler } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { type Fixed, fx, type Simulation } from '../../../src/index.js';

const VIKING = 1;
const WOODCUTTER = 1;

/** Spawn a settler with the given starting hunger. */
export function settlerWithHunger(sim: Simulation, hunger: Fixed): Entity {
  const entity = sim.world.create();
  sim.world.add(entity, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(entity, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger,
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  return entity;
}
