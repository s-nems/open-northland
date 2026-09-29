import type { EntitySnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { signpostBoards } from '../../src/data/scene/signpost-boards.js';
import { entity, snapshotOf } from '../support/fixtures.js';

const PLAYER = 1;

function post(id: number, tileX: number, tileY: number, links: readonly number[]) {
  return entity(id, tileX, tileY, { Signpost: { links }, Owner: { player: PLAYER } });
}

/** The boards of the post `id` among `posts`. */
function boardsOf(posts: readonly EntitySnapshot[], id: number): number[] {
  const subject = posts.find((p) => p.id === id);
  if (subject === undefined) throw new Error(`no post ${id}`);
  return signpostBoards(snapshotOf(posts), subject.components);
}

describe('signpost direction boards', () => {
  it('shows one board per stored link, on both ends, pointing opposite ways', () => {
    const posts = [post(1, 0, 0, [2]), post(2, 5, 2, [1])];
    const [there] = boardsOf(posts, 1);
    const [back] = boardsOf(posts, 2);

    expect(boardsOf(posts, 1)).toHaveLength(1);
    expect(boardsOf(posts, 2)).toHaveLength(1);
    expect(((there ?? 0) + 9) % 18).toBe(back);
  });

  it('shows nothing for a post with no links, however close another stands', () => {
    expect(boardsOf([post(1, 0, 0, []), post(2, 1, 0, [])], 1)).toEqual([]);
  });

  it('ignores a link to a post the snapshot no longer holds, or to an entity that is no post', () => {
    const settler = entity(3, 4, 0, { Settler: { tribe: 0 } });
    expect(boardsOf([post(1, 0, 0, [7, 3]), settler], 1)).toEqual([]);
  });

  it('merges two neighbours in the same bearing bucket into one board', () => {
    const posts = [post(1, 0, 0, [2, 3]), post(2, 4, 0, [1]), post(3, 8, 0, [1])];

    expect(boardsOf(posts, 1)).toHaveLength(1);
  });
});
