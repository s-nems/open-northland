export { ctxOf } from '../../fixtures/context.js';

import { Building, Position, Settler, Stockpile } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, type Simulation } from '../../../src/index.js';

export const WOOD = 1;
export const PLANK = 2;
export const SAWMILL = 2;
export const HEADQUARTERS = 1;
export const CARPENTER = 2;
export const CYCLE_TICKS = 20;
export const WOODCUTTER = 1;

/** Spawn a tribe-1 settler of `jobType` at the given tile. */
export function spawnSettler(sim: Simulation, jobType: number, x: number, y: number): Entity {
  const entity = sim.world.create();
  sim.world.add(entity, Settler, {
    tribe: 1,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(entity, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  return entity;
}

/** Build the fixture sawmill with its worker and tech enabler unless explicitly disabled. */
export function sawmill(
  sim: Simulation,
  amounts: Iterable<[number, number]>,
  staffed = true,
  enablerPresent = true,
): { mill: Entity; worker: Entity | null } {
  if (enablerPresent) spawnSettler(sim, WOODCUTTER, 9, 9);
  const mill = sim.world.create();
  sim.world.add(mill, Building, { buildingType: SAWMILL, tribe: 1, built: ONE, level: 0 });
  sim.world.add(mill, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(mill, Stockpile, { amounts: new Map(amounts) });
  const worker = staffed ? spawnSettler(sim, CARPENTER, 0, 0) : null;
  return { mill, worker };
}
