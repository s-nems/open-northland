import {
  hitButton,
  hitCraftChoice,
  hitEquipAction,
  hitGatherChoice,
  hitPortrait,
  hitStockTab,
  hitTradeAttach,
  hitTradeDetach,
  hitTradeImport,
  hitTradeOffer,
  hitVehicleCargoStep,
  hitVehicleCrew,
  nextCraftGoods,
  tradeTargetOf,
} from './hit-test.js';
import { type ButtonAction, type EquipSlotRef, equipActionKey, vehicleOrderOf } from './layout/index.js';
import type { VehicleOrder } from './model/index.js';
import type { PanelView } from './selection-view.js';

/** The wanted-amount step a plain click makes, and the one a Shift-click makes (the original's `m`). */
export const WANTED_STEP = 1;
export const WANTED_BIG_STEP = 10;

/** The keys held on a panel click: Ctrl/Cmd toggles a craft choice, Shift takes the big wanted step. */
export interface PanelClickModifiers {
  readonly toggle: boolean;
  readonly bigStep: boolean;
}

export const NO_MODIFIERS: PanelClickModifiers = { toggle: false, bigStep: false };

/** One resolved left-click intent: `stockTab` re-bakes the panel and `centerOnEntity` moves the view,
 *  the rest are player orders. */
export type PanelClick =
  | { readonly kind: 'setGatherGood'; readonly entityId: number; readonly goodType: number | null }
  | { readonly kind: 'centerOnEntity'; readonly entityId: number }
  | { readonly kind: 'setCraftGoods'; readonly entityId: number; readonly goods: readonly number[] }
  | { readonly kind: 'equipSlot'; readonly entityId: number; readonly ref: EquipSlotRef }
  | { readonly kind: 'unequipSlot'; readonly entityId: number; readonly ref: EquipSlotRef }
  | { readonly kind: 'stockTab'; readonly tab: number }
  | { readonly kind: 'upgrade'; readonly entityId: number }
  | { readonly kind: 'cancelUpgrade'; readonly entityId: number }
  | { readonly kind: 'demolish'; readonly entityId: number }
  | { readonly kind: 'setDefenceMode'; readonly entityId: number; readonly enabled: boolean }
  | {
      readonly kind: 'setHouseholdGoodUse';
      readonly player: number;
      readonly effect: 'cooking' | 'rest' | 'piety';
      readonly allowed: boolean;
    }
  | { readonly kind: 'demolishSignpost'; readonly entityId: number }
  | { readonly kind: 'demolishPalisade'; readonly entityId: number }
  | { readonly kind: 'setPalisadeGate'; readonly entityId: number; readonly open: boolean }
  | { readonly kind: 'assignWorkplace'; readonly entityId: number }
  | { readonly kind: 'unassignWorkplace'; readonly entityId: number }
  | { readonly kind: 'assignHome'; readonly entityId: number }
  | { readonly kind: 'unassignHome'; readonly entityId: number }
  | { readonly kind: 'attachTradeHouse'; readonly entityId: number }
  | { readonly kind: 'detachTradeHouse'; readonly entityId: number; readonly house: number }
  | {
      readonly kind: 'setTradeImport';
      readonly entityId: number;
      readonly house: number;
      readonly goodType: number;
      readonly on: boolean;
    }
  | { readonly kind: 'setTradeAgreement'; readonly entityId: number; readonly agreement: number }
  | { readonly kind: 'selectEntity'; readonly entityId: number }
  | { readonly kind: 'vehicleOrder'; readonly entityId: number; readonly order: VehicleOrder }
  | {
      readonly kind: 'setVehicleWanted';
      readonly entityId: number;
      readonly goodType: number;
      /** The new wanted amount; the sim clamps it into the hold's budget. */
      readonly amount: number;
    };

/** The intent of a Handel control, addressed to the trader whether its own window or the window of a
 *  cart it rides shows the section. */
const tradeClick = (view: PanelView, x: number, y: number): PanelClick | null => {
  const target = tradeTargetOf(view);
  if (target === null) return null;
  const entityId = target.trader;
  const mark = hitTradeImport(view, x, y);
  if (mark !== undefined) {
    return {
      kind: 'setTradeImport',
      entityId,
      house: mark.house,
      goodType: mark.goodType,
      on: !mark.selected,
    };
  }
  const offer = hitTradeOffer(view, x, y);
  if (offer !== undefined)
    return { kind: 'setTradeAgreement', entityId, agreement: offer.selected ? -1 : offer.index };
  const detach = hitTradeDetach(view, x, y);
  if (detach !== undefined) return { kind: 'detachTradeHouse', entityId, house: detach };
  return hitTradeAttach(view, x, y) ? { kind: 'attachTradeHouse', entityId } : null;
};

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
      if (action === 'center') return { kind: 'centerOnEntity', entityId };
      if (action === 'toggle-defence') {
        return { kind: 'setDefenceMode', entityId, enabled: !view.model.defenseEnabled };
      }
      const homeEffect =
        action === 'toggle-home-cooking'
          ? 'cooking'
          : action === 'toggle-home-rest'
            ? 'rest'
            : action === 'toggle-home-piety'
              ? 'piety'
              : null;
      if (homeEffect !== null) {
        const row = view.model.homeQuality.find((quality) => quality.effect === homeEffect);
        return row === undefined ||
          view.model.ownerPlayer === undefined ||
          !view.model.canSetHouseholdGoodPolicy
          ? null
          : {
              kind: 'setHouseholdGoodUse',
              player: view.model.ownerPlayer,
              effect: homeEffect,
              allowed: !row.allowed,
            };
      }
      return action === 'demolish' ? { kind: 'demolish', entityId } : null;
    }
    case 'settler': {
      const entityId = view.model.entityId;
      switch (action) {
        case 'assign-workplace':
          return { kind: 'assignWorkplace', entityId };
        case 'unassign-workplace':
          return { kind: 'unassignWorkplace', entityId };
        case 'assign-home':
          return { kind: 'assignHome', entityId };
        case 'unassign-home':
          return { kind: 'unassignHome', entityId };
        default:
          return null; // a building action, or a trade button, which tradeClick resolves
      }
    }
    case 'signpost':
      return action === 'demolish' ? { kind: 'demolishSignpost', entityId: view.model.entityId } : null;
    case 'palisade':
      if (action === 'demolish-palisade') return { kind: 'demolishPalisade', entityId: view.model.entityId };
      if (action === 'toggle-gate' && view.model.gateOpen !== null) {
        return {
          kind: 'setPalisadeGate',
          entityId: view.model.entityId,
          open: !view.model.gateOpen,
        };
      }
      return null;
    case 'vehicle': {
      const order = vehicleOrderOf(action);
      return order === undefined ? null : { kind: 'vehicleOrder', entityId: view.model.entityId, order };
    }
    case 'empty':
    case 'compact':
      return null;
  }
};

/** The intent of the vehicle window's crew rows and hold cells, which sit above the button list. */
const vehicleFieldClick = (
  view: Extract<PanelView, { kind: 'vehicle' }>,
  x: number,
  y: number,
  bigStep: boolean,
  activeStockTab: number,
): PanelClick | null => {
  const entityId = view.model.entityId;
  const crew = hitVehicleCrew(view, x, y);
  if (crew !== undefined) return { kind: 'selectEntity', entityId: crew };
  const step = hitVehicleCargoStep(view, x, y, activeStockTab);
  if (step === undefined) return null;
  const amount = Math.max(0, step.row.wanted + step.step * (bigStep ? WANTED_BIG_STEP : WANTED_STEP));
  return { kind: 'setVehicleWanted', entityId, goodType: step.row.goodType, amount };
};

/** What a left-click inside the panel does, or null when it lands on inert chrome or a disabled button. */
export const panelClickAt = (
  view: PanelView,
  x: number,
  y: number,
  modifiers: PanelClickModifiers,
  activeStockTab: number,
): PanelClick | null => {
  const portrait = hitPortrait(view, x, y);
  if (portrait !== null) return { kind: 'centerOnEntity', entityId: portrait };
  const trade = tradeClick(view, x, y);
  if (trade !== null) return trade;
  if (view.kind === 'settler') {
    const field = settlerFieldClick(view, x, y, modifiers.toggle);
    if (field !== null) return field;
  }
  if (view.kind === 'vehicle') {
    const field = vehicleFieldClick(view, x, y, modifiers.bigStep, activeStockTab);
    if (field !== null) return field;
  }
  const tab = hitStockTab(view, x, y);
  if (tab !== null) return { kind: 'stockTab', tab };
  const hit = hitButton(view, x, y);
  return hit === null || !hit.enabled ? null : buttonClick(view, hit.action);
};

/** Everything a hover changes in the drawn panel, so a rebuild is skipped while every field holds. */
export interface PanelHover {
  readonly action: ButtonAction | null;
  /** The hovered gather or craft choice (the blocks never coexist): `undefined` = none, `null` = the
   *  gather-all button. */
  readonly choiceGood: number | null | undefined;
  /** The hovered equip button's {@link equipActionKey}, stable across rebuilds. */
  readonly equipAction: string | null;
  /** The hovered import mark of a trader's route, by stop house and good. */
  readonly tradeImport: { readonly house: number; readonly goodType: number } | null;
  /** The hovered agreement row's table index. */
  readonly tradeOffer: number | null;
  /** The house whose detach button is hovered. */
  readonly tradeDetach: number | null;
  /** The hovered wanted step button of a vehicle's hold, by good and direction. */
  readonly cargoStep: { readonly goodType: number; readonly step: -1 | 1 } | null;
  /** The hovered crew row's entity. */
  readonly crewRow: number | null;
}

export const NO_PANEL_HOVER: PanelHover = {
  action: null,
  choiceGood: undefined,
  equipAction: null,
  tradeImport: null,
  tradeOffer: null,
  tradeDetach: null,
  cargoStep: null,
  crewRow: null,
};

export const panelHoverAt = (view: PanelView, x: number, y: number, activeStockTab: number): PanelHover => {
  const gather = hitGatherChoice(view, x, y);
  const equipHit = hitEquipAction(view, x, y);
  const mark = hitTradeImport(view, x, y);
  const step = hitVehicleCargoStep(view, x, y, activeStockTab);
  return {
    action: hitButton(view, x, y)?.action ?? null,
    choiceGood: gather !== undefined ? gather : hitCraftChoice(view, x, y),
    equipAction: equipHit !== undefined ? equipActionKey(equipHit) : null,
    tradeImport: mark === undefined ? null : { house: mark.house, goodType: mark.goodType },
    tradeOffer: hitTradeOffer(view, x, y)?.index ?? null,
    tradeDetach: hitTradeDetach(view, x, y) ?? null,
    cargoStep: step === undefined ? null : { goodType: step.row.goodType, step: step.step },
    crewRow: hitVehicleCrew(view, x, y) ?? null,
  };
};

export const sameHover = (a: PanelHover, b: PanelHover): boolean =>
  a.action === b.action &&
  a.choiceGood === b.choiceGood &&
  a.equipAction === b.equipAction &&
  a.tradeImport?.house === b.tradeImport?.house &&
  a.tradeImport?.goodType === b.tradeImport?.goodType &&
  a.tradeOffer === b.tradeOffer &&
  a.tradeDetach === b.tradeDetach &&
  a.cargoStep?.goodType === b.cargoStep?.goodType &&
  a.cargoStep?.step === b.cargoStep?.step &&
  a.crewRow === b.crewRow;
