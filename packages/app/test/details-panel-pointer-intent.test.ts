import type { EntitySnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR } from '../src/catalog/jobs.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
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

/** A tradesman posted to a workplace and living nowhere - three of the four Praca controls live. */
const postedSettler: EntitySnapshot = {
  id: SETTLER_ID,
  components: {
    Settler: { tribe: 1, jobType: JOB_COLLECTOR },
    JobAssignment: { workplace: 9 },
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

  it('resolves each live Praca control into its own order, and skips the dead ones', () => {
    const view = viewOfKind(panelModelOf(postedSettler), 'settler');
    const intents = view.layout.workControls.map((control) => {
      const p = center(control.button.rect);
      return [control.action, panelClickAt(view, p.x, p.y, NO_TOGGLE)] as const;
    });

    expect(intents).toEqual([
      ['assign-workplace', { kind: 'assignWorkplace', entityId: SETTLER_ID }],
      ['unassign-workplace', { kind: 'unassignWorkplace', entityId: SETTLER_ID }],
      ['assign-home', { kind: 'assignHome', entityId: SETTLER_ID }],
      // No Residence, so remove-from-home is drawn dimmed and its click resolves to nothing.
      ['unassign-home', null],
    ]);
  });

  it('resolves a click on the portrait box into a re-centre on the entity it shows', () => {
    const settler = viewOfKind(panelModelOf(gathererSettler), 'settler');
    const sp = center(settler.layout.preview);
    expect(panelClickAt(settler, sp.x, sp.y, NO_TOGGLE)).toEqual({
      kind: 'centerOnEntity',
      entityId: SETTLER_ID,
    });

    const building = viewOfKind(panelModelOf(buildingEntity(4, BUILDING_HEADQUARTERS)), 'building');
    const bp = center(building.layout.preview);
    expect(panelClickAt(building, bp.x, bp.y, NO_TOGGLE)).toEqual({
      kind: 'centerOnEntity',
      entityId: 4,
    });

    // The building's own Wycentruj button is the same intent, reached by its label instead of the box.
    const button = building.layout.buttons.find((b) => b.action === 'center');
    if (button === undefined || !button.enabled) throw new Error('expected a live center button');
    const cp = center(button.rect);
    expect(panelClickAt(building, cp.x, cp.y, NO_TOGGLE)).toEqual({
      kind: 'centerOnEntity',
      entityId: 4,
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

  it('resolves the defence toggle into the order that flips the alarm the other way', () => {
    const down = viewOfKind(panelModelOf(buildingEntity(5, BUILDING_HEADQUARTERS)), 'building');
    const toggle = down.layout.defenceToggle;
    if (toggle === null) throw new Error('expected a defence toggle on the headquarters');
    const p = center(toggle.rect);
    expect(panelClickAt(down, p.x, p.y, NO_TOGGLE)).toEqual({
      kind: 'setDefenceMode',
      entityId: 5,
      enabled: true,
    });

    const up = viewOfKind(
      panelModelOf(buildingEntity(5, BUILDING_HEADQUARTERS, { components: { DefenceMode: {} } })),
      'building',
    );
    expect(panelClickAt(up, p.x, p.y, NO_TOGGLE)).toEqual({
      kind: 'setDefenceMode',
      entityId: 5,
      enabled: false,
    });
  });

  it('resolves each home-equipment button into the inverse use policy', () => {
    const allowed = viewOfKind(panelModelOf(buildingEntity(5, BUILDING_HOME_00)), 'building');
    const cooking = allowed.layout.homeQualityRows.find((row) => row.effect === 'cooking');
    if (cooking === undefined) throw new Error('expected a crockery policy button');
    const p = center(cooking.button.rect);
    expect(panelClickAt(allowed, p.x, p.y, NO_TOGGLE)).toEqual({
      kind: 'setHomeQualityUse',
      entityId: 5,
      effect: 'cooking',
      allowed: false,
    });

    const forbidden = viewOfKind(
      panelModelOf(
        buildingEntity(5, BUILDING_HOME_00, {
          components: { HomeQualityPolicy: { cooking: false, rest: true, piety: true } },
        }),
      ),
      'building',
    );
    expect(panelClickAt(forbidden, p.x, p.y, NO_TOGGLE)).toEqual({
      kind: 'setHomeQualityUse',
      entityId: 5,
      effect: 'cooking',
      allowed: true,
    });
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

it('a technology-locked upgrade is visible but cannot submit a command', () => {
  const model = panelModelOf(buildingEntity(1, BUILDING_HOME_00));
  if (model.kind !== 'building') throw new Error('Expected building panel');
  const locked = viewOfKind({ ...model, upgradeBlockedReason: 'Requires collector' }, 'building');
  const button = locked.layout.buttons.find((b) => b.action === 'upgrade');
  if (button === undefined) throw new Error('Missing upgrade control');
  const at = center(button.rect);
  expect(button.enabled).toBe(false);
  expect(panelClickAt(locked, at.x, at.y, false)).toBeNull();
  const open = viewOfKind({ ...model, upgradeBlockedReason: null }, 'building');
  expect(panelClickAt(open, at.x, at.y, false)).toEqual({ kind: 'upgrade', entityId: 1 });
});
