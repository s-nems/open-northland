import { FOG_MODE, FOG_STATE, fogViewOfMask } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { type Sight, UnseenChanges, ViewSight } from '../../../src/data/fog/sight.js';

/** A sight that steps by hand, naming the cells each step opened. */
function steppedSight(): Sight & { step(opened: readonly number[] | null): void } {
  let revision = 0;
  let opened: readonly number[] | null = null;
  return {
    seesNode: () => false,
    cellOfNode: () => 0,
    get revision() {
      return revision;
    },
    get newlyVisible() {
      return opened;
    },
    step: (cells) => {
      opened = cells;
      revision++;
    },
  };
}

describe('UnseenChanges', () => {
  it('names only the changes under the cells a sight step opened, every change after a missed step', () => {
    const sight = steppedSight();
    const waiting = new UnseenChanges<string>();
    waiting.add('tree', 4);
    waiting.add('road', 9);
    expect(waiting.opened(sight)).toEqual(['tree', 'road']); // the first look knows no earlier sight
    expect(waiting.opened(sight)).toEqual([]); // a sight that holds opens nothing
    sight.step([9, 12]);
    expect(waiting.opened(sight)).toEqual(['road']);
    sight.step([4]);
    sight.step([]);
    expect(waiting.opened(sight)).toEqual(['tree', 'road']);
    waiting.delete('road');
    waiting.add('tree', 7);
    sight.step([4, 7]);
    expect(waiting.opened(sight)).toEqual(['tree']);
    expect(waiting.size).toBe(1);
  });
});

describe('ViewSight', () => {
  const CELLS_WIDE = 4;
  const maskView = (visible: readonly number[], generation: number) => {
    const mask = new Uint8Array(CELLS_WIDE * CELLS_WIDE).fill(FOG_STATE.EXPLORED);
    for (const cell of visible) mask[cell] = FOG_STATE.VISIBLE;
    return fogViewOfMask({
      player: 0,
      mode: FOG_MODE.CLASSIC_FOG_OF_WAR,
      cellsWide: CELLS_WIDE,
      cellsHigh: CELLS_WIDE,
      generation,
      mask,
    });
  };

  it('sees nothing before the first view, then everything with fog off, moving its revision', () => {
    const sight = new ViewSight();
    const before = sight.revision;
    expect(sight.seesNode(0, 0)).toBe(false);
    sight.set(null);
    expect(sight.seesNode(0, 0)).toBe(true);
    expect(sight.revision).not.toBe(before);
    const known = sight.revision;
    sight.set(null);
    expect(sight.revision).toBe(known);
  });

  it('names the cells a mask step turned visible, and none it cannot diff', () => {
    const sight = new ViewSight();
    sight.set(maskView([1], 1));
    expect(sight.newlyVisible).toBeNull(); // the first view says nothing about what was seen before
    sight.set(maskView([2, 5], 2));
    expect(sight.newlyVisible).toEqual([2, 5]);
    sight.set(null);
    expect(sight.newlyVisible).toBeNull();
  });
});
