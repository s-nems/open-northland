import { beforeEach } from 'vitest';
import { Owner, Position, Resource, Settler } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, fx, halfCellMapFromCells, Simulation, type TerrainMap } from '../../../src/index.js';
import { testContent } from '../../fixtures/content.js';
import { clearComponentStores } from '../../fixtures/stores.js';

/**
 * Tests for the PLAYER-order commands (`moveUnit` / `setJob`) and the PlayerOrder timed-override system
 * — the RTS "select a unit and tell it where to go / what to be". A move order is a SOFT, TIMED
 * override: the unit walks to the spot, stands a while (short for a worker, long for a soldier), then
 * the economy AI reclaims it; needs can pull it away sooner. The fixture matches atomic-planner.test.ts:
 * good 1 = wood (harvest atomic 24), job 1 = woodcutter, tribe 1 = viking.
 */

export const GRASS = 0;
export const WOOD = 1;
export const WOODCUTTER = 1;
export const CARPENTER = 2;
export const VIKING = 1;
export const HEADQUARTERS = 1;
export const HARVEST_ATOMIC = 24;
export const HUMAN_PLAYER = 0;

beforeEach(clearComponentStores);

/** An all-grass CELL-resolution strip, upsampled to the 2W×2H half-cell navigation lattice. */
export function grassMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

export function sim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 4) });
}

/** Order `entity` to visual tile (x, y) — moveUnit coords are half-cell nodes, so anchor-convert. */
export function orderMove(s: Simulation, entity: Entity, x: number, y: number): void {
  const n = cellAnchorNode(x, y);
  s.enqueue({ kind: 'moveUnit', entity, x: n.hx, y: n.hy });
}

/** An OWNED viking woodcutter (the player's to command) placed directly on the world. */
export function ownedWoodcutter(s: Simulation, x: number, y: number, player = HUMAN_PLAYER): Entity {
  const e = s.world.create();
  s.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  s.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  s.world.add(e, Owner, { player });
  return e;
}

export function woodAt(s: Simulation, x: number, y: number, remaining = 5): Entity {
  const e = s.world.create();
  s.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  s.world.add(e, Resource, { goodType: WOOD, remaining, harvestAtomic: HARVEST_ATOMIC });
  return e;
}
