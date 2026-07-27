import { fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR, JOB_SCOUT } from '../src/catalog/jobs.js';
import { selectionCentre } from '../src/view/unit-controls/action-ring/selection-centre.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

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
});
