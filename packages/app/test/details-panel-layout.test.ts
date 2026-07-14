import { ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { BUILDING_FARM, BUILDING_HEADQUARTERS, BUILDING_HOME_00 } from '../src/game/sandbox/ids/index.js';
import { buildUnitPanelModel, type StockRow, type UnitPanelModel } from '../src/hud/details-panel/index.js';
import { layoutDetails, MAX_STOCK_ROWS, stockSlotRects } from '../src/hud/details-panel/layout/index.js';
import { defaultStockTab } from '../src/hud/details-panel/panel.js';
import { sandboxCtx } from './support/sandbox.js';

describe('details panel layout', () => {
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

  it('opens a building on the FIRST (lowest-index) category that holds any of its goods', () => {
    const row = (category: number): StockRow => ({ goodType: category, label: 'g', amount: 0, category });
    const building = (stock: StockRow[]): UnitPanelModel =>
      ({ kind: 'building', stock }) as unknown as UnitPanelModel;
    // The panel opens on the lowest tab that has goods, regardless of which category is fullest.
    expect(defaultStockTab(building([row(2), row(2), row(2), row(5)]))).toBe(2);
    // A general store holding goods across many tabs opens on the leading one (tab 0).
    expect(defaultStockTab(building([row(5), row(0), row(7), row(7), row(7)]))).toBe(0);
    // No stock → tab 0.
    expect(defaultStockTab(building([]))).toBe(0);
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

  it('swaps to the Construction window while a site rises — no production/stock/workers sections', () => {
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
    expect(site.workers).toBeNull();
  });
});
