import { grassCellMap as grassMap } from '../../fixtures/terrain.js';

export { grassMap };

import { Health, Owner, Position, Settler, Stance } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, type Simulation } from '../../../src/index.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';

export const WOOD = 1;
export const HARVEST_ATOMIC = 24;
export const VIKING = 1;
export const FRANK = 2;
export const BEAR = 10;
export const WOODCUTTER = 1;
export const P0 = 0;
export const P1 = 1;

export { ctxOf } from '../../fixtures/context.js';

/** A combatant; an owner also receives the ATTACK stance these direct fixtures need. */
export function fighterAt(
  sim: Simulation,
  x: number,
  y: number,
  tribe: number,
  jobType: number | null,
  opts: { hitpoints?: number; owner?: number } = {},
): Entity {
  const entity = sim.world.create();
  sim.world.add(entity, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(entity, Settler, {
    tribe,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(entity, Health, {
    hitpoints: opts.hitpoints ?? 1000,
    max: opts.hitpoints ?? 1000,
  });
  if (opts.owner !== undefined) {
    sim.world.add(entity, Owner, { player: opts.owner });
    sim.world.add(entity, Stance, { mode: MILITARY_MODE.ATTACK, anchorCell: null });
  }
  return entity;
}
