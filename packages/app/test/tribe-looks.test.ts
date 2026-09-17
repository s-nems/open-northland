import { describe, expect, it } from 'vitest';
import {
  JOB_ARCHER,
  JOB_CIVILIST,
  JOB_DRUID,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_UNARMED,
} from '../src/catalog/jobs.js';
import type { ContentIr, JobGraphicsRow } from '../src/content/ir/rows.js';
import { lookStem, tribeLooks } from '../src/content/settler-gfx/index.js';

/**
 * The per-tribe `[jobbasegraphics]` join: which bob sets each civilization composes a character look from.
 * A spec names the jobs whose record draws it, best first, so a tribe that authors no record for a soldier
 * class degrades to its plain soldier rather than to another tribe's body.
 */

const VIKING = 1;
const FRANK = 2;

const BOBS = 'data/engine2d/bin/bobs';

function row(tribe: number, job: number, body: string, over: Partial<JobGraphicsRow> = {}): JobGraphicsRow {
  return { tribe, job, body: `${BOBS}/${body}.bmd`, heads: [], ...over };
}

const ir: ContentIr = {
  jobGraphics: [
    row(VIKING, JOB_CIVILIST, 'cr_hum_body_00', {
      heads: [`${BOBS}/cr_hum_head_00.bmd`, `${BOBS}/cr_hum_head_01.bmd`],
      bodyPalette: 'test_human_00',
      headPalette: 'test_human_00',
    }),
    row(VIKING, JOB_SOLDIER_UNARMED, 'cr_hum_body_05'),
    // The druid record: the civilian body under the capped heads.
    row(VIKING, JOB_DRUID, 'cr_hum_body_00', {
      heads: [`${BOBS}/cr_hum_head_90.bmd`, `${BOBS}/cr_hum_head_91.bmd`],
      bodyPalette: 'test_human_00',
      headPalette: 'test_human_00',
    }),
    row(FRANK, JOB_CIVILIST, 'cr_hum_body_30', {
      // The source repeats a head slot per variant; the join keeps one entry per distinct look.
      heads: [`${BOBS}/cr_hum_head_30.bmd`, `${BOBS}/cr_hum_head_31.bmd`, `${BOBS}/cr_hum_head_30.bmd`],
    }),
    row(FRANK, JOB_SOLDIER_UNARMED, 'cr_hum_body_32'),
    row(FRANK, JOB_SOLDIER_SPEAR_WOODEN, 'cr_hum_body_52', { headPalette: 'human_special' }),
  ],
};

describe('tribeLooks', () => {
  it('gives each tribe its own body for the same character spec', () => {
    expect(tribeLooks(ir, VIKING).get('civilian')?.[0]?.bodyBmd).toBe('cr_hum_body_00');
    expect(tribeLooks(ir, FRANK).get('civilian')?.[0]?.bodyBmd).toBe('cr_hum_body_30');
  });

  it('resolves a soldier class to its own record, then degrades to the tribe plain soldier', () => {
    const frank = tribeLooks(ir, FRANK);
    // The frank spearman has its own record; the chain still carries the plain soldier behind it, which
    // the loader falls to when the first body has no decoded atlas.
    expect(frank.get('warrior-spear')?.map((l) => l.bodyBmd)).toEqual(['cr_hum_body_52', 'cr_hum_body_32']);
    // No frank record for the archer class (`logicjob 40`), so it draws the plain soldier body.
    expect(frank.get('warrior-shortbow')?.map((l) => l.bodyBmd)).toEqual(['cr_hum_body_32']);
  });

  it('composes the druid from its own head record, then the civilist behind it', () => {
    const viking = tribeLooks(ir, VIKING).get('druid');
    expect(viking?.map((l) => l.headBmds)).toEqual([
      ['cr_hum_head_90', 'cr_hum_head_91'],
      ['cr_hum_head_00', 'cr_hum_head_01'],
    ]);
    // A tribe with no druid record has only its civilist in the chain, so its druids read as civilians.
    expect(
      tribeLooks(ir, FRANK)
        .get('druid')
        ?.map((l) => l.headBmds),
    ).toEqual([['cr_hum_head_30', 'cr_hum_head_31']]);
  });

  it('deduplicates the repeated head slots and carries each record palette', () => {
    const frank = tribeLooks(ir, FRANK).get('civilian')?.[0];
    expect(frank?.headBmds).toEqual(['cr_hum_head_30', 'cr_hum_head_31']);
    const spear = tribeLooks(ir, FRANK).get('warrior-spear')?.[0];
    expect(spear?.headPalette).toBe('human_special');
    // An unnamed palette falls to the base human skin the bobs are authored in.
    expect(spear?.bodyPalette).toBe('test_human_00');
  });

  it('keeps no entry for a spec the tribe describes no record for', () => {
    // A tribe with only a civilian record: the whole soldier family is absent, so those jobs draw the
    // base tribe's look rather than this tribe's civilian.
    const sparse: ContentIr = { jobGraphics: [row(7, JOB_CIVILIST, 'cr_hum_body_75')] };
    const looks = tribeLooks(sparse, 7);
    expect(looks.get('civilian')?.[0]?.bodyBmd).toBe('cr_hum_body_75');
    expect(looks.has('warrior')).toBe(false);
    expect(looks.has('warrior-longbow')).toBe(false);
  });

  it('is empty for a tribe with no rows, and for an absent IR', () => {
    expect(tribeLooks(ir, 99).size).toBe(0);
    expect(tribeLooks(null, VIKING).size).toBe(0);
  });

  it('composes the served atlas stem from the bob set and its palette', () => {
    expect(lookStem('cr_hum_body_30', 'test_human_00')).toBe('cr_hum_body_30.test_human_00');
    expect(lookStem('cr_hum_head_42', 'egypt_soldier')).toBe('cr_hum_head_42.egypt_soldier');
  });

  it('reads the archer chain as its own class then the plain soldier', () => {
    // The chain order is what makes a tribe-specific archer body win where one exists.
    const viking = tribeLooks(
      { jobGraphics: [...(ir.jobGraphics ?? []), row(VIKING, JOB_ARCHER, 'cr_hum_body_60')] },
      VIKING,
    );
    expect(viking.get('warrior-shortbow')?.map((l) => l.bodyBmd)).toEqual([
      'cr_hum_body_60',
      'cr_hum_body_05',
    ]);
  });
});
