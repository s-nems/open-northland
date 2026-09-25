import { describe, expect, it } from 'vitest';
import { BUILDING_HEADQUARTERS } from '../src/game/sandbox/ids/index.js';
import { hitButton, hitPortrait, hitStockTab, tooltipTextAt } from '../src/hud/details-panel/hit-test.js';
import { stockSlotRects } from '../src/hud/details-panel/layout/index.js';
import {
  ALL_STOCK_TAB,
  detailsStockTabLabels,
  visibleStockRows,
} from '../src/hud/details-panel/stock-tabs.js';
import { center, panelModelOf as modelOf, viewOfKind } from './support/details-panel.js';
import { buildingEntity } from './support/sandbox.js';

const SCALE = 1;

describe('details panel hit-testing', () => {
  it('reports the portrait box entity, and carries no hover text over it', () => {
    const building = viewOfKind(modelOf(buildingEntity(1, BUILDING_HEADQUARTERS)), 'building');
    const bp = center(building.layout.preview);
    expect(hitPortrait(building, bp.x, bp.y)).toBe(1);
    expect(tooltipTextAt(building, bp.x, bp.y, SCALE, ALL_STOCK_TAB)).toBeNull();
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

  it('reads the hitpoints off a hovered health bar - the building gauge naming itself', () => {
    const HEALTH = { hitpoints: 300, max: 1000 };

    const building = viewOfKind(
      modelOf(buildingEntity(1, BUILDING_HEADQUARTERS, { components: { Health: HEALTH } })),
      'building',
    );
    const bp = center(building.layout.health);
    // The building gauge is drawn bare, so its tooltip carries the caption - hovering an unnamed bar
    // must not answer with a bare number pair.
    expect(tooltipTextAt(building, bp.x, bp.y, SCALE, ALL_STOCK_TAB)).toBe('Zdrowie: 300/1000');
    // The row is a hover target only - it must not steal a click from the buttons below it.
    expect(hitButton(building, bp.x, bp.y)).toBeNull();
  });

  it('reports no target or tooltip for a point outside every field', () => {
    const view = viewOfKind(modelOf(buildingEntity(1, BUILDING_HEADQUARTERS)), 'building');
    const far = { x: view.layout.panel.x - 50, y: view.layout.panel.y - 50 };

    expect(hitButton(view, far.x, far.y)).toBeNull();
    expect(tooltipTextAt(view, far.x, far.y, SCALE, ALL_STOCK_TAB)).toBeNull();
  });
});
