import { type EntitySnapshot, ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  BUILDING_FARM,
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  GOOD_STONE,
  JOB_COLLECTOR,
} from '../src/game/sandbox/ids/index.js';
import { buildUnitPanelModel, type StockRow, type UnitPanelModel } from '../src/hud/details-panel/index.js';
import {
  type BuildingLayout,
  type DetailsLayout,
  MAX_STOCK_ROWS,
  mapLayout,
  type SettlerLayout,
  stockSlotRects,
} from '../src/hud/details-panel/layout/index.js';
import { type PanelView, panelViewFor } from '../src/hud/details-panel/selection-view.js';
import { ALL_STOCK_TAB, visibleStockRows } from '../src/hud/details-panel/stock-tabs.js';
import type { Rect } from '../src/hud/geometry.js';
import { buildingEntity, sandboxCtx, snapshotOf } from './support/sandbox.js';

/** The watchtower (`tower_00`, catalog typeId 40) — a store-less building (declares no stock slots). */
const BUILDING_TOWER = 40;

const SCREEN = { width: 1600, height: 1200 };

function viewOfKind<K extends PanelView['kind']>(model: UnitPanelModel, kind: K, s = 1) {
  const view = panelViewFor(model, SCREEN, s);
  if (view.kind !== kind) throw new Error(`expected a ${kind} view, got ${view.kind}`);
  return view as Extract<PanelView, { kind: K }>;
}

const buildingLayoutOf = (model: UnitPanelModel): BuildingLayout => viewOfKind(model, 'building').layout;
const settlerLayoutOf = (model: UnitPanelModel): SettlerLayout => viewOfKind(model, 'settler').layout;

describe('details panel layout', () => {
  it('pairs every selection kind with the geometry laid out for it', () => {
    const modelOf = (ids: number[], entities: EntitySnapshot[]): UnitPanelModel =>
      buildUnitPanelModel(snapshotOf(entities), new Set(ids), sandboxCtx());
    const settler = (id: number): EntitySnapshot => ({
      id,
      components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR } },
    });

    expect(panelViewFor(modelOf([], []), SCREEN, 1).kind).toBe('empty');
    expect(viewOfKind(modelOf([1], [buildingEntity(1, BUILDING_FARM)]), 'building').model.kind).toBe(
      'building',
    );
    expect(viewOfKind(modelOf([1], [settler(1)]), 'settler').model.kind).toBe('settler');
    expect(
      viewOfKind(modelOf([1], [{ id: 1, components: { Signpost: { player: 1 } } }]), 'signpost').model.kind,
    ).toBe('signpost');
    // Both multi-select kinds share the one compact strip — the pairing the type keeps and the reason
    // the discriminant is the layout's kind, not the model's.
    expect(viewOfKind(modelOf([1, 2], [settler(1), settler(2)]), 'compact').model.kind).toBe('multi-settler');
  });

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
    const layout = settlerLayoutOf(model);
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
    const farm = buildingLayoutOf(buildingModel(BUILDING_FARM));
    expect(farm.stockCompact).toBe(true);
    expect(farm.stockRows).toBe(1);
    expect(farm.stockTabHits).toHaveLength(0);
    expect(farm.stock).not.toBeNull();

    // The HQ's full catalog → the original fixed-height tabbed store.
    const hq = buildingLayoutOf(buildingModel(BUILDING_HEADQUARTERS));
    expect(hq.stockCompact).toBe(false);
    expect(hq.stockRows).toBe(MAX_STOCK_ROWS);
    expect(hq.stockTabHits.length).toBeGreaterThan(0);

    // A home stocks its family larder (the two foods) → a compact tab-less store, like the farm.
    const home = buildingLayoutOf(buildingModel(BUILDING_HOME_00));
    expect(home.stock).not.toBeNull();
    expect(home.stockCompact).toBe(true);
    expect(home.stockTabHits).toHaveLength(0);

    // A watchtower stores nothing → no Magazyn window at all, and the panel is SHORTER than the farm's.
    const tower = buildingLayoutOf(buildingModel(BUILDING_TOWER));
    expect(tower.stock).toBeNull();
    expect(tower.stockTabHits).toHaveLength(0);
    expect(tower.panel.h).toBeLessThan(farm.panel.h);
    expect(farm.panel.h).toBeLessThan(hq.panel.h);
  });

  it('swaps to the Construction window while a site rises — no production/stock sections', () => {
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
    const site = buildingLayoutOf(model);
    expect(site.construction).not.toBeNull();
    expect(site.production).toBeNull();
    expect(site.stock).toBeNull();
    expect(site.stockTabHits).toHaveLength(0);
    // The workers window STAYS — it shows the live building crew during construction.
    expect(site.workers).not.toBeNull();
  });

  /** The rect every mapped field must have become — no real layout rect can carry these coords. */
  const SENTINEL: Rect = { x: -1, y: -1, w: -1, h: -1 };

  const isRect = (v: object): v is Rect =>
    ['x', 'y', 'w', 'h'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number');

  /** Every rect reachable in a layout, with the field path that led to it (so a miss names itself). */
  function collectRects(node: unknown, path: string, out: Array<{ path: string; rect: Rect }>): void {
    if (node === null || typeof node !== 'object') return;
    if (isRect(node)) {
      out.push({ path, rect: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        collectRects(v, `${path}[${i}]`, out);
      });
      return;
    }
    for (const [key, v] of Object.entries(node)) collectRects(v, `${path}.${key}`, out);
  }

  it('mapLayout transforms EVERY rect in a layout (an unmapped new field fails here)', () => {
    const modelOf = (entity: EntitySnapshot): UnitPanelModel =>
      buildUnitPanelModel(snapshotOf([entity]), new Set([entity.id]), sandboxCtx());
    // The HQ (tabbed store + buttons), a farm site (the Construction branch) and a gatherer settler —
    // between them every optional section a layout can carry is present.
    const layouts: readonly DetailsLayout[] = [
      buildingLayoutOf(modelOf(buildingEntity(1, BUILDING_HEADQUARTERS))),
      buildingLayoutOf(
        modelOf(
          buildingEntity(1, BUILDING_FARM, {
            built: 0,
            components: { UnderConstruction: { labor: 0 }, Stockpile: { amounts: [] } },
          }),
        ),
      ),
      settlerLayoutOf(
        modelOf({
          id: 1,
          components: {
            Settler: { tribe: 1, jobType: JOB_COLLECTOR },
            WorkFlag: { flag: 2, radius: 24, goodType: GOOD_STONE },
          },
        }),
      ),
    ];

    for (const layout of layouts) {
      const found: Array<{ path: string; rect: Rect }> = [];
      collectRects(
        mapLayout(layout, () => SENTINEL),
        layout.kind,
        found,
      );
      expect(found.length).toBeGreaterThan(0); // the walk must actually reach rects
      const untransformed = found.filter(({ rect }) => rect.x !== SENTINEL.x || rect.w !== SENTINEL.w);
      // A rect `mapLayout` misses passes through at hit-space coords onto a texture re-origined to (0,0).
      expect(untransformed.map(({ path }) => path)).toEqual([]);
    }
  });
});
