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
    const first = visible({ generation: 1, player: 0 });
    expect(first).toEqual([{ cells: [{ col: SEEN_COL, row: ROW }] }]);
    const cellsPerPass = filtered;

    expect(visible({ generation: 1, player: 0 })).toBe(first);
    expect(filtered).toBe(cellsPerPass);

    expect(visible({ generation: 2, player: 0 })).not.toBe(first);
    expect(filtered).toBe(2 * cellsPerPass);

    source = [...PLOTS];
    visible({ generation: 2, player: 0 });
    expect(filtered).toBe(3 * cellsPerPass);
  });

  it('filters again when the fog changes seat under one list and generation', () => {
    // Each seat sees one column; a spectator switching seats under a paused sim changes neither the
    // list nor the generation.
    let seat = 0;
    const visible = createVisiblePlots(
      () => PLOTS,
      (col) => col === (seat === 0 ? SEEN_COL : HIDDEN_COL),
    );
    const first = visible({ generation: 1, player: 0 });
    expect(first).toEqual([{ cells: [{ col: SEEN_COL, row: ROW }] }]);
    seat = 1;
    expect(visible({ generation: 1, player: 1 })).toEqual([
      { cells: [{ col: HIDDEN_COL, row: ROW }] },
      { cells: [{ col: HIDDEN_COL, row: ROW + 2 }] },
    ]);
  });
});
