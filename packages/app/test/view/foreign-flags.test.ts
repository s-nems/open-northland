import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { fixedViewerSeat, switchableViewerSeat } from '../../src/game/viewer-seat.js';
import { createForeignFlags } from '../../src/view/foreign-flags.js';

const OWN = 0;
const OTHER = 1;
const OWN_FLAG = 10;
const OTHER_FLAG = 11;
const CARRIER_FLAG = 12;
const STRAY_FLAG = 13;

const holder = (id: number, flag: number, binding: 'WorkFlag' | 'HaulFlag', player?: number) => ({
  id,
  components: {
    ...(player === undefined ? {} : { Owner: { player } }),
    [binding]: { flag, radius: 1 },
  },
});

function snapshot(): WorldSnapshot {
  return {
    tick: 0,
    events: [],
    entities: [
      { id: OWN_FLAG, components: { DeliveryFlag: {} } },
      { id: OTHER_FLAG, components: { DeliveryFlag: {} } },
      { id: CARRIER_FLAG, components: { DeliveryFlag: {} } },
      { id: STRAY_FLAG, components: { DeliveryFlag: {} } },
      holder(20, OWN_FLAG, 'WorkFlag', OWN),
      holder(21, OTHER_FLAG, 'WorkFlag', OTHER),
      holder(22, CARRIER_FLAG, 'HaulFlag', OTHER),
      holder(23, STRAY_FLAG, 'WorkFlag'),
    ],
  };
}

describe('foreign work flags', () => {
  it("hides another seat's gatherer and carrier flags, never the viewer's own or an ownerless one", () => {
    const hidden = createForeignFlags(fixedViewerSeat(OWN))(snapshot());
    expect(hidden).toEqual(new Set([OTHER_FLAG, CARRIER_FLAG]));
  });

  it('shows every flag on the whole map', () => {
    expect(createForeignFlags(switchableViewerSeat(null))(snapshot()).size).toBe(0);
  });

  it('keeps one set while nothing changes and follows a seat switch', () => {
    const viewer = switchableViewerSeat(OWN);
    const foreign = createForeignFlags(viewer);
    const snap = snapshot();
    const first = foreign(snap);
    expect(foreign(snap)).toBe(first);
    viewer.watch(OTHER);
    expect([...foreign(snap)]).toEqual([OWN_FLAG]);
  });
});
