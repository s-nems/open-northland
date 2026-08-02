import { type EntitySnapshot, ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR } from '../src/catalog/jobs.js';
import { BUILDING_HEADQUARTERS, GOOD_SHOES, GOOD_STONE } from '../src/game/sandbox/ids/index.js';
import {
  hitButton,
  hitCraftChoice,
  hitEquipAction,
  hitGatherChoice,
  hitPortrait,
  hitStockTab,
  nextCraftGoods,
  tooltipTextAt,
} from '../src/hud/details-panel/hit-test.js';
import { stockSlotRects } from '../src/hud/details-panel/layout/index.js';
import {
  ALL_STOCK_TAB,
  detailsStockTabLabels,
  visibleStockRows,
} from '../src/hud/details-panel/stock-tabs.js';
import { messages } from '../src/i18n/index.js';
import { center, panelModelOf as modelOf, viewOfKind } from './support/details-panel.js';
import { buildingEntity } from './support/sandbox.js';

const SCALE = 1;

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

  it('reports the portrait box entity, and carries no hover text over it', () => {
    const settler = viewOfKind(modelOf(gathererSettler), 'settler');
    const sp = center(settler.layout.preview);

    expect(hitPortrait(settler, sp.x, sp.y)).toBe(gathererSettler.id);
    // The box is a live world cutout - a chip over it would cover the settler it exists to show.
    expect(tooltipTextAt(settler, sp.x, sp.y, SCALE, ALL_STOCK_TAB)).toBeNull();
    // The name line sits beside the box, not in it - a hover there must not read as the portrait.
    const beside = center(settler.layout.name);
    expect(hitPortrait(settler, beside.x, beside.y)).toBeNull();

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

  it('routes the equip action buttons and names them (with the worn good) in the tooltip', () => {
    const view = viewOfKind(
      modelOf({
        id: 1,
        components: {
          Settler: { tribe: 1, jobType: JOB_COLLECTOR },
          Equipment: {
            boots: { goodType: GOOD_SHOES, degreeOfUse: 0 },
            tool: null,
            weapon: null,
            armor: null,
            misc: [null, null, null, null],
          },
        },
      }),
      'settler',
    );
    const hud = messages().hud;

    const swap = view.layout.equipActionHits.find((h) => h.kind === 'swap');
    const off = view.layout.equipActionHits.find((h) => h.kind === 'unequip');
    const equip = view.layout.equipActionHits.find((h) => h.kind === 'equip');
    if (swap === undefined || off === undefined || equip === undefined)
      throw new Error('expected all three equip action kinds');

    const sp = center(swap.rect);
    expect(hitEquipAction(view, sp.x, sp.y)).toBe(swap);
    expect(tooltipTextAt(view, sp.x, sp.y, SCALE, ALL_STOCK_TAB)).toBe(`${hud.swapSlotHint}\n${swap.label}`);

    const op = center(off.rect);
    expect(hitEquipAction(view, op.x, op.y)).toBe(off);
    expect(tooltipTextAt(view, op.x, op.y, SCALE, ALL_STOCK_TAB)).toBe(
      `${hud.unequipSlotHint}\n${off.label}`,
    );

    // An empty slot's equip button carries no item name - just the order hint.
    const ep = center(equip.rect);
    expect(hitEquipAction(view, ep.x, ep.y)).toBe(equip);
    expect(tooltipTextAt(view, ep.x, ep.y, SCALE, ALL_STOCK_TAB)).toBe(hud.equipSlotHint);

    // Hovering a worn socket names the item with its remaining-condition percent; an empty socket names nothing.
    const bootsSocket = view.layout.equipRows[0]?.slots[0];
    const bootsSlot = view.model.equipmentRows[0]?.slots[0];
    if (bootsSocket === undefined || bootsSlot?.label === undefined)
      throw new Error('expected the worn boots socket');
    const wp = center(bootsSocket);
    expect(tooltipTextAt(view, wp.x, wp.y, SCALE, ALL_STOCK_TAB)).toBe(
      `${bootsSlot.label} (${bootsSlot.conditionPct}%)`,
    );
    const toolSocket = view.layout.equipRows[1]?.slots[0];
    if (toolSocket === undefined) throw new Error('expected the empty tool socket');
    const np = center(toolSocket);
    expect(tooltipTextAt(view, np.x, np.y, SCALE, ALL_STOCK_TAB)).toBeNull();
  });

  it('warns on the swap/take-off buttons when the worn item is part-used (the discard rule)', () => {
    const view = viewOfKind(
      modelOf({
        id: 1,
        components: {
          Settler: { tribe: 1, jobType: JOB_COLLECTOR },
          Equipment: {
            boots: { goodType: GOOD_SHOES, degreeOfUse: ONE / 2 },
            tool: null,
            weapon: null,
            armor: null,
            misc: [null, null, null, null],
          },
        },
      }),
      'settler',
    );
    const hud = messages().hud;
    const swap = view.layout.equipActionHits.find((h) => h.kind === 'swap');
    const off = view.layout.equipActionHits.find((h) => h.kind === 'unequip');
    if (swap === undefined || off === undefined) throw new Error('expected the worn slot buttons');
    const sp = center(swap.rect);
    expect(tooltipTextAt(view, sp.x, sp.y, SCALE, ALL_STOCK_TAB)).toBe(
      `${hud.swapSlotHint}\n${swap.label}\n${hud.usedItemDiscardHint}`,
    );
    const op = center(off.rect);
    expect(tooltipTextAt(view, op.x, op.y, SCALE, ALL_STOCK_TAB)).toBe(
      `${hud.unequipSlotHint}\n${off.label}\n${hud.usedItemDiscardHint}`,
    );
  });

  it('reports no target or tooltip for a point outside every field', () => {
    const view = viewOfKind(modelOf(gathererSettler), 'settler');
    const far = { x: view.layout.panel.x - 50, y: view.layout.panel.y - 50 };

    expect(hitButton(view, far.x, far.y)).toBeNull();
    expect(hitGatherChoice(view, far.x, far.y)).toBeUndefined();
    expect(tooltipTextAt(view, far.x, far.y, SCALE, ALL_STOCK_TAB)).toBeNull();
  });
});

describe('nextCraftGoods', () => {
  const PRODUCTS = [10, 20, 30];

  it('replaces the selection with just the clicked product on a plain click', () => {
    expect(nextCraftGoods(PRODUCTS, [20], 30, false)).toEqual([30]);
  });

  it('replaces with all-mode when the worker makes only one product (it cannot craft nothing)', () => {
    expect(nextCraftGoods([10], [], 10, false)).toEqual([]);
  });

  it('toggles a product into the multi-set, keeping product order', () => {
    expect(nextCraftGoods(PRODUCTS, [30], 10, true)).toEqual([10, 30]);
  });

  it('toggles a product out of the multi-set', () => {
    expect(nextCraftGoods(PRODUCTS, [10, 20], 20, true)).toEqual([10]);
  });

  it('normalizes toggling the last product off to all-mode', () => {
    expect(nextCraftGoods(PRODUCTS, [20], 20, true)).toEqual([]);
  });

  it('normalizes toggling every product on to all-mode', () => {
    expect(nextCraftGoods(PRODUCTS, [10, 20], 30, true)).toEqual([]);
  });
});
