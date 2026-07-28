import { fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR, JOB_SCOUT } from '../src/catalog/jobs.js';
import { selectionCentre } from '../src/view/unit-controls/action-ring/selection-centre.js';
import { type Ent, snapshotOf, visitCountingSnapshot } from './support/snapshot.js';

const TRIBE = 1;

const standing = (id: number, x: number, y: number, jobType = JOB_COLLECTOR): Ent => ({
  id,
  components: {
    Settler: { tribe: TRIBE, jobType },
    Position: { x: fx.fromInt(x), y: fx.fromInt(y) },
  },
});

const world = snapshotOf([standing(1, 2, 2), standing(2, 6, 2), standing(3, 20, 20, JOB_SCOUT)]);

describe('selectionCentre', () => {
  it('averages the selected settlers and reports their shared trade', () => {
    const two = selectionCentre(world, new Set([1, 2]));
    const one = selectionCentre(world, new Set([1]));
    if (two === null || one === null) throw new Error('expected a centre for a live selection');

    expect(two.ids).toEqual([1, 2]);
    expect(two.jobType).toBe(JOB_COLLECTOR);
    // Two settlers on the same row: the centroid sits between them, on that row.
    expect(two.y).toBe(one.y);
    expect(two.x).toBeGreaterThan(one.x);
  });

  it('reports no shared trade for a mixed selection, and nothing at all for an empty one', () => {
    expect(selectionCentre(world, new Set([1, 3]))?.jobType).toBeUndefined();
    expect(selectionCentre(world, new Set())).toBeNull();
    expect(selectionCentre(world, new Set([99]))).toBeNull();
  });

  it('reports ids ascending whatever order they were clicked in', () => {
    expect(selectionCentre(world, new Set([3, 1, 2]))?.ids).toEqual([1, 2, 3]);
    // A selected id with no live entity drops out instead of shifting the rest.
    expect(selectionCentre(world, new Set([3, 99, 1]))?.ids).toEqual([1, 3]);
    // Click order must not reach the centroid either: the same settlers sum in the same order.
    expect(selectionCentre(world, new Set([2, 1]))).toEqual(selectionCentre(world, new Set([1, 2])));
  });

  it('costs the selection, not the map: a two-settler ring never walks a crowded snapshot', () => {
    const ROW = 64;
    const crowd = snapshotOf(
      Array.from({ length: 4096 }, (_unused, i) => standing(i + 1, i % ROW, Math.floor(i / ROW))),
    );
    const counted = visitCountingSnapshot(crowd);

    const centre = selectionCentre(counted.snapshot, new Set([4000, 7]));

    expect(centre?.ids).toEqual([7, 4000]);
    // Two binary searches, measured at 19 entities; walking the world would hand out all 4096.
    expect(counted.visits()).toBeLessThan(crowd.entities.length / 8);
  });
});
