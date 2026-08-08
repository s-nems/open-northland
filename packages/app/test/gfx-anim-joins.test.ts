import { describe, expect, it } from 'vitest';
import {
  gfxAtomicProgramsByAction,
  gfxWaitProgramsBySeq,
  gfxWalkFrameLists,
} from '../src/content/ir/joins.js';
import type { ContentIr } from '../src/content/ir/rows.js';

/** The `[gfxanimatomic]` / `[gfxwalkatomic]` program joins: tribe filtering, first-record-wins, and the
 *  `gfxanimmode 1` base-wait preference. */

const VIKING = 1;
const WAIT_ACTION = 2;
const BASE_WAIT_ACTION = 7;

describe('gfxAtomicProgramsByAction', () => {
  it('indexes one tribe by action then seq, first record winning per (action, seq)', () => {
    const ir: ContentIr = {
      gfxAtomics: [
        { tribe: VIKING, job: 6, action: 10, bodySeq: 'eat', dirFrames: [[0, 1]], mode: 0 },
        { tribe: VIKING, job: 5, action: 10, bodySeq: 'eat', dirFrames: [[9, 9]] }, // later duplicate
        { tribe: 2, job: 6, action: 10, bodySeq: 'eat', dirFrames: [[7]] }, // other tribe
        { tribe: VIKING, job: 6, action: 12, bodySeq: 'pray', dirFrames: [[2, 2, 3]], mode: 1 },
      ],
    };
    const byAction = gfxAtomicProgramsByAction(ir, VIKING);
    expect(byAction.get(10)?.get('eat')).toEqual({ dirFrames: [[0, 1]], mode: 0 });
    expect(byAction.get(12)?.get('pray')).toEqual({ dirFrames: [[2, 2, 3]], mode: 1 });
  });
});

describe('gfxWaitProgramsBySeq', () => {
  it('prefers the gfxanimmode-1 base wait over the one-shot fidgets, regardless of row order', () => {
    const ir: ContentIr = {
      gfxAtomics: [
        { tribe: VIKING, job: 6, action: WAIT_ACTION, bodySeq: 'wait', dirFrames: [[9]], mode: 0 },
        { tribe: VIKING, job: 6, action: BASE_WAIT_ACTION, bodySeq: 'wait', dirFrames: [[0, 0, 1]], mode: 1 },
        { tribe: VIKING, job: 6, action: 5, bodySeq: 'wait', dirFrames: [[4]], mode: 0 }, // after the base
      ],
    };
    expect(gfxWaitProgramsBySeq(ir, VIKING).get('wait')).toEqual({ dirFrames: [[0, 0, 1]], mode: 1 });
  });

  it('keeps the first fidget for a body with no mode-1 base wait (the baby) and ignores non-wait actions', () => {
    const ir: ContentIr = {
      gfxAtomics: [
        { tribe: VIKING, job: 1, action: 10, bodySeq: 'baby_wait', dirFrames: [[7]] }, // eat, not a wait
        { tribe: VIKING, job: 1, action: WAIT_ACTION, bodySeq: 'baby_wait', dirFrames: [[1, 2]], mode: 0 },
        { tribe: VIKING, job: 1, action: 3, bodySeq: 'baby_wait', dirFrames: [[3]], mode: 0 },
      ],
    };
    expect(gfxWaitProgramsBySeq(ir, VIKING).get('baby_wait')).toEqual({ dirFrames: [[1, 2]], mode: 0 });
  });
});

describe('gfxWalkFrameLists', () => {
  it("keys one tribe's walk lists by seq name, skipping rows without lists", () => {
    const ir: ContentIr = {
      gfxWalkAtomics: [
        { tribe: VIKING, job: 6, goodType: 0, bodySeq: 'walk' }, // no lists lane
        {
          tribe: VIKING,
          job: 1,
          goodType: 0,
          bodySeq: 'crawl',
          dirFrames: [
            [52, 53],
            [13, 14],
          ],
        },
        { tribe: 8, job: 49, goodType: 0, bodySeq: 'bear_walk', dirFrames: [[0, 1]] }, // other tribe
      ],
    };
    const lists = gfxWalkFrameLists(ir, VIKING);
    expect(lists.get('crawl')).toEqual([
      [52, 53],
      [13, 14],
    ]);
    expect(lists.has('walk')).toBe(false);
    expect(lists.has('bear_walk')).toBe(false);
  });
});
