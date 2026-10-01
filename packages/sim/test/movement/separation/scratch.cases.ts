import { describe, expect, it } from 'vitest';
import { PathFollow } from '../../../src/components/index.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { collectColliders } from '../../../src/systems/movement/collision/separation/colliders.js';
import { separationScratch } from '../../../src/systems/movement/collision/separation/scratch.js';
import { SlotGrid } from '../../../src/systems/movement/collision/separation/slot-grid.js';
import { P0, settlerAt, sim, WOODCUTTER, walkStraightTo } from './support.js';

const OFF_LATTICE = -1;

function collected(grid: SlotGrid, x: number, y: number): number[] {
  const out: number[] = [];
  out.length = grid.collect(x, y, out, 0);
  return out;
}

describe('unit body collision - scratch lifetime', () => {
  it('lists a node ascending and forgets what the previous fill held', () => {
    const terrain = sim().terrain;
    if (terrain === undefined) throw new Error('the separation fixture is mapped');
    const grid = new SlotGrid();

    grid.fill(terrain, 3, [2, 2, 3], [1, 1, 1]);
    expect(collected(grid, 2, 1)).toEqual([0, 1]);
    expect(collected(grid, 3, 1)).toEqual([2]);

    grid.fill(terrain, 1, [3], [1]);
    expect(collected(grid, 2, 1)).toEqual([]);
    expect(collected(grid, 3, 1)).toEqual([0]);
  });

  it('keeps an off-lattice slot findable at its own node', () => {
    const terrain = sim().terrain;
    if (terrain === undefined) throw new Error('the separation fixture is mapped');
    const grid = new SlotGrid();

    grid.fill(terrain, 3, [OFF_LATTICE, 0, OFF_LATTICE], [0, 0, 0]);

    expect(collected(grid, OFF_LATTICE, 0)).toEqual([0, 2]);
    expect(collected(grid, 0, 0)).toEqual([1]);
  });

  it('refills the mover columns in ascending id and drops a mover that stopped', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('the separation fixture is mapped');
    const walker = settlerAt(s, 2, 2, WOODCUTTER, P0);
    const other = settlerAt(s, 6, 2, WOODCUTTER, P0);
    walkStraightTo(s, other, 8, 2);
    walkStraightTo(s, walker, 4, 2);
    const ctx: SystemContext = {
      content: s.content,
      rng: s.rng,
      tick: 0,
      events: s.events,
      commands: s.commands,
    };
    const scratch = separationScratch(s.world);

    expect(collectColliders(s.world, ctx, terrain, scratch)).toBe(true);
    expect(scratch.movers.entity.slice(0, scratch.movers.count)).toEqual([walker, other]);

    s.world.remove(walker, PathFollow);
    expect(collectColliders(s.world, ctx, terrain, scratch)).toBe(true);
    expect(scratch.movers.entity.slice(0, scratch.movers.count)).toEqual([other]);

    s.world.remove(other, PathFollow);
    expect(collectColliders(s.world, ctx, terrain, scratch)).toBe(false);
  });
});
