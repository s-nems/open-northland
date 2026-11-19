import { describe, expect, it } from 'vitest';
import { Position, ResourceFootprint } from '../../../src/components/index.js';
import { cellAnchorNode, positionOfNode, Simulation } from '../../../src/index.js';
import { GroupCoverage } from '../../../src/systems/signposts/group-coverage.js';
import type { SignpostSite } from '../../../src/systems/signposts/index.js';
import { signpostMask, WALK_REACH_SHAPE } from '../../../src/systems/signposts/terrain-reach.js';
import { testContent } from '../../fixtures/content.js';
import { grassCellMap } from '../../fixtures/terrain.js';
import { stampPost } from './support.js';

const MAP_CELLS = { width: 160, height: 8 };
const ROW = 4;
/** Two posts of one group too far apart for either search to mark a node the other does. */
const WEST_POST_CELL = 20;
const EAST_POST_CELL = 120;
/** A few cells from a post: inside its search alone. */
const NEAR_POST_CELLS = 5;
/** Between the posts, inside the group's bounds and past both searches. */
const BETWEEN_CELL = 70;

describe('GroupCoverage', () => {
  function scene() {
    const sim = new Simulation({
      seed: 1,
      content: testContent(),
      map: grassCellMap(MAP_CELLS.width, MAP_CELLS.height),
    });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const posts: SignpostSite[] = [WEST_POST_CELL, EAST_POST_CELL].map((x) => {
      const entity = stampPost(sim, x, ROW);
      const at = cellAnchorNode(x, ROW);
      return { entity, hx: at.hx, hy: at.hy, group: 0 };
    });
    const coverage = new GroupCoverage(sim.world, sim.content, terrain, posts, WALK_REACH_SHAPE.post);
    const covers = (cellX: number, epoch: number): boolean => {
      const at = cellAnchorNode(cellX, ROW);
      return coverage.covers(at.hx, at.hy, epoch);
    };
    return { sim, terrain, coverage, covers };
  }

  it('finds a node only a post never asked before covers, and none where no post reaches', () => {
    const { covers } = scene();
    // The west post answers this one alone, so the east post is still unasked for the next.
    expect(covers(WEST_POST_CELL + NEAR_POST_CELLS, 0)).toBe(true);
    expect(covers(EAST_POST_CELL + NEAR_POST_CELLS, 0)).toBe(true);
    expect(covers(BETWEEN_CELL, 0)).toBe(false);
    expect(covers(MAP_CELLS.width + NEAR_POST_CELLS, 0)).toBe(false);
  });

  it('finds a node again through a post whose held search a change made stale', () => {
    const { sim, terrain, coverage, covers } = scene();
    const node = WEST_POST_CELL + NEAR_POST_CELLS;
    expect(covers(node, 0)).toBe(true);
    // A rock beside the post changes ground its search read; the next epoch asks the post again.
    const at = cellAnchorNode(WEST_POST_CELL - NEAR_POST_CELLS, ROW);
    expect(coverage.covers(at.hx, at.hy, 0)).toBe(true);
    const rock = sim.world.create();
    sim.world.add(rock, Position, positionOfNode(at.hx, at.hy));
    sim.world.add(rock, ResourceFootprint, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
    expect(signpostMask(sim.world, sim.content, terrain).has(terrain.nodeAt(at.hx, at.hy))).toBe(true);
    expect(covers(node, 1)).toBe(true);
    // The rock's node is no longer ground a walk marks.
    expect(coverage.covers(at.hx, at.hy, 1)).toBe(false);
  });
});
