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
/** The wood-track expType keying the fixture's `needforgood PLANK` row. */
export const WOOD_TRACK = 1;
/** Raw XP clearing that row: 30 repeats × the wood track's factor 10. Operators spawn with it earned
 *  so the cycle tests stay about cycles; the gate itself is exercised in craft-selection.cases.ts. */
export const PLANK_GATE_RAW_XP = 300;
/** The seed `spawnSettler` takes to spawn an operator with that gate earned. */
export const PLANK_GATE_EARNED: readonly [number, number][] = [[WOOD_TRACK, PLANK_GATE_RAW_XP]];

/** Spawn a tribe-1 settler of `jobType` at the given tile, optionally pre-seeded with XP. */
export function spawnSettler(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  xp: Iterable<readonly [number, number]> = [],
): Entity {
  const entity = sim.world.create();
  sim.world.add(entity, Settler, {
    tribe: 1,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(xp),
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
  const worker = staffed ? spawnSettler(sim, CARPENTER, 0, 0, PLANK_GATE_EARNED) : null;
  return { mill, worker };
}
