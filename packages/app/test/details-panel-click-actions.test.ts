import { describe, expect, it } from 'vitest';
import { applyPanelClick, type PanelClickActions } from '../src/hud/details-panel/click-actions.js';
import type { PanelClick } from '../src/hud/details-panel/pointer-intent.js';

const ENTITY = 7;

type Call = readonly [name: string, ...args: unknown[]];

function recordingActions(calls: Call[]): PanelClickActions {
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push([name, ...args]);
    };
  return {
    onDemolish: record('onDemolish'),
    onUpgrade: record('onUpgrade'),
    onCancelUpgrade: record('onCancelUpgrade'),
    onDemolishSignpost: record('onDemolishSignpost'),
    onSetDefenceMode: record('onSetDefenceMode'),
    onSetHouseholdGoodUse: record('onSetHouseholdGoodUse'),
    onCenterOnEntity: record('onCenterOnEntity'),
    onDemolishPalisade: record('onDemolishPalisade'),
    onSetPalisadeGate: record('onSetPalisadeGate'),
  };
}

const ROUTES: readonly (readonly [PanelClick, Call])[] = [
  [{ kind: 'centerOnEntity', entityId: ENTITY }, ['onCenterOnEntity', ENTITY]],
  [{ kind: 'upgrade', entityId: ENTITY }, ['onUpgrade', ENTITY]],
  [{ kind: 'cancelUpgrade', entityId: ENTITY }, ['onCancelUpgrade', ENTITY]],
  [{ kind: 'demolish', entityId: ENTITY }, ['onDemolish', ENTITY]],
  [{ kind: 'setDefenceMode', entityId: ENTITY, enabled: true }, ['onSetDefenceMode', ENTITY, true]],
  [
    { kind: 'setHouseholdGoodUse', player: ENTITY, effect: 'cooking', allowed: false },
    ['onSetHouseholdGoodUse', ENTITY, 'cooking', false],
  ],
  [{ kind: 'demolishSignpost', entityId: ENTITY }, ['onDemolishSignpost', ENTITY]],
  [{ kind: 'demolishPalisade', entityId: ENTITY }, ['onDemolishPalisade', ENTITY]],
  [{ kind: 'setPalisadeGate', entityId: ENTITY, open: true }, ['onSetPalisadeGate', ENTITY, true]],
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
});
