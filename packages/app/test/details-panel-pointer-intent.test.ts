import type { EntitySnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR } from '../src/catalog/jobs.js';
import {
  BUILDING_HEADQUARTERS,
  GOOD_BREAD,
  GOOD_PLANK,
  GOOD_SHOES,
  GOOD_STONE,
} from '../src/game/sandbox/ids/index.js';
import type { UnitPanelModel } from '../src/hud/details-panel/index.js';
import {
  NO_PANEL_HOVER,
  panelClickAt,
  panelHoverAt,
  sameHover,
} from '../src/hud/details-panel/pointer-intent.js';
import type { PanelView } from '../src/hud/details-panel/selection-view.js';
import { center, panelModelOf, viewOfKind } from './support/details-panel.js';
import { buildingEntity } from './support/sandbox.js';

const NO_TOGGLE = false;
const TOGGLE = true;
const SETTLER_ID = 1;

const gathererSettler: EntitySnapshot = {
  id: SETTLER_ID,
  components: {
    Settler: { tribe: 1, jobType: JOB_COLLECTOR },
    WorkFlag: { flag: 2, radius: 24, goodType: GOOD_STONE },
  },
};

const bootedSettler: EntitySnapshot = {
  id: SETTLER_ID,
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
};

const signpost: EntitySnapshot = { id: 7, components: { Signpost: {} } };

/** A settler view spliced to offer two craft products under the all-mode default selection. No sandbox
 *  workplace declares two recipes, and one product collapses both click modes onto all-mode - so this is
 *  the only shape where a plain click and a Ctrl/Cmd click differ. */
function twoProductCrafterView(): Extract<PanelView, { kind: 'settler' }> {
  const model = panelModelOf({
    id: SETTLER_ID,
    components: { Settler: { tribe: 1, jobType: JOB_COLLECTOR } },
  });
  if (model.kind !== 'settler') throw new Error('expected a settler model');
  const spliced: UnitPanelModel = {
    ...model,
    work: {
      ...model.work,
      craftChoices: [
        { goodType: GOOD_PLANK, label: 'A' },
        { goodType: GOOD_BREAD, label: 'B' },
      ],
      selectedCraftGoods: [GOOD_PLANK, GOOD_BREAD],
    },
  };
  return viewOfKind(spliced, 'settler');
}

describe('details panel click intents', () => {
  it('resolves a gather choice into a gather order for the selected settler', () => {
    const view = viewOfKind(panelModelOf(gathererSettler), 'settler');
    const choice = view.layout.gatherChoiceHits[0];
    if (choice === undefined) throw new Error('expected a gather choice');
    const p = center(choice.rect);

    expect(panelClickAt(view, p.x, p.y, NO_TOGGLE)).toEqual({
      kind: 'setGatherGood',
      entityId: SETTLER_ID,
      goodType: choice.goodType,
    });
  });

  it('threads the toggle modifier into the craft selection a click produces', () => {
    const view = twoProductCrafterView();
    const second = view.layout.craftChoiceHits[1];
    if (second === undefined) throw new Error('expected two craft choices');
    const p = center(second.rect);

    // Plain click keeps only the clicked product; Ctrl/Cmd toggles it out of the all-mode selection.
    expect(panelClickAt(view, p.x, p.y, NO_TOGGLE)).toEqual({
      kind: 'setCraftGoods',
      entityId: SETTLER_ID,
      goods: [GOOD_BREAD],
    });
    expect(panelClickAt(view, p.x, p.y, TOGGLE)).toEqual({
      kind: 'setCraftGoods',
      entityId: SETTLER_ID,
      goods: [GOOD_PLANK],
    });
  });

  it('resolves the equip and take-off buttons of one slot into their own orders', () => {
    const view = viewOfKind(panelModelOf(bootedSettler), 'settler');
    const swap = view.layout.equipActionHits.find((h) => h.kind === 'swap');
    const off = view.layout.equipActionHits.find((h) => h.kind === 'unequip');
    if (swap === undefined || off === undefined) throw new Error('expected the worn slot buttons');

    const sp = center(swap.rect);
    expect(panelClickAt(view, sp.x, sp.y, NO_TOGGLE)).toEqual({
      kind: 'equipSlot',
      entityId: SETTLER_ID,
      ref: swap.ref,
    });
    const op = center(off.rect);
    expect(panelClickAt(view, op.x, op.y, NO_TOGGLE)).toEqual({
      kind: 'unequipSlot',
      entityId: SETTLER_ID,
      ref: off.ref,
    });
  });

  it('resolves a building stock tab click into that tab', () => {
    const view = viewOfKind(panelModelOf(buildingEntity(1, BUILDING_HEADQUARTERS)), 'building');
    const tab = view.layout.stockTabHits[2];
    if (tab === undefined) throw new Error('expected a stock tab strip');
    const p = center(tab);

    expect(panelClickAt(view, p.x, p.y, NO_TOGGLE)).toEqual({ kind: 'stockTab', tab: 2 });
  });

  it('resolves the demolish button of a building and of a signpost into their own orders', () => {
    const building = viewOfKind(panelModelOf(buildingEntity(3, BUILDING_HEADQUARTERS)), 'building');
    const demolish = building.layout.buttons.find((b) => b.action === 'demolish');
    if (demolish === undefined) throw new Error('expected a demolish button');
    const bp = center(demolish.rect);
    expect(panelClickAt(building, bp.x, bp.y, NO_TOGGLE)).toEqual({ kind: 'demolish', entityId: 3 });

    const sign = viewOfKind(panelModelOf(signpost), 'signpost');
    const sp = center(sign.layout.button.rect);
    expect(panelClickAt(sign, sp.x, sp.y, NO_TOGGLE)).toEqual({ kind: 'demolishSignpost', entityId: 7 });
  });

  it('resolves nothing for a disabled button or a point on inert chrome', () => {
    const view = viewOfKind(panelModelOf(buildingEntity(1, BUILDING_HEADQUARTERS)), 'building');
    const help = view.layout.buttons.find((b) => b.action === 'help');
    if (help === undefined || help.enabled) throw new Error('expected an unwired help button');
    const hp = center(help.rect);

    expect(panelClickAt(view, hp.x, hp.y, NO_TOGGLE)).toBeNull();
    expect(panelClickAt(view, view.layout.panel.x - 50, view.layout.panel.y - 50, NO_TOGGLE)).toBeNull();
  });
});

describe('details panel hover state', () => {
  it('reports the hovered equip button, and nothing off the fields', () => {
    const view = viewOfKind(panelModelOf(bootedSettler), 'settler');
    const off = view.layout.equipActionHits.find((h) => h.kind === 'unequip');
    if (off === undefined) throw new Error('expected a take-off button');
    const p = center(off.rect);

    const hover = panelHoverAt(view, p.x, p.y);
    expect(hover.equipAction).toBe(`${off.ref.group}:${off.ref.slot}:unequip`);
    expect(hover.action).toBeNull();
    expect(sameHover(hover, NO_PANEL_HOVER)).toBe(false);

    const far = panelHoverAt(view, view.layout.panel.x - 50, view.layout.panel.y - 50);
    expect(sameHover(far, NO_PANEL_HOVER)).toBe(true);
  });

  it('keeps the gather-all button distinct from hovering no choice at all', () => {
    const view = viewOfKind(panelModelOf(gathererSettler), 'settler');
    const all = view.layout.gatherChoiceHits.find((h) => h.goodType === null);
    if (all === undefined) throw new Error('expected the gather-all choice');
    const p = center(all.rect);

    const hover = panelHoverAt(view, p.x, p.y);
    expect(hover.choiceGood).toBeNull();
    expect(sameHover(hover, NO_PANEL_HOVER)).toBe(false);
  });
});
