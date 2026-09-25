import { type EntitySnapshot, ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR } from '../src/catalog/jobs.js';
import {
  BUILDING_FARM,
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  BUILDING_HOME_02,
} from '../src/game/sandbox/ids/index.js';
import { buildUnitPanelModel, type StockRow, type UnitPanelModel } from '../src/hud/details-panel/index.js';
import {
  type BuildingLayout,
  type DetailsLayout,
  MAX_STOCK_ROWS,
  mapLayout,
  stockSlotRects,
} from '../src/hud/details-panel/layout/index.js';
import { panelViewFor } from '../src/hud/details-panel/selection-view.js';
import { ALL_STOCK_TAB, visibleStockRows } from '../src/hud/details-panel/stock-tabs.js';
import type { Rect } from '../src/hud/geometry.js';
import { MIN_UI_SCALE, UI_SCALE_FACTOR_MAX, uiScaleFor } from '../src/hud/ui-scale.js';
import { PANEL_SCREEN, viewOfKind } from './support/details-panel.js';
import { buildingEntity, sandboxCtx, snapshotOf } from './support/sandbox.js';

/** The watchtower (`tower_00`, catalog typeId 40) - a store-less building (declares no stock slots). */
const BUILDING_TOWER = 40;
const BUILDING_BARRACKS = 39;

/** Representative effective scales across the reachable range: the floor, sub-1 tracking, 1×, the
 *  capped base a tall window lands on, and that base at the slider maximum. The last entry only a
 *  `?uiscale` pin reaches, and it keeps the widest layouts under test. Metrics round per scale, so
 *  the fractional anchors are the ones that catch collisions. */
const SWEEP_UISCALES = [
  MIN_UI_SCALE,
  0.9,
  1,
  uiScaleFor(1080),
  uiScaleFor(1080, UI_SCALE_FACTOR_MAX),
  2.8125,
];

const buildingLayoutOf = (model: UnitPanelModel): BuildingLayout => viewOfKind(model, 'building').layout;

describe('details panel layout', () => {
  it('pairs every selection kind with the geometry laid out for it', () => {
    const modelOf = (ids: number[], entities: EntitySnapshot[]): UnitPanelModel =>
      buildUnitPanelModel(snapshotOf(entities), new Set(ids), sandboxCtx());
    const settler = (id: number): EntitySnapshot => ({
      id,
      components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR } },
    });

    expect(panelViewFor(modelOf([], []), PANEL_SCREEN, 1).kind).toBe('empty');
    expect(viewOfKind(modelOf([1], [buildingEntity(1, BUILDING_FARM)]), 'building').model.kind).toBe(
      'building',
    );
    // A single settler is the DOM settler panel's: this panel leaves it blank.
    expect(panelViewFor(modelOf([1], [settler(1)]), PANEL_SCREEN, 1).kind).toBe('empty');
    expect(
      viewOfKind(modelOf([1], [{ id: 1, components: { Signpost: { player: 1 } } }]), 'signpost').model.kind,
    ).toBe('signpost');
    // Both multi-select kinds share the one compact strip - the pairing the type keeps and the reason
    // the discriminant is the layout's kind, not the model's.
    expect(viewOfKind(modelOf([1, 2], [settler(1), settler(2)]), 'compact').model.kind).toBe('multi-settler');
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

    // A watchtower keeps the garrison's larder (food + mead, `logicstock 16 25` / `43 25`) → a compact
    // tab-less store like the home's.
    const tower = buildingLayoutOf(buildingModel(BUILDING_TOWER));
    expect(tower.stock).not.toBeNull();
    expect(tower.stockCompact).toBe(true);
    expect(tower.stockTabHits).toHaveLength(0);

    // The barracks stores nothing → no Magazyn window at all, and the panel is SHORTER than the farm's.
    const barracks = buildingLayoutOf(buildingModel(BUILDING_BARRACKS));
    expect(barracks.stock).toBeNull();
    expect(barracks.stockTabHits).toHaveLength(0);
    expect(barracks.panel.h).toBeLessThan(farm.panel.h);
    expect(farm.panel.h).toBeLessThan(hq.panel.h);
  });

  it('leads the Obrona row with the alarm toggle, centred on the line its status text sits on', () => {
    const model = buildUnitPanelModel(
      snapshotOf([buildingEntity(1, BUILDING_TOWER)]),
      new Set([1]),
      sandboxCtx(),
    );
    for (const s of SWEEP_UISCALES) {
      const layout = viewOfKind(model, 'building', s).layout;
      const body = layout.defence?.body;
      const toggle = layout.defenceToggle?.rect;
      if (body === undefined || toggle === undefined) throw new Error(`no defence row at ×${s}`);
      const at = `×${s}`;
      expect(toggle.x, at).toBe(body.x); // leads the row: the status text follows it, never the reverse
      expect(toggle.w, at).toBe(toggle.h); // round, like the equip controls it copies
      // The section sets the status text on the toggle's own centre line, so the pair is level by
      // construction; what the layout owes is a toggle centred in the row (within the integer-px round).
      expect(Math.abs(toggle.y + toggle.h / 2 - (body.y + body.h / 2)), at).toBeLessThanOrEqual(1);
    }
  });

  it('places three compact home-equipment controls above residents without text overlap', () => {
    const model = buildUnitPanelModel(
      snapshotOf([
        buildingEntity(1, BUILDING_HOME_02, {
          components: {
            Building: { buildingType: BUILDING_HOME_02, tribe: 1, built: ONE, level: 2 },
          },
        }),
      ]),
      new Set([1]),
      sandboxCtx(),
    );
    for (const s of SWEEP_UISCALES) {
      const layout = viewOfKind(model, 'building', s).layout;
      const section = layout.homeQuality;
      if (section === null) throw new Error('expected the home equipment section');
      expect(layout.homeQualityRows).toHaveLength(3);
      expect(section.frame.y + section.frame.h).toBeLessThanOrEqual(layout.workers.frame.y);
      for (const row of layout.homeQualityRows) {
        expect(row.text.x + row.text.w).toBeLessThanOrEqual(row.button.rect.x);
        expect(row.button.rect.x + row.button.rect.w).toBeLessThanOrEqual(section.body.x + section.body.w);
        expect(row.button.rect.y + row.button.rect.h).toBeLessThanOrEqual(section.body.y + section.body.h);
      }
    }
  });

  it('swaps to the Construction window while a site rises - no production/stock sections', () => {
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
              Health: { hitpoints: 1, max: 100 },
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
    // The workers window STAYS - it shows the live building crew during construction.
    expect(site.workers).not.toBeNull();
  });

  it('spans the building health gauge across the whole right column, at every uiscale', () => {
    const model = buildUnitPanelModel(
      snapshotOf([
        buildingEntity(1, BUILDING_FARM, { components: { Health: { hitpoints: 300, max: 1000 } } }),
      ]),
      new Set([1]),
      sandboxCtx(),
    );
    // Each metric rounds independently per scale, so a row that clears its neighbours at 1× can still
    // collide at another step - the sweep is what proves the gap, not the design-px constants.
    for (const s of SWEEP_UISCALES) {
      const layout = viewOfKind(model, 'building', s).layout;
      const health = layout.health;
      const firstButton = layout.buttons[0];
      if (firstButton === undefined) throw new Error('expected the general-section buttons');

      // Full column width: the gauge spans exactly the name line above and the buttons below, edge to
      // edge - it carries no label column, so any narrower rect is a regression.
      expect(health.x, `uiscale ${s}`).toBe(layout.name.x);
      expect(health.w, `uiscale ${s}`).toBe(layout.name.w);
      expect(health.w, `uiscale ${s}`).toBe(firstButton.rect.w);
      // Clear of both neighbours - below the name, and never swallowing a button click.
      expect(health.y, `uiscale ${s}`).toBeGreaterThanOrEqual(layout.name.y + layout.name.h);
      expect(health.y + health.h, `uiscale ${s}`).toBeLessThanOrEqual(firstButton.rect.y);
      // And inside the general window it is drawn into.
      expect(health.y + health.h, `uiscale ${s}`).toBeLessThanOrEqual(
        layout.general.body.y + layout.general.body.h,
      );
    }
  });

  /** The rect every mapped field must have become - no real layout rect can carry these coords. */
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
    // The HQ (tabbed store + buttons + the Zdrowie row) and a farm site (the Construction branch) -
    // between them every optional section a layout can carry is present.
    const layouts: readonly DetailsLayout[] = [
      buildingLayoutOf(
        modelOf(
          buildingEntity(1, BUILDING_HEADQUARTERS, {
            components: { Health: { hitpoints: 300, max: 1000 } },
          }),
        ),
      ),
      buildingLayoutOf(
        modelOf(
          buildingEntity(1, BUILDING_FARM, {
            built: 0,
            components: { UnderConstruction: { labor: 0 }, Stockpile: { amounts: [] } },
          }),
        ),
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
