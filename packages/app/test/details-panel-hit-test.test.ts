import type { EntitySnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { BUILDING_HEADQUARTERS, GOOD_STONE, JOB_COLLECTOR } from '../src/game/sandbox/ids/index.js';
import {
  hitButton,
  hitCraftChoice,
  hitGatherChoice,
  hitStockTab,
  tooltipTextAt,
} from '../src/hud/details-panel/hit-test.js';
import { buildUnitPanelModel, type UnitPanelModel } from '../src/hud/details-panel/index.js';
import { stockSlotRects } from '../src/hud/details-panel/layout/index.js';
import { type PanelView, panelViewFor } from '../src/hud/details-panel/selection-view.js';
import {
  ALL_STOCK_TAB,
  detailsStockTabLabels,
  visibleStockRows,
} from '../src/hud/details-panel/stock-tabs.js';
import type { Rect } from '../src/hud/geometry.js';
import { buildingEntity, sandboxCtx, snapshotOf } from './support/sandbox.js';

const SCREEN = { width: 1600, height: 1200 };
const SCALE = 1;

const center = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

function viewOfKind<K extends PanelView['kind']>(
  model: UnitPanelModel,
  kind: K,
): Extract<PanelView, { kind: K }> {
  const view = panelViewFor(model, SCREEN, SCALE);
  if (view.kind !== kind) throw new Error(`expected a ${kind} view, got ${view.kind}`);
  return view as Extract<PanelView, { kind: K }>;
}

const modelOf = (entity: EntitySnapshot): UnitPanelModel =>
  buildUnitPanelModel(snapshotOf([entity]), new Set([entity.id]), sandboxCtx());

const gathererSettler: EntitySnapshot = {
  id: 1,
  components: {
    Settler: { tribe: 1, jobType: JOB_COLLECTOR },
    WorkFlag: { flag: 2, radius: 24, goodType: GOOD_STONE },
  },
};

describe('details panel hit-testing', () => {
  it('names a gather choice by its label and reports its good under the same point', () => {
    const view = viewOfKind(modelOf(gathererSettler), 'settler');
    const choice = view.layout.gatherChoiceHits[0];
    if (choice === undefined) throw new Error('expected a gather choice');
    const p = center(choice.rect);

    expect(hitGatherChoice(view, p.x, p.y)).toBe(choice.goodType);
    expect(hitCraftChoice(view, p.x, p.y)).toBeUndefined();
    expect(tooltipTextAt(view, p.x, p.y, SCALE, ALL_STOCK_TAB)).toBe(choice.label);
  });

  it('routes a building button and names its stock tab', () => {
    const view = viewOfKind(modelOf(buildingEntity(1, BUILDING_HEADQUARTERS)), 'building');

    const button = view.layout.buttons[0];
    if (button === undefined) throw new Error('expected a building button');
    const bp = center(button.rect);
    expect(hitButton(view, bp.x, bp.y)).toBe(button);

    const tab = view.layout.stockTabHits[2];
    if (tab === undefined) throw new Error('expected a stock tab strip');
    const tp = center(tab);
    expect(hitStockTab(view, tp.x, tp.y)).toBe(2);
    expect(tooltipTextAt(view, tp.x, tp.y, SCALE, ALL_STOCK_TAB)).toBe(detailsStockTabLabels()[2]);
  });

  it('names a held stock good under its slot, ahead of the tab label', () => {
    // Fill the HQ's first accepted slot so a stock row is drawn; hovering it must resolve to the good's
    // name, not the tab it sits under (the rowName-wins branch of tooltipTextAt).
    const accepted = viewOfKind(modelOf(buildingEntity(1, BUILDING_HEADQUARTERS)), 'building').model.stock[0]
      ?.goodType;
    if (accepted === undefined) throw new Error('expected an accepted stock slot');
    const view = viewOfKind(
      modelOf(
        buildingEntity(1, BUILDING_HEADQUARTERS, { components: { Stockpile: { amounts: [[accepted, 5]] } } }),
      ),
      'building',
    );
    if (view.layout.stock === null) throw new Error('expected a stock window');

    const slot = stockSlotRects(view.layout.stock.body, SCALE, view.layout.stockRows)[0];
    const heldLabel = visibleStockRows(view.model.stock, view.layout.stockCompact, ALL_STOCK_TAB)[0]?.label;
    if (slot === undefined || heldLabel === undefined) throw new Error('expected a held stock row');
    const p = center(slot);
    expect(tooltipTextAt(view, p.x, p.y, SCALE, ALL_STOCK_TAB)).toBe(heldLabel);
  });

  it('reports no target or tooltip for a point outside every field', () => {
    const view = viewOfKind(modelOf(gathererSettler), 'settler');
    const far = { x: view.layout.panel.x - 50, y: view.layout.panel.y - 50 };

    expect(hitButton(view, far.x, far.y)).toBeNull();
    expect(hitGatherChoice(view, far.x, far.y)).toBeUndefined();
    expect(tooltipTextAt(view, far.x, far.y, SCALE, ALL_STOCK_TAB)).toBeNull();
  });
});
