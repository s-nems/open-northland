import { describe, expect, it } from 'vitest';
import { applyPanelClick, type PanelClickActions } from '../src/hud/details-panel/click-actions.js';
import type { EquipSlotRef } from '../src/hud/details-panel/index.js';
import type { PanelClick } from '../src/hud/details-panel/pointer-intent.js';

const ENTITY = 7;
const BOOTS_SLOT: EquipSlotRef = { group: 'boots', slot: 0 };

type Call = readonly [name: string, ...args: unknown[]];

const recorder =
  (calls: Call[]) =>
  (name: string) =>
  (...args: unknown[]): void => {
    calls.push([name, ...args]);
  };

/** Only the handlers a bare host must wire; every optional one is left off. */
function requiredActions(calls: Call[]): PanelClickActions {
  const record = recorder(calls);
  return {
    onDemolish: record('onDemolish'),
    onUpgrade: record('onUpgrade'),
    onCancelUpgrade: record('onCancelUpgrade'),
    onDemolishSignpost: record('onDemolishSignpost'),
    onSetDefenceMode: record('onSetDefenceMode'),
    onSetHomeQualityUse: record('onSetHomeQualityUse'),
    onSetGatherGood: record('onSetGatherGood'),
    onSetCraftGoods: record('onSetCraftGoods'),
    onCenterOnEntity: record('onCenterOnEntity'),
  };
}

function recordingActions(calls: Call[]): PanelClickActions {
  const record = recorder(calls);
  return {
    ...requiredActions(calls),
    onAssignWorkplace: record('onAssignWorkplace'),
    onUnassignWorkplace: record('onUnassignWorkplace'),
    onAssignHome: record('onAssignHome'),
    onUnassignHome: record('onUnassignHome'),
    onEquipSlot: record('onEquipSlot'),
    onUnequipSlot: record('onUnequipSlot'),
  };
}

const ROUTES: readonly (readonly [PanelClick, Call])[] = [
  [{ kind: 'centerOnEntity', entityId: ENTITY }, ['onCenterOnEntity', ENTITY]],
  [{ kind: 'setGatherGood', entityId: ENTITY, goodType: null }, ['onSetGatherGood', ENTITY, null]],
  [{ kind: 'setCraftGoods', entityId: ENTITY, goods: [3, 4] }, ['onSetCraftGoods', ENTITY, [3, 4]]],
  [{ kind: 'equipSlot', entityId: ENTITY, ref: BOOTS_SLOT }, ['onEquipSlot', ENTITY, BOOTS_SLOT]],
  [{ kind: 'unequipSlot', entityId: ENTITY, ref: BOOTS_SLOT }, ['onUnequipSlot', ENTITY, BOOTS_SLOT]],
  [{ kind: 'upgrade', entityId: ENTITY }, ['onUpgrade', ENTITY]],
  [{ kind: 'cancelUpgrade', entityId: ENTITY }, ['onCancelUpgrade', ENTITY]],
  [{ kind: 'demolish', entityId: ENTITY }, ['onDemolish', ENTITY]],
  [{ kind: 'setDefenceMode', entityId: ENTITY, enabled: true }, ['onSetDefenceMode', ENTITY, true]],
  [
    { kind: 'setHomeQualityUse', entityId: ENTITY, effect: 'cooking', allowed: false },
    ['onSetHomeQualityUse', ENTITY, 'cooking', false],
  ],
  [{ kind: 'demolishSignpost', entityId: ENTITY }, ['onDemolishSignpost', ENTITY]],
  [{ kind: 'assignWorkplace', entityId: ENTITY }, ['onAssignWorkplace', ENTITY]],
  [{ kind: 'unassignWorkplace', entityId: ENTITY }, ['onUnassignWorkplace', ENTITY]],
  [{ kind: 'assignHome', entityId: ENTITY }, ['onAssignHome', ENTITY]],
  [{ kind: 'unassignHome', entityId: ENTITY }, ['onUnassignHome', ENTITY]],
];

describe('applyPanelClick', () => {
  it.each(ROUTES)('routes %o to its handler', (click, expected) => {
    const calls: Call[] = [];
    applyPanelClick(click, recordingActions(calls), () => {
      calls.push(['selectStockTab']);
    });
    expect(calls).toEqual([expected]);
  });

  it('sends a stock-tab click to the panel-local handler and issues no order', () => {
    const calls: Call[] = [];
    const tabs: number[] = [];
    applyPanelClick({ kind: 'stockTab', tab: 2 }, recordingActions(calls), (tab) => tabs.push(tab));
    expect(tabs).toEqual([2]);
    expect(calls).toEqual([]);
  });

  it.each<PanelClick>([
    { kind: 'equipSlot', entityId: ENTITY, ref: BOOTS_SLOT },
    { kind: 'unequipSlot', entityId: ENTITY, ref: BOOTS_SLOT },
    { kind: 'assignWorkplace', entityId: ENTITY },
    { kind: 'unassignWorkplace', entityId: ENTITY },
    { kind: 'assignHome', entityId: ENTITY },
    { kind: 'unassignHome', entityId: ENTITY },
  ])('leaves %o inert when its optional handler is unwired', (click) => {
    const calls: Call[] = [];
    applyPanelClick(click, requiredActions(calls), () => {
      calls.push(['selectStockTab']);
    });
    expect(calls).toEqual([]);
  });
});
