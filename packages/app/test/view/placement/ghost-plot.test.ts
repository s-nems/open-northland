import { describe, expect, it } from 'vitest';
import { makeGhostPlotAt } from '../../../src/view/placement/ghost-plot.js';

const HOUSE = 7;
const VIKING = 1;
const FOOTPRINT = {
  blocked: [
    { dx: 0, dy: 0 },
    { dx: -1, dy: 1 },
  ],
  familyBody: [],
  reserved: [],
  door: { dx: 0, dy: 1 },
  workArea: [],
};

describe('makeGhostPlotAt', () => {
  it('translates the body and the door onto the anchor, an odd row shifting its odd offsets east', () => {
    const plotAt = makeGhostPlotAt(() => FOOTPRINT);

    expect(plotAt(HOUSE, VIKING, 10, 4)).toEqual({
      cells: [
        { col: 10, row: 4 },
        { col: 9, row: 5 },
      ],
      door: { col: 10, row: 5 },
    });
    expect(plotAt(HOUSE, VIKING, 10, 5)).toEqual({
      cells: [
        { col: 10, row: 5 },
        { col: 10, row: 6 },
      ],
      door: { col: 11, row: 6 },
    });
  });

  it('adds the ground the later levels grow onto, only where they outgrow the body', () => {
    const grownBody = [...FOOTPRINT.blocked, { dx: 1, dy: 0 }];
    const grows = makeGhostPlotAt(() => ({ ...FOOTPRINT, familyBody: grownBody }));
    const same = makeGhostPlotAt(() => ({ ...FOOTPRINT, familyBody: FOOTPRINT.blocked }));

    expect(grows(HOUSE, VIKING, 10, 4)?.grown).toEqual([
      { col: 10, row: 4 },
      { col: 9, row: 5 },
      { col: 11, row: 4 },
    ]);
    expect(same(HOUSE, VIKING, 10, 4)?.grown).toBeUndefined();
  });

  it('hands the same plot back while the cursor rests on a node', () => {
    const plotAt = makeGhostPlotAt(() => FOOTPRINT);

    expect(plotAt(HOUSE, VIKING, 10, 4)).toBe(plotAt(HOUSE, VIKING, 10, 4));
  });

  it('marks no plot for a type whose footprint blocks nothing', () => {
    expect(makeGhostPlotAt(() => undefined)(HOUSE, VIKING, 10, 4)).toBeUndefined();
    expect(makeGhostPlotAt(() => ({ ...FOOTPRINT, blocked: [] }))(HOUSE, VIKING, 10, 4)).toBeUndefined();
  });
});
