import { describe, expect, it } from 'vitest';
import { signpostBoardsOf } from '../../src/data/scene/signpost-boards.js';
import { entity, snapshotOf } from '../support/fixtures.js';

const PLAYER = 1;

function post(id: number, tileX: number, tileY: number, links: readonly number[]) {
  return entity(id, tileX, tileY, { Signpost: { links }, Owner: { player: PLAYER } });
}

describe('signpost direction boards', () => {
  it('shows one board per stored link, on both ends', () => {
    const boards = signpostBoardsOf(snapshotOf([post(1, 0, 0, [2]), post(2, 5, 2, [1])]));

    expect([...boards.keys()].sort()).toEqual([1, 2]);
    expect(boards.get(1)).toHaveLength(1);
    expect(boards.get(2)).toHaveLength(1);
  });

  it('shows nothing for a post with no links, however close another stands', () => {
    const boards = signpostBoardsOf(snapshotOf([post(1, 0, 0, []), post(2, 1, 0, [])]));

    expect(boards.size).toBe(0);
  });

  it('ignores a link to a post the snapshot no longer holds', () => {
    const boards = signpostBoardsOf(snapshotOf([post(1, 0, 0, [7])]));

    expect(boards.size).toBe(0);
  });

  it('merges two neighbours in the same bearing bucket into one board', () => {
    const boards = signpostBoardsOf(
      snapshotOf([post(1, 0, 0, [2, 3]), post(2, 4, 0, [1]), post(3, 8, 0, [1])]),
    );

    expect(boards.get(1)).toHaveLength(1);
  });
});
