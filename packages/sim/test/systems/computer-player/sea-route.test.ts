import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../src/ecs/world.js';
import { halfCellMapFromCells, Simulation } from '../../../src/index.js';
import type { HalfCellNode } from '../../../src/nav/halfcell.js';
import { nodeManhattan } from '../../../src/nav/halfcell.js';
import { LANDING_SHORE_SPACING_NODES, shorePoints } from '../../../src/systems/computer-player/sea-route.js';
import { createVehicle, mooringSpotsOf } from '../../../src/systems/vehicles/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { ctxOf } from '../../fixtures/context.js';

const VIKING = 1;
const SEAT = 2;
const SHIP = 3;
const SPEARMAN = 32;
const GRASS = 0;
const WATER = 1;
/** Cells: the west island, the strait, the east island. */
const MAP_CELLS = { width: 70, height: 60 };
const STRAIT_FROM = 22;
const STRAIT_TO = 42;
const SHIP_AT = { x: 46, y: 60 };
const TOWARDS = { hx: 100, hy: 40 };
const COUNT = 3;
/** The rows the test's `usable` refuses. */
const BARRED_ROWS = { from: 30, to: 50 };

function straitMap() {
  const { width, height } = MAP_CELLS;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let row = 0; row < height; row++)
    for (let col = STRAIT_FROM; col < STRAIT_TO; col++) typeIds[row * width + col] = WATER;
  return halfCellMapFromCells({ width, height, typeIds });
}

function strait() {
  const sim = new Simulation({
    seed: 7,
    content: parseContentSet({
      ...aiContent(),
      vehicles: [
        {
          typeId: SHIP,
          id: 'ship_small',
          jobId: 52,
          stockSlots: 0,
          passengerSlots: 3,
          logicSize: 2,
          passengerJobs: [SPEARMAN],
          commanderJob: 24,
          passengerVector: { direction: 2, distance: 4 },
          hitpoints: 5000,
        },
      ],
    }),
    map: straitMap(),
  });
  sim.step();
  const ctx = ctxOf(sim);
  const ship = createVehicle(sim.world, ctx, { vehicleType: SHIP, ...SHIP_AT, tribe: VIKING, owner: SEAT });
  const terrain = ctx.terrain;
  if (ship === null || terrain === undefined) throw new Error('setup: no ship or terrain');
  const east = terrain.componentOf(terrain.nodeAtClamped(TOWARDS.hx, TOWARDS.hy));
  const pick = (ofShip: Entity, usable: (at: HalfCellNode) => boolean): HalfCellNode[] =>
    shorePoints(sim.world, ctx, terrain, ofShip, east, TOWARDS, usable, COUNT);
  const spotsOnLand = (): HalfCellNode[] => {
    const spots = mooringSpotsOf(sim.world, ctx, terrain, ship)?.spots ?? [];
    return [...spots]
      .filter((node) => terrain.componentOf(node) === east)
      .map((node) => {
        const { x, y } = terrain.coordsOf(node);
        return { hx: x, hy: y };
      });
  };
  return { ship, pick, spotsOnLand };
}

describe('shorePoints', () => {
  it('picks spaced mooring spots on the land, nearest the aim first', () => {
    const { ship, pick, spotsOnLand } = strait();
    const picked = pick(ship, () => true);
    const distances = spotsOnLand().map((at) => nodeManhattan(at, TOWARDS));
    expect(picked).toHaveLength(COUNT);
    expect(nodeManhattan(picked[0] as HalfCellNode, TOWARDS)).toBe(Math.min(...distances));
    for (const [i, at] of picked.entries()) {
      for (const other of picked.slice(i + 1))
        expect(nodeManhattan(at, other)).toBeGreaterThanOrEqual(LANDING_SHORE_SPACING_NODES);
    }
  });

  it('skips a spot the caller refuses', () => {
    const { ship, pick } = strait();
    const barred = (at: HalfCellNode): boolean => at.hy >= BARRED_ROWS.from && at.hy < BARRED_ROWS.to;
    const picked = pick(ship, (at) => !barred(at));
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.some(barred)).toBe(false);
  });
});
