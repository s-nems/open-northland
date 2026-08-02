import { describe, expect, it } from 'vitest';
import { signpostBoardsOf } from '../../src/data/scene/signpost-boards.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/**
 * Pins the board prepass to the half-cell seam: a post on an ODD row anchors at node `2c + 1`, so its
 * link decision must read that staggered node - a bare `c · 2` would place it half a cell west and draw
 * boards the sim's confinement never granted.
 */

const PLAYER = 1;
/** Unequal radii summing to 11 nodes - unequal so the pair also proves the SUM is the reach, and 11 so
 *  that reach falls between the staggered and unstaggered node: at a 2-node row gap `withinNodeRadius`
 *  admits dx ≤ 10 nodes and rejects 11. */
const RADIUS_A = 6;
const RADIUS_B = 5;
/** The tile column at which the two verdicts split: node 11 on an odd row, node 10 on an even one. */
const SPLIT_COLUMN = 5;

function post(id: number, tileX: number, tileY: number, navRadius: number) {
  return entity(id, tileX, tileY, { Signpost: { navRadius }, Owner: { player: PLAYER } });
}

describe('signpost direction boards', () => {
  it('drops the link when the odd-row stagger pushes the neighbour out of reach', () => {
    const boards = signpostBoardsOf(
      snapshotOf([post(1, 0, 0, RADIUS_A), post(2, SPLIT_COLUMN, 1, RADIUS_B)]),
    );

    expect(boards.size).toBe(0);
  });

  it('keeps the link for the same column on an even row, where no stagger applies', () => {
    const boards = signpostBoardsOf(
      snapshotOf([post(1, 0, 0, RADIUS_A), post(2, SPLIT_COLUMN, 2, RADIUS_B)]),
    );

    expect([...boards.keys()].sort()).toEqual([1, 2]);
    expect(boards.get(1)).toHaveLength(1);
    expect(boards.get(2)).toHaveLength(1);
  });

  it('links an odd-row neighbour that is in reach at its staggered node', () => {
    const boards = signpostBoardsOf(
      snapshotOf([post(1, 0, 0, RADIUS_A), post(2, SPLIT_COLUMN - 1, 1, RADIUS_B)]),
    );

    expect([...boards.keys()].sort()).toEqual([1, 2]);
  });
});
