import { describe, expect, it } from 'vitest';
import { cellAnchorNode, Simulation } from '../../../src/index.js';
import { NO_WALK } from '../../../src/nav/node-circle.js';
import { walkLengthTo } from '../../../src/nav/range-search.js';
import { walkLengthsFrom } from '../../../src/systems/signposts/index.js';
import { testContent } from '../../fixtures/content.js';
import { waterColumnMap } from '../../fixtures/terrain.js';

const CELLS_W = 24;
const CELLS_H = 12;
const RIVER_COLUMN = 12;
/** Grass rows left at the river's foot. */
const FORD_ROWS = 2;
const EAST_CELL = { x: 14, y: 4 };
const WEST_CELL = { x: 10, y: 4 };
const RIVER_CELL = { x: RIVER_COLUMN, y: 4 };
/** Enough for the walk round the river's foot, and too few for it. */
const LONG_WALK = 60;
const SHORT_WALK = 10;

function riverSim(): Simulation {
  return new Simulation({
    seed: 1,
    content: testContent(),
    map: waterColumnMap(CELLS_W, CELLS_H, RIVER_COLUMN, FORD_ROWS),
  });
}

describe('walkLengthsFrom', () => {
  it('counts the steps round a river, and none to a bank the walk is too short for', () => {
    const sim = riverSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const from = cellAnchorNode(EAST_CELL.x, EAST_CELL.y);
    const beside = cellAnchorNode(EAST_CELL.x + 1, EAST_CELL.y);
    const across = cellAnchorNode(WEST_CELL.x, WEST_CELL.y);
    const long = walkLengthsFrom(sim.world, sim.content, terrain, from.hx, from.hy, LONG_WALK);
    const short = walkLengthsFrom(sim.world, sim.content, terrain, from.hx, from.hy, SHORT_WALK);
    if (long === null || short === null) throw new Error('a walk starts on the bank');

    expect(walkLengthTo(long, from.hx, from.hy)).toBe(0);
    expect(walkLengthTo(long, beside.hx, beside.hy)).toBe(beside.hx - from.hx);
    const round = walkLengthTo(long, across.hx, across.hy);
    expect(round).toBeGreaterThan(from.hx - across.hx);
    expect(round).toBeLessThanOrEqual(LONG_WALK);
    expect(walkLengthTo(short, across.hx, across.hy)).toBe(NO_WALK);
  });

  it('measures no walk from a node none starts on', () => {
    const sim = riverSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const water = cellAnchorNode(RIVER_CELL.x, RIVER_CELL.y);
    expect(walkLengthsFrom(sim.world, sim.content, terrain, water.hx, water.hy, LONG_WALK)).toBeNull();
  });
});
