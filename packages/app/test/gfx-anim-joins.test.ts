import { describe, expect, it } from 'vitest';
import {
  gfxAtomicProgramsByAction,
  gfxWaitProgramsBySeq,
  gfxWalkFrameLists,
  tribeJobSeqs,
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

describe('tribeJobSeqs', () => {
  const ATTACK_ACTION = 81;
  const FIDGET_ACTION = 5;
  const EAT_ACTION = 10;
  const CHEST_ACTION = 91;
  const UNLOADED = 0;
  const CIVILIST = 6;
  const SOLDIER = 31;
  const LONGBOWMAN = 41;
  const HEROINE = 47;

  const ir: ContentIr = {
    jobs: [
      { typeId: CIVILIST },
      { typeId: SOLDIER, baseJob: CIVILIST },
      { typeId: LONGBOWMAN, baseJob: SOLDIER },
      { typeId: HEROINE, baseJob: LONGBOWMAN },
    ],
    gfxWalkAtomics: [
      { tribe: VIKING, job: LONGBOWMAN, goodType: UNLOADED, bodySeq: 'longbow_walk' },
      { tribe: VIKING, job: LONGBOWMAN, goodType: 3, bodySeq: 'longbow_walk_wood' },
      { tribe: VIKING, job: SOLDIER, goodType: UNLOADED, bodySeq: 'soldier_walk' },
      { tribe: 2, job: LONGBOWMAN, goodType: UNLOADED, bodySeq: 'frank_longbow_walk' },
    ],
    gfxAtomics: [
      {
        tribe: VIKING,
        job: LONGBOWMAN,
        action: FIDGET_ACTION,
        bodySeq: 'longbow_fidget',
        dirFrames: [[0]],
        mode: 0,
      },
      {
        tribe: VIKING,
        job: LONGBOWMAN,
        action: BASE_WAIT_ACTION,
        bodySeq: 'longbow_wait',
        dirFrames: [[1]],
        mode: 1,
      },
      { tribe: VIKING, job: LONGBOWMAN, action: ATTACK_ACTION, bodySeq: 'longbow_attack', dirFrames: [[2]] },
      {
        tribe: VIKING,
        job: LONGBOWMAN,
        action: ATTACK_ACTION,
        bodySeq: 'longbow_attack_2',
        dirFrames: [[3]],
      },
      { tribe: VIKING, job: LONGBOWMAN, action: CHEST_ACTION, bodySeq: 'longbow_pick_up', dirFrames: [[4]] },
      {
        tribe: VIKING,
        job: LONGBOWMAN,
        action: CHEST_ACTION,
        bodySeq: 'longbow_pick_up_2',
        dirFrames: [[5]],
      },
      { tribe: VIKING, job: SOLDIER, action: CHEST_ACTION, bodySeq: 'soldier_pick_up', dirFrames: [[6]] },
      { tribe: VIKING, job: SOLDIER, action: EAT_ACTION, bodySeq: 'soldier_eat', dirFrames: [[7]] },
      { tribe: VIKING, job: CIVILIST, action: EAT_ACTION, bodySeq: 'civilist_eat', dirFrames: [[8]] },
      {
        tribe: VIKING,
        job: CIVILIST,
        action: BASE_WAIT_ACTION,
        bodySeq: 'civilist_wait',
        dirFrames: [[9]],
        mode: 1,
      },
      // An indoor sub-clip is choreography, not an action clip.
      { tribe: VIKING, job: SOLDIER, action: 60, subId: 1, bodySeq: 'soldier_craft', dirFrames: [[10]] },
    ],
  };

  it('lists one job own unloaded gait, base wait, first attack and every action record ahead of its base jobs', () => {
    expect(tribeJobSeqs(ir, VIKING, [LONGBOWMAN])).toEqual({
      walk: ['longbow_walk', 'soldier_walk'],
      wait: ['longbow_wait', 'civilist_wait'],
      attack: ['longbow_attack'],
      // A job's several records for one action all stay, in file order, each with its own frame lists.
      atomics: new Map([
        [
          CHEST_ACTION,
          [
            { seq: 'longbow_pick_up', program: { dirFrames: [[4]] } },
            { seq: 'longbow_pick_up_2', program: { dirFrames: [[5]] } },
            { seq: 'soldier_pick_up', program: { dirFrames: [[6]] } },
          ],
        ],
        [
          EAT_ACTION,
          [
            { seq: 'soldier_eat', program: { dirFrames: [[7]] } },
            { seq: 'civilist_eat', program: { dirFrames: [[8]] } },
          ],
        ],
      ]),
    });
  });

  it('resolves a job that authors nothing through its baseJob chain, the way the original falls back', () => {
    expect(tribeJobSeqs(ir, VIKING, [HEROINE])).toEqual(tribeJobSeqs(ir, VIKING, [LONGBOWMAN]));
  });

  it('prefers the looping base wait over a fidget authored for the same job', () => {
    // Order matters the other way round too: the fidget is read first and must still lose.
    const fidgetOnly: ContentIr = { ...ir, gfxAtomics: (ir.gfxAtomics ?? []).filter((r) => r.mode !== 1) };
    expect(tribeJobSeqs(fidgetOnly, VIKING, [LONGBOWMAN]).wait).toEqual(['longbow_fidget']);
  });

  it('omits what the tribe does not author rather than borrowing another job or tribe', () => {
    const none = { walk: [], wait: [], attack: [], atomics: new Map() };
    expect(tribeJobSeqs(ir, VIKING, [34])).toEqual(none);
    expect(tribeJobSeqs(ir, 3, [LONGBOWMAN])).toEqual(none);
    expect(tribeJobSeqs(null, VIKING, [LONGBOWMAN])).toEqual(none);
    // A loaded gait is not the job's walk: only the `logicgoodtype 0` row is.
    expect(tribeJobSeqs(ir, 2, [LONGBOWMAN])).toEqual({ ...none, walk: ['frank_longbow_walk'] });
  });

  it('reads several keys in order without repeating a job', () => {
    expect(tribeJobSeqs(ir, VIKING, [SOLDIER, LONGBOWMAN]).walk).toEqual(['soldier_walk', 'longbow_walk']);
    const cyclic: ContentIr = {
      ...ir,
      jobs: [
        { typeId: CIVILIST, baseJob: SOLDIER },
        { typeId: SOLDIER, baseJob: CIVILIST },
      ],
    };
    expect(
      tribeJobSeqs(cyclic, VIKING, [SOLDIER])
        .atomics.get(EAT_ACTION)
        ?.map((c) => c.seq),
    ).toEqual(['soldier_eat', 'civilist_eat']);
  });
});
