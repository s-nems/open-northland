import type { ConstructionPlot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createVisiblePlots } from '../src/view/runtime/visible-plots.js';

const SEEN_COL = 4;
const HIDDEN_COL = 9;
const ROW = 2;

const PLOTS: readonly ConstructionPlot[] = [
  {
    cells: [
      { col: SEEN_COL, row: ROW },
      { col: HIDDEN_COL, row: ROW },
    ],
  },
  { cells: [{ col: HIDDEN_COL, row: ROW + 2 }] },
];

describe('createVisiblePlots', () => {
  it('hands fog-off frames the sim list itself', () => {
    const visible = createVisiblePlots(
      () => PLOTS,
      () => false,
    );
    expect(visible(null)).toBe(PLOTS);
  });

  it('drops hidden cells and emptied plots, and filters again only on a new list or fog generation', () => {
    let filtered = 0;
    let source = PLOTS;
    const visible = createVisiblePlots(
      () => source,
      (col) => {
        filtered++;
        return col === SEEN_COL;
      },
    );
    const first = visible({ generation: 1 });
    expect(first).toEqual([{ cells: [{ col: SEEN_COL, row: ROW }] }]);
    const cellsPerPass = filtered;

    expect(visible({ generation: 1 })).toBe(first);
    expect(filtered).toBe(cellsPerPass);

    expect(visible({ generation: 2 })).not.toBe(first);
    expect(filtered).toBe(2 * cellsPerPass);

    source = [...PLOTS];
    visible({ generation: 2 });
    expect(filtered).toBe(3 * cellsPerPass);
  });
});
