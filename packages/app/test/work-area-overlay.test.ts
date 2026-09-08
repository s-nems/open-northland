import { ONE } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createWorkAreaOverlay } from '../src/view/unit-controls/work-area.js';
import { snapshotOf } from './support/snapshot.js';

/** The "Show Work Area" toggle: a circle per shown gatherer, resolved against the live snapshot. */
const FLAG = 40;
const RADIUS = 24;

const gatherer = (id: number, flag?: number): { id: number; components: Record<string, unknown> } => ({
  id,
  components: {
    Settler: { jobType: 1, tribe: 1 },
    Position: { x: id * ONE, y: id * ONE },
    ...(flag === undefined ? {} : { WorkFlag: { flag, radius: RADIUS } }),
  },
});

const world: WorldSnapshot = snapshotOf([gatherer(1, FLAG), gatherer(2)]);

describe('createWorkAreaOverlay', () => {
  it('draws a circle around the shown flag and hides it on a second click', () => {
    const overlay = createWorkAreaOverlay();
    expect(overlay.rings(world)).toEqual([]);

    overlay.toggle([1]);
    expect(overlay.rings(world)).toEqual([{ entity: FLAG, radiusNodes: RADIUS }]);

    overlay.toggle([1]);
    expect(overlay.rings(world)).toEqual([]);
  });

  it('draws nothing for a gatherer that carries no flag, and nothing once it is gone', () => {
    const overlay = createWorkAreaOverlay();
    overlay.toggle([2]);
    expect(overlay.rings(world)).toEqual([]);

    overlay.toggle([1]);
    expect(overlay.rings(snapshotOf([gatherer(2)]))).toEqual([]); // the shown gatherer left the snapshot
  });
});
