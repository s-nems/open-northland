import { Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';

/**
 * Original behavior: the landscape growth trigger (`transition 7`) runs every 24 ticks over one section of
 * a 20 x 20 grid laid on the map, in row order, and fires on every landscape point there whose type has a
 * `transition 7`.
 */
const GROWTH_RUN_TICKS = 24;
const SECTIONS_PER_SIDE = 20;
const SECTION_COUNT = SECTIONS_PER_SIDE * SECTIONS_PER_SIDE;

/** Ticks between two growth triggers on one map point: 9600, 800 s of game time. */
export const LANDSCAPE_GROWTH_PERIOD_TICKS = GROWTH_RUN_TICKS * SECTION_COUNT;

/** The answer on a tick the trigger rests, shared so those ticks allocate nothing. Never mutated. */
const NONE_DUE: readonly Entity[] = [];

/** The `index`-th section edge along a map side `size` nodes long, as the original cuts the grid. */
function sectionEdge(size: number, index: number): number {
  return Math.floor((size * index) / SECTIONS_PER_SIDE);
}

/**
 * The entities of the spatial index `nearNode` anchored in the map section the growth trigger runs over
 * this tick, ascending id. Empty on a tick it rests, on a map too small for the section to hold a node,
 * and without terrain.
 */
export function dueForGrowth(
  world: World,
  ctx: SystemContext,
  nearNode: (world: World, hx: number, hy: number, reach: number) => readonly Entity[],
): readonly Entity[] {
  const terrain = ctx.terrain;
  if (terrain === undefined || ctx.tick % GROWTH_RUN_TICKS !== 0) return NONE_DUE;
  const section = Math.floor(ctx.tick / GROWTH_RUN_TICKS) % SECTION_COUNT;
  const column = section % SECTIONS_PER_SIDE;
  const row = Math.floor(section / SECTIONS_PER_SIDE);
  const x0 = sectionEdge(terrain.width, column);
  const x1 = sectionEdge(terrain.width, column + 1);
  const y0 = sectionEdge(terrain.height, row);
  const y1 = sectionEdge(terrain.height, row + 1);
  if (x0 === x1 || y0 === y1) return NONE_DUE;
  // The box around the section's middle covers the whole section; the bounds test trims it.
  const reach = Math.ceil(Math.max(x1 - x0, y1 - y0) / 2);
  return nearNode(world, (x0 + x1) >> 1, (y0 + y1) >> 1, reach).filter((e) => {
    const pos = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(pos.x, pos.y);
    return hx >= x0 && hx < x1 && hy >= y0 && hy < y1;
  });
}
