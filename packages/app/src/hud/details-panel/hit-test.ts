import { formatMessage, messages } from '../../i18n/index.js';
import { contains } from '../geometry.js';
import {
  type ButtonHit,
  type EquipActionHit,
  type EquipSlotRef,
  stockSlotRects,
  type TradeImportHit,
  type TradeLayout,
  type TradeOfferHit,
  tradeButtons,
  vehicleOrderOf,
} from './layout/index.js';
import type { VehicleCargoRow, VehicleOrder } from './model/index.js';
import type { PanelView } from './selection-view.js';
import { detailsStockTabLabels, holdTabRows, visibleStockRows } from './stock-tabs.js';

// Pure probes for the details panel: map a canvas point in the current PanelView to the action target
// under it or the tooltip text that names it. No Pixi or DOM.

/** The buttons the current view exposes to pointer routing, in hit-test order. */
const panelButtons = (view: PanelView): readonly ButtonHit[] => {
  switch (view.kind) {
    case 'building':
      // The defence toggle lives inside the defence window, not the general button column, so it
      // carries its own layout slot and joins the routing list here.
      return [
        ...view.layout.buttons,
        ...(view.layout.defenceToggle === null ? [] : [view.layout.defenceToggle]),
        ...view.layout.homeQualityRows.map((row) => row.button),
      ];
    case 'settler':
      return [...view.layout.workControls.map((c) => c.button), ...tradeButtons(view.layout.trade)];
    case 'signpost':
      return [view.layout.button];
    case 'palisade':
      return view.layout.buttons;
    case 'vehicle':
      return [...view.layout.orderButtons, ...tradeButtons(view.layout.trade)];
    case 'empty':
    case 'compact':
      return [];
  }
};

export const hitButton = (view: PanelView, x: number, y: number): ButtonHit | null =>
  panelButtons(view).find((b) => contains(b.rect, x, y)) ?? null;

/** The stock category tab under a canvas point, or null - a building's store and a vehicle's hold carry
 *  the tab strip. */
export const hitStockTab = (view: PanelView, x: number, y: number): number | null => {
  const tabs =
    view.kind === 'building'
      ? view.layout.stockTabHits
      : view.kind === 'vehicle'
        ? view.layout.cargoTabHits
        : [];
  const i = tabs.findIndex((r) => contains(r, x, y));
  return i >= 0 ? i : null;
};

type VehicleView = Extract<PanelView, { kind: 'vehicle' }>;

/** The hold's rows for the active tab, cell by cell: one source for the section's draw and the hit-tests.
 *  The layout sizes the grid from the same rows, so none is cut off. */
export const visibleCargoRows = (view: VehicleView, activeStockTab: number): VehicleCargoRow[] =>
  holdTabRows(view.model.cargo, activeStockTab);

/** A wanted-amount step button under a canvas point: the good and the direction, or undefined. */
export interface VehicleCargoStepHit {
  readonly row: VehicleCargoRow;
  readonly step: -1 | 1;
}

export const hitVehicleCargoStep = (
  view: PanelView,
  x: number,
  y: number,
  activeStockTab: number,
): VehicleCargoStepHit | undefined => {
  if (view.kind !== 'vehicle') return undefined;
  const rows = visibleCargoRows(view, activeStockTab);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cell = view.layout.cargoCells[i];
    if (row === undefined || cell === undefined) continue;
    if (contains(cell.less, x, y)) return { row, step: -1 };
    if (contains(cell.more, x, y)) return { row, step: 1 };
  }
  return undefined;
};

/** The cargo row whose cell (icon or counts plate) holds a canvas point, or undefined. */
const hitVehicleCargoRow = (
  view: VehicleView,
  x: number,
  y: number,
  activeStockTab: number,
): VehicleCargoRow | undefined => {
  const rows = visibleCargoRows(view, activeStockTab);
  const i = view.layout.cargoCells.findIndex((cell) => contains(cell.cell, x, y));
  return i < 0 ? undefined : rows[i];
};

/** The crew or carried-vehicle row under a canvas point, as the entity it names, or undefined. */
export const hitVehicleCrew = (view: PanelView, x: number, y: number): number | undefined => {
  if (view.kind !== 'vehicle') return undefined;
  return view.layout.crewRows.find((row) => contains(row.rect, x, y))?.entity;
};

/** The order button under a canvas point, enabled or not, or undefined. */
export const hitVehicleOrder = (view: PanelView, x: number, y: number): VehicleOrder | undefined => {
  if (view.kind !== 'vehicle') return undefined;
  const hit = view.layout.orderButtons.find((b) => contains(b.rect, x, y));
  return hit === undefined ? undefined : vehicleOrderOf(hit.action);
};

export const hitGatherChoice = (view: PanelView, x: number, y: number): number | null | undefined => {
  if (view.kind !== 'settler') return undefined;
  return view.layout.gatherChoiceHits.find((hit) => contains(hit.rect, x, y))?.goodType;
};

/** The craft product toggle under a canvas point, or undefined (settler layouts only). */
export const hitCraftChoice = (view: PanelView, x: number, y: number): number | undefined => {
  if (view.kind !== 'settler') return undefined;
  return view.layout.craftChoiceHits.find((hit) => contains(hit.rect, x, y))?.goodType;
};

/**
 * The next selection after a craft-choice click. A plain click replaces the selection with the clicked
 * product; `toggle` (Ctrl/Cmd) flips it in the multi-set. Selecting every product or none normalizes to
 * the `[]` all-mode, so the sim drops the component.
 */
export const nextCraftGoods = (
  products: readonly number[],
  selected: readonly number[],
  goodType: number,
  toggle: boolean,
): readonly number[] => {
  if (!toggle) return products.length === 1 ? [] : [goodType];
  const next = new Set(selected);
  if (next.has(goodType)) next.delete(goodType);
  else next.add(goodType);
  if (next.size === 0 || next.size === products.length) return [];
  return products.filter((g) => next.has(g));
};

/** A drawn Handel section and the trader its controls act on: a trader's own window, or the vehicle
 *  window of a cart it rides. */
export interface TradeTarget {
  readonly trader: number;
  readonly layout: TradeLayout;
}

export const tradeTargetOf = (view: PanelView): TradeTarget | null => {
  if (view.kind === 'settler') {
    return view.layout.trade === null ? null : { trader: view.model.entityId, layout: view.layout.trade };
  }
  if (view.kind === 'vehicle') {
    return view.layout.trade === null || view.model.trade === null
      ? null
      : { trader: view.model.trade.trader, layout: view.layout.trade };
  }
  return null;
};

/** The import mark under a canvas point in a Handel section, or undefined. */
export const hitTradeImport = (view: PanelView, x: number, y: number): TradeImportHit | undefined => {
  const trade = tradeTargetOf(view)?.layout;
  if (trade === undefined) return undefined;
  for (const stop of trade.stops) {
    const hit = stop.imports.find((h) => contains(h.rect, x, y));
    if (hit !== undefined) return hit;
  }
  return trade.balance.find((h) => contains(h.rect, x, y));
};

/** The agreement row under a canvas point in a Handel section, or undefined. */
export const hitTradeOffer = (view: PanelView, x: number, y: number): TradeOfferHit | undefined =>
  tradeTargetOf(view)?.layout.offers.find((h) => contains(h.rect, x, y));

/** The stop whose detach button holds a canvas point, or undefined. */
export const hitTradeDetach = (view: PanelView, x: number, y: number): number | undefined =>
  tradeTargetOf(view)?.layout.stops.find((stop) => contains(stop.detach.rect, x, y))?.house;

/** Whether a canvas point lies on the attach button of a Handel section with a free stop. */
export const hitTradeAttach = (view: PanelView, x: number, y: number): boolean => {
  const attach = tradeTargetOf(view)?.layout.attach;
  return attach != null && contains(attach.button.rect, x, y);
};

/** The per-slot equipment action button under a canvas point, or undefined (settler layouts only). */
export const hitEquipAction = (view: PanelView, x: number, y: number): EquipActionHit | undefined => {
  if (view.kind !== 'settler') return undefined;
  return view.layout.equipActionHits.find((hit) => contains(hit.rect, x, y));
};

/** The entity whose portrait box holds a canvas point, or null. */
export const hitPortrait = (view: PanelView, x: number, y: number): number | null => {
  if (view.kind !== 'settler' && view.kind !== 'building') return null;
  return contains(view.layout.preview, x, y) ? view.model.entityId : null;
};

/** The good name under a canvas point in the stock grid, or null. */
const hitStockGood = (
  view: PanelView,
  x: number,
  y: number,
  scale: number,
  activeStockTab: number,
): string | null => {
  if (view.kind !== 'building') return null;
  const { layout, model } = view;
  if (layout.stock === null) return null;
  const slot = stockSlotRects(layout.stock.body, scale, layout.stockRows).findIndex((r) => contains(r, x, y));
  if (slot < 0) return null;
  const rows = visibleStockRows(model.stock, layout.stockCompact, activeStockTab).slice(
    0,
    layout.stockRows * 2,
  );
  return rows[slot]?.label ?? null;
};

/** The hovered Ogólne stat bar's value ("300/1000" health, "75%" need), or null. Probes the whole
 *  label+gauge row, which is more forgiving than the gauge alone. */
const hitBarValue = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'settler') return null;
  const i = view.layout.bars.findIndex((r) => contains(r, x, y));
  return i < 0 ? null : (view.model.bars[i]?.hover ?? null);
};

/** The hovered building health gauge ("Zdrowie: 300/1000"), or null. Unlike {@link hitBarValue} the
 *  tooltip carries the caption, since the drawn gauge has none. */
const buildingHealthValue = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'building') return null;
  const health = view.model.health;
  if (health === null || !contains(view.layout.health, x, y)) return null;
  return `${health.label}: ${health.hover}`;
};

/** The Praca control buttons' tooltips; the drawn labels name the order, so these spell out what it does. */
const workControlHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'settler') return null;
  const hud = messages().hud;
  const action = view.layout.workControls.find((c) => contains(c.button.rect, x, y))?.action;
  if (action === undefined) return null;
  switch (action) {
    case 'assign-workplace':
      return hud.assignWorkplaceHint;
    case 'unassign-workplace':
      return hud.unassignWorkplaceHint;
    case 'assign-home':
      return hud.assignHomeHint;
    case 'unassign-home':
      return hud.unassignHomeHint;
  }
};

/** The Handel section's tooltips: the route buttons, an import mark's good, an agreement row. */
const tradeControlHint = (view: PanelView, x: number, y: number): string | null => {
  const hud = messages().hud;
  if (hitTradeAttach(view, x, y)) return hud.tradeAttachHouseHint;
  if (hitTradeDetach(view, x, y) !== undefined) return hud.tradeDetachHouse;
  const mark = hitTradeImport(view, x, y);
  if (mark !== undefined) {
    return formatMessage(mark.pair === null ? hud.tradeImportHint : hud.tradeBalanceHint, {
      good: mark.label,
    });
  }
  if (hitTradeOffer(view, x, y) !== undefined) return hud.tradeOfferHint;
  return null;
};

/** The alarm toggle's tooltip names what the click will do, so the wording flips with the current mode. */
const defenceToggleHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'building') return null;
  const toggle = view.layout.defenceToggle;
  if (toggle === null || !contains(toggle.rect, x, y)) return null;
  return view.model.defenseEnabled ? messages().hud.lowerAlarmHint : messages().hud.raiseAlarmHint;
};

/** The hovered choice button's good name ("Wszystko" for gather-all), or null; the icon buttons carry no
 *  drawn label. A craft button also spells out the click semantics, the only affordance for the modifier. */
const gatherChoiceHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'settler') return null;
  const gather = view.layout.gatherChoiceHits.find((hit) => contains(hit.rect, x, y))?.label;
  if (gather !== undefined) return gather;
  const craft = view.layout.craftChoiceHits.find((hit) => contains(hit.rect, x, y))?.label;
  return craft !== undefined ? `${craft}\n${messages().hud.craftToggleHint}` : null;
};

/** The worn good under a hovered equipment socket ("Miód (50%)"), whose percent is the condition left;
 *  an iconless good draws the generic pile, so this tooltip is what identifies it. */
const equipSocketHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'settler') return null;
  for (let i = 0; i < view.layout.equipRows.length; i++) {
    const rects = view.layout.equipRows[i]?.slots ?? [];
    const j = rects.findIndex((r) => contains(r, x, y));
    if (j < 0) continue;
    const slot = view.model.equipmentRows[i]?.slots[j];
    if (slot?.label === undefined) return null;
    return slot.conditionPct !== null ? `${slot.label} (${slot.conditionPct}%)` : slot.label;
  }
  return null;
};

/** Condition percent of an untouched item - below this the swap/take-off discard warning shows. */
const FULL_CONDITION_PCT = 100;

/** Whether the addressed slot holds a part-used wearing item - the discard-warning trigger. */
const holdsUsedItem = (view: PanelView, ref: EquipSlotRef): boolean => {
  if (view.kind !== 'settler') return false;
  const slot = view.model.equipmentRows.find((row) => row.group === ref.group)?.slots[ref.slot];
  return slot?.conditionPct != null && slot.conditionPct < FULL_CONDITION_PCT;
};

/** The equip action buttons' tooltips; the glyph faces carry no label. A swap or take-off button warns
 *  when the order would discard a part-used item, which the sim destroys silently. */
const equipActionHint = (view: PanelView, x: number, y: number): string | null => {
  const hit = hitEquipAction(view, x, y);
  if (hit === undefined) return null;
  const hud = messages().hud;
  const lines = [
    hit.kind === 'equip' ? hud.equipSlotHint : hit.kind === 'swap' ? hud.swapSlotHint : hud.unequipSlotHint,
  ];
  if (hit.label !== undefined) lines.push(hit.label);
  if (hit.kind !== 'equip' && holdsUsedItem(view, hit.ref)) lines.push(hud.usedItemDiscardHint);
  return lines.join('\n');
};

/** The vehicle window's tooltips: an order's effect, a hold cell's counts, a step button's direction, and
 *  the crew rows' select hint. */
const vehicleHint = (view: PanelView, x: number, y: number, activeStockTab: number): string | null => {
  if (view.kind !== 'vehicle') return null;
  const hud = messages().hud;
  const step = hitVehicleCargoStep(view, x, y, activeStockTab);
  if (step !== undefined) {
    return formatMessage(step.step > 0 ? hud.vehicleWantedMore : hud.vehicleWantedLess, {
      good: step.row.label,
    });
  }
  const cargo = hitVehicleCargoRow(view, x, y, activeStockTab);
  if (cargo !== undefined) {
    return formatMessage(hud.vehicleCargoLine, {
      good: cargo.label,
      current: cargo.current,
      wanted: cargo.wanted,
      reserved: Math.max(0, cargo.reserved - cargo.current),
    });
  }
  if (hitVehicleCrew(view, x, y) !== undefined) return hud.vehicleSelectHint;
  const order = hitVehicleOrder(view, x, y);
  if (order === undefined) return null;
  return vehicleOrderHint(order);
};

const vehicleOrderHint = (order: VehicleOrder): string | null => {
  const hud = messages().hud;
  switch (order) {
    case 'goTo':
      return hud.vehicleOrderGoToHint;
    case 'dock':
      return hud.vehicleOrderDockHint;
    case 'unloadPeople':
      return hud.vehicleOrderUnloadPeopleHint;
    case 'stop':
      return hud.vehicleOrderStopHint;
    case 'attackInhabitants':
      return hud.vehicleOrderAttackInhabitantsHint;
    case 'attackBuilding':
      return hud.vehicleOrderAttackBuildingHint;
    case 'attackVehicle':
      return hud.vehicleOrderAttackVehicleHint;
    case 'attackPosition':
      return hud.vehicleOrderAttackPositionHint;
    case 'stanceAttack':
      return hud.vehicleOrderAttackModeHint;
    case 'stanceDefence':
      return hud.vehicleOrderDefenceModeHint;
    case 'stanceHold':
      return hud.vehicleOrderHoldModeHint;
    case 'loadIntoShip':
      return hud.vehicleOrderLoadIntoShipHint;
    case 'leaveShip':
      return null;
    case 'unloadGoods':
      return hud.vehicleOrderUnloadGoodsHint;
    default: {
      const unreachable: never = order;
      return unreachable;
    }
  }
};

/** The Upgrade button's cost card ("Upgrade requires:" then one "- Drewno ×5" line per required good),
 *  or null when the building has no upgrade cost. */
const upgradeButtonHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'building') return null;
  const hit = view.layout.buttons.find((b) => contains(b.rect, x, y));
  if (hit?.action !== 'upgrade') return null;
  if (view.model.upgradeBlockedReason) return view.model.upgradeBlockedReason;
  if (view.model.upgradeCost.length === 0) return null;
  const lines = view.model.upgradeCost.map((c) => `- ${c.label} ×${c.amount}`).join('\n');
  return `${messages().hud.upgradeCostHint}\n${lines}`;
};

/** The hovered Produkcja row's recipe card ("Krótki Miecz:" then one "- Żelazo ×2" line per input), or null. */
const productionRowHint = (view: PanelView, x: number, y: number): string | null => {
  if (view.kind !== 'building' || view.model.production?.kind !== 'recipe') return null;
  const i = view.layout.productionRowRects.findIndex((r) => contains(r, x, y));
  const row = i < 0 ? undefined : view.model.production.rows[i];
  if (row === undefined || row.inputs.length === 0) return null;
  return `${row.label}:\n${row.inputs}`;
};

/**
 * The tooltip text for a canvas point inside a non-empty panel, or null. Each probe answers for one
 * layout kind; where two could match a point, the order below is the resolution precedence.
 */
export const tooltipTextAt = (
  view: PanelView,
  x: number,
  y: number,
  scale: number,
  activeStockTab: number,
): string | null => {
  const rowName = hitStockGood(view, x, y, scale, activeStockTab);
  const tab = rowName === null ? hitStockTab(view, x, y) : null;
  const tabLabel = tab !== null ? (detailsStockTabLabels()[tab] ?? null) : null;
  return (
    rowName ??
    tabLabel ??
    hitBarValue(view, x, y) ??
    buildingHealthValue(view, x, y) ??
    gatherChoiceHint(view, x, y) ??
    equipSocketHint(view, x, y) ??
    equipActionHint(view, x, y) ??
    productionRowHint(view, x, y) ??
    upgradeButtonHint(view, x, y) ??
    defenceToggleHint(view, x, y) ??
    tradeControlHint(view, x, y) ??
    workControlHint(view, x, y) ??
    vehicleHint(view, x, y, activeStockTab)
  );
};
