import { grassCellMap as grassMap } from '../../fixtures/terrain.js';

export { grassMap };

import { Health, Owner, Position, Settler, Stance } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, halfCellMapFromCells, type Simulation, type TerrainMap } from '../../../src/index.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';

export const WOOD = 1;
export const HARVEST_ATOMIC = 24;
export const VIKING = 1;
export const FRANK = 2;
export const BEAR = 10;
export const WOODCUTTER = 1;
/** The fixture's bow-armed job (`test_spear`, minRange 3, maxRange 17) - the ranged reach these cases need. */
export const HUNTER = 15;
export const P0 = 0;
export const P1 = 1;

const GRASS = 0;
const WATER = 1; // landscape type 1 in the fixture content - unwalkable

export { ctxOf } from '../../fixtures/context.js';

/** A grass map split by a full-height water column at cell x = `wall` - two banks, no crossing. */
export function splitMap(width: number, height: number, wall: number): TerrainMap {
  const typeIds: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) typeIds.push(x === wall ? WATER : GRASS);
  }
  return halfCellMapFromCells({ width, height, typeIds });
}

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
