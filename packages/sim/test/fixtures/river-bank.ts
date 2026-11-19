import { addPerson, Building, Owner, Position, Stockpile } from '../../src/components/index.js';
import { ONE, ZERO } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, type NodeId, positionOfNode, Simulation } from '../../src/index.js';
import type { TerrainGraph } from '../../src/nav/terrain/index.js';
import { testContent } from './content.js';
import { waterColumnMap } from './terrain.js';

/**
 * A river down the map with a ford at its foot, for picks that must rank by the walk: a target across it
 * is the nearer by line and the farther by walk, and both lie inside every reach, so only the ranking tells
 * them apart.
 */

const VIKING = 1;
/** The one player of the fixture. */
export const RIVER_PLAYER = 0;
export const RIVER_CELLS = { width: 40, height: 12, river: 20, fordRows: 2 } as const;
/** The origin the picks rank from, three cells off the river's east bank. */
export const ORIGIN_CELL = { x: 23, y: 5 } as const;
/** Six cells west of the origin by line, round the ford by walk. */
export const ACROSS_CELL = { x: 17, y: 5 } as const;
/** Ten cells east of the origin on its own bank. */
export const UP_THE_BANK_CELL = { x: 33, y: 5 } as const;
/** Off the origin on its bank, for a settler whose own walk is not the one a pick ranks by. */
export const AWAY_CELL = { x: 26, y: 8 } as const;

interface Cell {
  readonly x: number;
  readonly y: number;
}

/** The river map under `testContent`, with signpost navigation `confined` on or off. */
export function riverSim(confined: boolean): { sim: Simulation; terrain: TerrainGraph } {
  const { width, height, river, fordRows } = RIVER_CELLS;
  const sim = new Simulation({
    seed: 5,
    content: testContent(),
    map: waterColumnMap(width, height, river, fordRows),
  });
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: confined });
  sim.step();
  if (sim.terrain === undefined) throw new Error('mapped sim');
  return { sim, terrain: sim.terrain };
}

export function nodeOfCell(terrain: TerrainGraph, cell: Cell): NodeId {
  const anchor = cellAnchorNode(cell.x, cell.y);
  return terrain.nodeAt(anchor.hx, anchor.hy);
}

/** A contented settler of {@link RIVER_PLAYER} on `cell`. */
export function settlerOn(sim: Simulation, cell: Cell, jobType: number): Entity {
  const e = sim.world.create();
  const anchor = cellAnchorNode(cell.x, cell.y);
  sim.world.add(e, Position, positionOfNode(anchor.hx, anchor.hy));
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: ZERO,
    fatigue: ZERO,
    piety: ZERO,
    enjoyment: ZERO,
  });
  sim.world.add(e, Owner, { player: RIVER_PLAYER });
  return e;
}

/** A finished building of {@link RIVER_PLAYER} on `cell`, stocked with `goods`. */
export function buildingOn(
  sim: Simulation,
  cell: Cell,
  buildingType: number,
  goods: [number, number][] = [],
): Entity {
  const e = sim.world.create();
  const anchor = cellAnchorNode(cell.x, cell.y);
  sim.world.add(e, Position, positionOfNode(anchor.hx, anchor.hy));
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map(goods) });
  sim.world.add(e, Owner, { player: RIVER_PLAYER });
  return e;
}
