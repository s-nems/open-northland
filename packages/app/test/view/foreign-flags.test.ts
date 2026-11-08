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
const RALLY_FLAG = 14;

const holder = (id: number, flag: number, binding: 'WorkFlag' | 'HaulFlag', player?: number) => ({
  id,
  components: {
    ...(player === undefined ? {} : { Owner: { player } }),
    [binding]: { flag, radius: 1 },
  },
});

const barracks = (id: number, flag: number, player: number) => ({
  id,
  components: {
    Owner: { player },
    RallyPoint: { flag },
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
      { id: RALLY_FLAG, components: { DeliveryFlag: {} } },
      holder(20, OWN_FLAG, 'WorkFlag', OWN),
      holder(21, OTHER_FLAG, 'WorkFlag', OTHER),
      holder(22, CARRIER_FLAG, 'HaulFlag', OTHER),
      holder(23, STRAY_FLAG, 'WorkFlag'),
      barracks(30, RALLY_FLAG, OWN),
      barracks(31, RALLY_FLAG, OTHER),
    ],
  };
}

describe('foreign work flags', () => {
  it(
    "hides another seat's gatherer and carrier flags, and every rally flag without a selection, never " +
      "the viewer's own or an ownerless one",
    () => {
      const hidden = createForeignFlags(fixedViewerSeat(OWN))(snapshot());
      expect(hidden).toEqual(new Set([OTHER_FLAG, CARRIER_FLAG, RALLY_FLAG]));
    },
  );

  it('shows every flag on the whole map once the selection names the rally barracks', () => {
    const selection = { ids: () => new Set<number>([30, 31]), version: () => 0 };
    expect(createForeignFlags(switchableViewerSeat(null), selection)(snapshot()).size).toBe(0);
  });

  it('keeps one set while nothing changes and follows a seat switch', () => {
    const viewer = switchableViewerSeat(OWN);
    const foreign = createForeignFlags(viewer);
    const snap = snapshot();
    const first = foreign(snap);
    expect(foreign(snap)).toBe(first);
    viewer.watch(OTHER);
    expect([...foreign(snap)]).toEqual([OWN_FLAG, RALLY_FLAG]);
  });

  it('hides every rally flag unless its own selected barracks shows it', () => {
    const snap = snapshot();
    const hiddenFor = (ids: ReadonlySet<number> | undefined) => {
      const foreign =
        ids === undefined
          ? createForeignFlags(fixedViewerSeat(OWN))
          : createForeignFlags(fixedViewerSeat(OWN), { ids: () => ids, version: () => 0 });
      return [...foreign(snap)];
    };
    expect(hiddenFor(new Set([30]))).toEqual([OTHER_FLAG, CARRIER_FLAG]); // its own, selected: shows
    expect(hiddenFor(new Set([20]))).toEqual([OTHER_FLAG, CARRIER_FLAG, RALLY_FLAG]); // not selected
    // Another seat's rally flag stays foreign under any selection.
    expect(hiddenFor(new Set([31]))).toEqual([OTHER_FLAG, CARRIER_FLAG, RALLY_FLAG]);
    // No selection passed, none to show a rally flag by: every one of them hides.
    expect(hiddenFor(undefined)).toEqual([OTHER_FLAG, CARRIER_FLAG, RALLY_FLAG]);
  });

  it('rebuilds the set when the selection changes inside one tick', () => {
    const snap = snapshot();
    let ids = new Set<number>([30]);
    let version = 0;
    const foreign = createForeignFlags(fixedViewerSeat(OWN), {
      ids: () => ids,
      version: () => version,
    });
    expect(foreign(snap).has(RALLY_FLAG)).toBe(false);
    ids = new Set<number>();
    version++;
    expect(foreign(snap).has(RALLY_FLAG)).toBe(true);
  });
});
