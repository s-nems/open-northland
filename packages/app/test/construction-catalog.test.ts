import { describe, expect, it } from 'vitest';
import { type MenuBuildingEntry, OPEN_AVAILABILITY } from '../src/hud/tool-panel/building-menu.js';
import {
  availabilityKey,
  costSlots,
  partitionCatalogue,
  tabCounts,
} from '../src/hud/tool-panel/construction-catalog.js';

const WOOD = 3;
const STONE = 4;

const entry = (
  typeId: number,
  kind: string,
  availability?: MenuBuildingEntry['availability'],
): MenuBuildingEntry => ({
  typeId,
  label: `#${typeId}`,
  kind,
  cost: [
    { goodType: WOOD, amount: 2 },
    { goodType: STONE, amount: 1 },
  ],
  ...(availability === undefined ? {} : { availability }),
});

describe('construction catalogue', () => {
  it('lists the open entries first and the locked ones after, both in catalogue order; a ban is dropped', () => {
    const entries = [
      entry(23, 'workplace', () => ({ kind: 'locked' })),
      entry(12, 'workplace'),
      entry(47, 'wonder', () => ({ kind: 'forbidden' })),
      entry(2, 'home', () => OPEN_AVAILABILITY),
      entry(40, 'tower', () => ({ kind: 'locked' })),
    ];
    const partition = partitionCatalogue(entries);
    expect(partition.open.map((row) => row.entry.typeId)).toEqual([12, 2]);
    expect(partition.locked.map((row) => row.entry.typeId)).toEqual([23, 40]);
    expect(partition.open.map((row) => row.category)).toEqual(['work', 'home']);
    expect(partition.locked[0]?.availability).toEqual({ kind: 'locked' });
  });

  it('keys the partition on membership, so a discovery or a ban re-sorts and a tick does not', () => {
    let open = false;
    let banned = false;
    const entries = [
      entry(23, 'workplace', () =>
        banned ? { kind: 'forbidden' } : open ? OPEN_AVAILABILITY : { kind: 'locked' },
      ),
      entry(12, 'workplace'),
    ];
    const before = availabilityKey(partitionCatalogue(entries));
    expect(availabilityKey(partitionCatalogue(entries))).toBe(before);
    open = true;
    const discovered = availabilityKey(partitionCatalogue(entries));
    expect(discovered).not.toBe(before);
    banned = true;
    expect(availabilityKey(partitionCatalogue(entries))).not.toBe(discovered);
  });

  it('counts the buildable entries per tab, every one under all', () => {
    const { open } = partitionCatalogue([
      entry(12, 'workplace'),
      entry(2, 'home'),
      entry(7, 'storage'),
      entry(40, 'tower'),
      entry(39, 'training'),
      entry(23, 'workplace', () => ({ kind: 'locked' })),
    ]);
    expect(tabCounts(open)).toEqual({ all: 5, work: 1, storage: 1, home: 1, military: 2 });
  });

  it('marks a cost line short when the seat holds less than it needs, and never gates on it', () => {
    const stock = new Map([[WOOD, 1]]);
    const slots = costSlots(entry(12, 'workplace').cost, (goodType) => stock.get(goodType) ?? 0);
    expect(slots).toEqual([
      { goodType: WOOD, amount: 2, have: 1, short: true },
      { goodType: STONE, amount: 1, have: 0, short: true },
    ]);
    stock.set(WOOD, 2);
    stock.set(STONE, 5);
    expect(
      costSlots(entry(12, 'workplace').cost, (goodType) => stock.get(goodType) ?? 0).map((s) => s.short),
    ).toEqual([false, false]);
  });
});
