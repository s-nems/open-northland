import { ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  BUILDING_FARM,
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  GOOD_STONE,
  JOB_COLLECTOR,
} from '../src/game/sandbox/ids/index.js';
import { buildUnitPanelModel, type StockRow, type UnitPanelModel } from '../src/hud/details-panel/index.js';
import { layoutDetails, MAX_STOCK_ROWS, stockSlotRects } from '../src/hud/details-panel/layout/index.js';
import { ALL_STOCK_TAB, visibleStockRows } from '../src/hud/details-panel/stock-tabs.js';
import { sandboxCtx } from './support/sandbox.js';

describe('details panel layout', () => {
  it('lays every gather filter as a clickable Praca button with the current good selected', () => {
    const model = buildUnitPanelModel(
      {
        tick: 0,
        events: [],
        entities: [
          {
            id: 1,
            components: {
              Settler: { tribe: 1, jobType: JOB_COLLECTOR },
              WorkFlag: { flag: 2, radius: 24, goodType: GOOD_STONE },
            },
          },
        ],
      },
      new Set([1]),
      sandboxCtx(),
    );
    const layout = layoutDetails(model, { width: 1600, height: 1200 }, 1);
    if (layout?.kind !== 'settler') throw new Error('expected a settler layout');
    expect(layout.gatherChoiceHits).toHaveLength(7);
    expect(
      layout.gatherChoiceHits.filter((choice) => choice.selected).map((choice) => choice.goodType),
    ).toEqual([GOOD_STONE]);
  });

  it('lays the stock grid as MAX_STOCK_ROWS×2 column-major cells inside the body (draw == hit geometry)', () => {
    const body = { x: 10, y: 100, w: 200, h: 132 };
    const slots = stockSlotRects(body, 1);
    expect(slots).toHaveLength(MAX_STOCK_ROWS * 2);
    // Column-major: the first MAX_STOCK_ROWS fill the left column (shared x), the rest the right column.
    expect(slots[0]?.x).toBe(body.x);
    expect(slots[MAX_STOCK_ROWS - 1]?.x).toBe(body.x);
    expect(slots[MAX_STOCK_ROWS]?.x).toBeGreaterThan(body.x); // right column starts further right
    // Rows descend within a column, and every cell stays inside the body.
    expect(slots[1]?.y).toBeGreaterThan(slots[0]?.y ?? 0);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(body.x);
      expect(s.x + s.w).toBeLessThanOrEqual(body.x + body.w + 1); // +1 for integer rounding
      expect(s.y + s.h).toBeLessThanOrEqual(body.y + body.h + 1);
    }
  });

  it('the "Wszystkie" stock tab lists only held goods, fullest first; category tabs shift by one', () => {
    const row = (goodType: number, category: number, amount: number): StockRow => ({
      goodType,
      label: `g${goodType}`,
      amount,
      category,
    });
    const stock = [row(1, 2, 0), row(2, 2, 5), row(3, 5, 9), row(4, 0, 0), row(5, 2, 5)];
    // ALL tab: zeros hidden, descending by amount, equal amounts keep declared order (stable).
    expect(visibleStockRows(stock, false, ALL_STOCK_TAB).map((r) => r.goodType)).toEqual([3, 2, 5]);
    // A category tab is its category's slots (details tab = category + 1), held goods bubbled up.
    expect(visibleStockRows(stock, false, 2 + 1).map((r) => r.goodType)).toEqual([2, 5, 1]);
    // A compact store ignores tabs and keeps the declared slot order.
    expect(visibleStockRows(stock, true, ALL_STOCK_TAB).map((r) => r.goodType)).toEqual([1, 2, 3, 4, 5]);
  });

  it('lays a small store out compact (no tabs, fitted rows) and drops Magazyn for a store-less building', () => {
    const screen = { width: 1600, height: 1200 };
    const buildingModel = (typeId: number): UnitPanelModel =>
      buildUnitPanelModel(
        {
          tick: 0,
          events: [],
          entities: [
            { id: 1, components: { Building: { buildingType: typeId, tribe: 1, built: ONE, level: 0 } } },
          ],
        },
        new Set([1]),
        sandboxCtx(),
      );

    // The farm's single wheat slot → the compact tab-less body, one fitted row per column pair.
    const farm = layoutDetails(buildingModel(BUILDING_FARM), screen, 1);
    if (farm?.kind !== 'building') throw new Error('expected a building layout');
    expect(farm.stockCompact).toBe(true);
    expect(farm.stockRows).toBe(1);
    expect(farm.stockTabHits).toHaveLength(0);
    expect(farm.stock).not.toBeNull();

    // The HQ's full catalog → the original fixed-height tabbed store.
    const hq = layoutDetails(buildingModel(BUILDING_HEADQUARTERS), screen, 1);
    if (hq?.kind !== 'building') throw new Error('expected a building layout');
    expect(hq.stockCompact).toBe(false);
    expect(hq.stockRows).toBe(MAX_STOCK_ROWS);
    expect(hq.stockTabHits.length).toBeGreaterThan(0);

    // A home stores nothing → no Magazyn window at all, and the panel is SHORTER than the farm's.
    const home = layoutDetails(buildingModel(BUILDING_HOME_00), screen, 1);
    if (home?.kind !== 'building') throw new Error('expected a building layout');
    expect(home.stock).toBeNull();
    expect(home.stockTabHits).toHaveLength(0);
    expect(home.panel.h).toBeLessThan(farm.panel.h);
    expect(farm.panel.h).toBeLessThan(hq.panel.h);
  });

  it('swaps to the Construction window while a site rises — no production/stock sections', () => {
    const screen = { width: 1600, height: 1200 };
    const model = buildUnitPanelModel(
      {
        tick: 0,
        events: [],
        entities: [
          {
            id: 1,
            components: {
              Building: { buildingType: BUILDING_FARM, tribe: 1, built: 0, level: 0 },
              UnderConstruction: { labor: 0 },
              Stockpile: { amounts: [] },
            },
          },
        ],
      },
      new Set([1]),
      sandboxCtx(),
    );
    const site = layoutDetails(model, screen, 1);
    if (site?.kind !== 'building') throw new Error('expected a building layout');
    expect(site.construction).not.toBeNull();
    expect(site.production).toBeNull();
    expect(site.stock).toBeNull();
    expect(site.stockTabHits).toHaveLength(0);
    // The workers window STAYS — it shows the live building crew during construction.
    expect(site.workers).not.toBeNull();
  });
});
