import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  JOB_ARCHER,
  JOB_BUILDER,
  JOB_COLLECTOR,
  JOB_HERO_UNARMED,
  JOB_HEROINE_BOW,
  JOB_WOMAN,
} from '../src/catalog/jobs.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import type { Pickable } from '../src/view/picking.js';
import { jobMatesAround } from '../src/view/unit-controls/job-mates.js';
import { settler, snapshotOf } from './support/snapshot.js';

const content = sandboxContent();

const drawn = (ref: number, x: number, y: number): Pickable => ({ ref, x, y, kind: 'settler' });

describe('double-click job mates', () => {
  const CURSOR = { x: 1000, y: 1000 };

  it('gathers the clicked trade inside the 800 x 600 window around the cursor', () => {
    const snapshot = snapshotOf([
      settler(1, JOB_BUILDER, null),
      settler(2, JOB_BUILDER, null),
      settler(3, JOB_COLLECTOR, null),
      settler(4, JOB_BUILDER, null),
      settler(5, JOB_BUILDER, null),
      settler(6, JOB_BUILDER, null),
    ]);
    const settlers = [
      drawn(1, 1000, 1040),
      drawn(2, 1390, 1290), // just inside the window's corner
      drawn(3, 1010, 1010), // another trade
      drawn(4, 1410, 1000), // past the window's side
      drawn(5, 1000, 690), // past its top
      // 6 is a builder the frame did not draw, so it is no candidate at all
    ];

    expect(jobMatesAround(settlers, 1, CURSOR, snapshot, content)).toEqual([1, 2]);
  });

  it('counts every hero as one trade, and keeps soldiers apart from them', () => {
    // The sandbox catalog holds no hero trade; the served content names every one of them `hero*`.
    const withHeroes: ContentSet = {
      ...content,
      jobs: content.jobs.flatMap((job) =>
        job.typeId === JOB_WOMAN
          ? [
              job,
              { ...job, id: 'hero_unarmed', typeId: JOB_HERO_UNARMED },
              { ...job, id: 'heroine_bow_xena', typeId: JOB_HEROINE_BOW },
            ]
          : [job],
      ),
    };
    const snapshot = snapshotOf([
      settler(1, JOB_HERO_UNARMED, null),
      settler(2, JOB_HEROINE_BOW, null),
      settler(3, JOB_ARCHER, null),
    ]);
    const settlers = [drawn(1, 1000, 1000), drawn(2, 1100, 1000), drawn(3, 1200, 1000)];

    expect(jobMatesAround(settlers, 1, CURSOR, snapshot, withHeroes)).toEqual([1, 2]);
    expect(jobMatesAround(settlers, 3, CURSOR, snapshot, withHeroes)).toEqual([3]);
  });

  it('answers null for a click that did not land on a drawn settler', () => {
    const snapshot = snapshotOf([settler(1, JOB_BUILDER, null), settler(2, JOB_BUILDER, null)]);
    // 2 is selected but not drawn, like a settler picked through its house's door sign.
    expect(jobMatesAround([drawn(1, 1000, 1000)], 2, CURSOR, snapshot, content)).toBeNull();
  });
});
