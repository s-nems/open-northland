import {
  hitButton,
  hitCraftChoice,
  hitEquipAction,
  hitGatherChoice,
  hitStockTab,
  nextCraftGoods,
} from './hit-test.js';
import { type ButtonAction, type EquipSlotRef, equipActionKey } from './layout/index.js';
import type { PanelView } from './selection-view.js';

// What a canvas point means to the details panel: the order the probes in `hit-test.ts` are consulted
// and the intent each hit carries.

/** One resolved left-click intent. `stockTab` is panel-local (it re-bakes); the rest are player orders. */
export type PanelClick =
  | { readonly kind: 'setGatherGood'; readonly entityId: number; readonly goodType: number | null }
  | { readonly kind: 'setCraftGoods'; readonly entityId: number; readonly goods: readonly number[] }
  | { readonly kind: 'equipSlot'; readonly entityId: number; readonly ref: EquipSlotRef }
  | { readonly kind: 'unequipSlot'; readonly entityId: number; readonly ref: EquipSlotRef }
  | { readonly kind: 'stockTab'; readonly tab: number }
  | { readonly kind: 'upgrade'; readonly entityId: number }
  | { readonly kind: 'cancelUpgrade'; readonly entityId: number }
  | { readonly kind: 'demolish'; readonly entityId: number }
  | { readonly kind: 'demolishSignpost'; readonly entityId: number }
  | { readonly kind: 'assignWorkplace'; readonly entityId: number }
  | { readonly kind: 'assignHome'; readonly entityId: number }
  | { readonly kind: 'unassignHome'; readonly entityId: number };

/** The intent of the settler choice/equip blocks, which sit above the button column in probe order. */
const settlerFieldClick = (
  view: Extract<PanelView, { kind: 'settler' }>,
  x: number,
  y: number,
  toggleModifier: boolean,
): PanelClick | null => {
  const entityId = view.model.entityId;
  const gatherGood = hitGatherChoice(view, x, y);
  if (gatherGood !== undefined) return { kind: 'setGatherGood', entityId, goodType: gatherGood };
  const craftGood = hitCraftChoice(view, x, y);
  if (craftGood !== undefined) {
    const goods = nextCraftGoods(
      view.model.work.craftChoices.map((c) => c.goodType),
      view.model.work.selectedCraftGoods,
      craftGood,
      toggleModifier,
    );
    return { kind: 'setCraftGoods', entityId, goods };
  }
  const equipHit = hitEquipAction(view, x, y);
  if (equipHit === undefined) return null;
  return equipHit.kind === 'unequip'
    ? { kind: 'unequipSlot', entityId, ref: equipHit.ref }
    : { kind: 'equipSlot', entityId, ref: equipHit.ref };
};

/** The intent of an enabled button, or null for an action this view kind does not wire. */
const buttonClick = (view: PanelView, action: ButtonAction): PanelClick | null => {
  switch (view.kind) {
    case 'building': {
      const entityId = view.model.entityId;
      if (action === 'upgrade') return { kind: 'upgrade', entityId };
      if (action === 'cancelUpgrade') return { kind: 'cancelUpgrade', entityId };
      return action === 'demolish' ? { kind: 'demolish', entityId } : null;
    }
    case 'settler': {
      const entityId = view.model.entityId;
      if (action === 'assign-workplace') return { kind: 'assignWorkplace', entityId };
      if (action === 'assign-home') return { kind: 'assignHome', entityId };
      return action === 'unassign-home' ? { kind: 'unassignHome', entityId } : null;
    }
    case 'signpost':
      return action === 'demolish' ? { kind: 'demolishSignpost', entityId: view.model.entityId } : null;
    case 'empty':
    case 'compact':
      return null;
  }
};

/**
 * What a left-click at a canvas point inside the panel does, or null when it lands on inert chrome or a
 * disabled button. `toggleModifier` is passed on to {@link nextCraftGoods}.
 */
export const panelClickAt = (
  view: PanelView,
  x: number,
  y: number,
  toggleModifier: boolean,
): PanelClick | null => {
  if (view.kind === 'settler') {
    const field = settlerFieldClick(view, x, y, toggleModifier);
    if (field !== null) return field;
  }
  const tab = hitStockTab(view, x, y);
  if (tab !== null) return { kind: 'stockTab', tab };
  const hit = hitButton(view, x, y);
  return hit === null || !hit.enabled ? null : buttonClick(view, hit.action);
};

/** Everything a hover changes in the drawn panel, so a rebuild is skipped while all three hold. */
export interface PanelHover {
  readonly action: ButtonAction | null;
  /** The hovered gather or craft choice (the blocks never coexist): `undefined` = none, `null` = the
   *  gather-all button. */
  readonly choiceGood: number | null | undefined;
  /** The hovered equip button's {@link equipActionKey}, stable across rebuilds. */
  readonly equipAction: string | null;
}

export const NO_PANEL_HOVER: PanelHover = { action: null, choiceGood: undefined, equipAction: null };

export const panelHoverAt = (view: PanelView, x: number, y: number): PanelHover => {
  const gather = hitGatherChoice(view, x, y);
  const equipHit = hitEquipAction(view, x, y);
  return {
    action: hitButton(view, x, y)?.action ?? null,
    choiceGood: gather !== undefined ? gather : hitCraftChoice(view, x, y),
    equipAction: equipHit !== undefined ? equipActionKey(equipHit) : null,
  };
};

export const sameHover = (a: PanelHover, b: PanelHover): boolean =>
  a.action === b.action && a.choiceGood === b.choiceGood && a.equipAction === b.equipAction;
