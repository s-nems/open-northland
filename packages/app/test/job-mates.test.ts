import type { ContentSet } from '@open-northland/data';
import type { EntityBounds } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import {
  JOB_ARCHER,
  JOB_BUILDER,
  JOB_COLLECTOR,
  JOB_HERO_UNARMED,
  JOB_HEROINE_BOW,
  JOB_SOLDIER_SWORD,
  JOB_WOMAN,
} from '../src/catalog/jobs.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import type { Pickable } from '../src/view/picking.js';
import { jobMateArea, jobMatesIn } from '../src/view/unit-controls/job-mates.js';
import { settler, snapshotOf } from './support/snapshot.js';

const content = sandboxContent();

const drawn = (ref: number, x: number, y: number, box?: EntityBounds): Pickable => ({
  ref,
  x,
  y,
  kind: 'settler',
  box,
});

describe('double-click job mates', () => {
  const AREA = { minX: 600, minY: 700, maxX: 1400, maxY: 1300 };

  it('gathers the clicked trade whose sprite touches the area', () => {
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
      drawn(2, 1400, 1300), // feet on the area's corner, no bounds
      drawn(3, 1010, 1010), // another trade
      drawn(4, 1450, 1000, { minX: 1430, minY: 930, maxX: 1470, maxY: 1000 }), // wholly past the side
      // Feet past the bottom, but drawn up a hill with its body inside.
      drawn(5, 1000, 1360, { minX: 980, minY: 1250, maxX: 1020, maxY: 1320 }),
      // 6 is a builder the frame did not draw, so it is no candidate at all
    ];

    expect(jobMatesIn(settlers, 1, AREA, snapshot, content)).toEqual([1, 2, 5]);
  });

  it('grows the screen by the same screen-px margin at every zoom', () => {
    const MARGIN = 96;
    const SCREEN = { width: 1280, height: 800 };
    for (const scale of [0.5, 1, 2]) {
      const camera = { offsetX: -100, offsetY: -50, scale };
      const area = jobMateArea(camera, SCREEN.width, SCREEN.height);
      const toScreenX = (x: number): number => x * scale + camera.offsetX;
      const toScreenY = (y: number): number => y * scale + camera.offsetY;
      expect([
        toScreenX(area.minX),
        toScreenX(area.maxX),
        toScreenY(area.minY),
        toScreenY(area.maxY),
      ]).toEqual([-MARGIN, SCREEN.width + MARGIN, -MARGIN, SCREEN.height + MARGIN]);
    }
  });

  it('counts every soldier as one trade whatever the weapon, and every hero as another', () => {
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
      settler(4, JOB_SOLDIER_SWORD, null),
      settler(5, JOB_BUILDER, null),
    ]);
    const settlers = [1, 2, 3, 4, 5].map((ref) => drawn(ref, 900 + ref * 50, 1000));

    expect(jobMatesIn(settlers, 1, AREA, snapshot, withHeroes)).toEqual([1, 2]);
    expect(jobMatesIn(settlers, 3, AREA, snapshot, withHeroes)).toEqual([3, 4]);
  });

  it('answers null for a click that did not land on a drawn settler', () => {
    const snapshot = snapshotOf([settler(1, JOB_BUILDER, null), settler(2, JOB_BUILDER, null)]);
    // 2 is selected but not drawn, like a settler picked through its house's door sign.
    expect(jobMatesIn([drawn(1, 1000, 1000)], 2, AREA, snapshot, content)).toBeNull();
  });
});
