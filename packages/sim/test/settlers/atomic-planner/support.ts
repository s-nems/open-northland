export { ctxOf } from '../../fixtures/context.js';

import { grassCellMap as grassMap } from '../../fixtures/terrain.js';

export { grassMap };

import { Building, Position, Resource, Settler, Stockpile } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, fx, ONE, type Simulation } from '../../../src/index.js';

export const WOOD = 1;
const WOODCUTTER = 1;
export const VIKING = 1;
const HEADQUARTERS = 1;
export const HARVEST_ATOMIC = 24;

export function anchorCell(sim: Simulation, x: number, y: number): number {
  const node = cellAnchorNode(x, y);
  return sim.terrain?.nodeAt(node.hx, node.hy) as number;
}

export function woodcutterAt(sim: Simulation, x: number, y: number): Entity {
  const entity = sim.world.create();
  sim.world.add(entity, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(entity, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  return entity;
}

export function woodAt(sim: Simulation, x: number, y: number, remaining = 5): Entity {
  const entity = sim.world.create();
  sim.world.add(entity, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(entity, Resource, { goodType: WOOD, remaining, harvestAtomic: HARVEST_ATOMIC });
  return entity;
}

export function storeAt(sim: Simulation, x: number, y: number): Entity {
  const entity = sim.world.create();
  sim.world.add(entity, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(entity, Building, {
    buildingType: HEADQUARTERS,
    tribe: VIKING,
    built: ONE,
    level: 0,
  });
  sim.world.add(entity, Stockpile, { amounts: new Map() });
  return entity;
}
