import type { UiString } from '../../../content/gui-gfx.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { Rect } from '../../geometry.js';
import type { Chrome } from '../chrome.js';
import { visibleCargoRows } from '../hit-test.js';
import { type ButtonAction, ROW_TEXT_PAD, type VehicleLayout, vehicleGeneralLines } from '../layout/index.js';
import {
  VEHICLE_ORDER_STRING,
  VEHICLEWINDOW,
  type VehicleOrder,
  type VehiclePanelModel,
} from '../model/index.js';
import type { PanelHover } from '../pointer-intent.js';
import type { PanelView } from '../selection-view.js';
import { STOCK_AMOUNT_INSET } from './building/shared.js';
import { drawStockTabs } from './building/stock.js';
import { drawTradeSection } from './settler-trade.js';

/** The Ogólne health row's label column; the gauge fills the rest of the row. */
const HEALTH_LABEL_W = 78;
const HEALTH_BAR_H = 9;
/** Lime underline height marking the stance the vehicle is in, in design px. */
const ACTIVE_ORDER_UNDERLINE_H = 2;

/**
 * The vehicle window: Ogólne (type, owner, task, stance or carrier, capacity, hit points), the order
 * buttons, the crew list, a riding trader's Handel section and the hold with its wanted-amount steps.
 * The section stack and the button grid are authored; the labels are the original's `vehiclewindow` and
 * `misclogic` strings where it has one.
 */
export function drawVehicle(
  chrome: Chrome,
  view: Extract<PanelView, { kind: 'vehicle' }>,
  layout: VehicleLayout,
  ui: UiString,
  hover: PanelHover,
  activeStockTab: number,
  s: number,
): void {
  const model = view.model;
  drawGeneralSection(chrome, layout, model, s);
  drawOrdersSection(chrome, layout, model, ui, hover.action, s);
  drawPeopleSection(chrome, layout, model, ui, hover.crewRow);
  if (layout.trade !== null && model.trade !== null) {
    const hovered = { import: hover.tradeImport, offer: hover.tradeOffer, detach: hover.tradeDetach };
    drawTradeSection(chrome, layout.trade, model.trade.panel, hover.action, hovered, s);
  }
  if (layout.cargo !== null) drawCargoSection(chrome, view, layout, ui, hover, activeStockTab, s);
}

function drawGeneralSection(
  chrome: Chrome,
  layout: VehicleLayout,
  model: VehiclePanelModel,
  s: number,
): void {
  chrome.window(layout.general.frame);
  chrome.headline(layout.general.title, model.title);
  const lines = vehicleGeneralLines(model);
  layout.generalRows.forEach((row, i) => {
    const line = lines[i];
    if (line !== undefined)
      chrome.textAt(line, row.x, row.y + ROW_TEXT_PAD * s, i === 0 ? 'dimmed' : 'white');
  });
  if (model.health === null) return;
  const r = layout.health;
  const labelW = Math.round(HEALTH_LABEL_W * s);
  const barH = Math.round(HEALTH_BAR_H * s);
  chrome.textAt(model.health.label, r.x, r.y + ROW_TEXT_PAD * s, 'white');
  chrome.bar(
    { x: r.x + labelW, y: r.y + Math.round((r.h - barH) / 2), w: r.w - labelW, h: barH },
    model.health.pct,
    'gauge',
  );
}

function drawOrdersSection(
  chrome: Chrome,
  layout: VehicleLayout,
  model: VehiclePanelModel,
  ui: UiString,
  hoverAction: ButtonAction | null,
  s: number,
): void {
  chrome.window(layout.orders.frame);
  chrome.headline(layout.orders.title, messages().hud.vehicleOrders);
  const underlineH = Math.max(2, Math.round(ACTIVE_ORDER_UNDERLINE_H * s));
  layout.orderButtons.forEach((button, i) => {
    const row = model.orders[i];
    if (row === undefined) return;
    chrome.button(button, orderLabel(row.order, ui), hoverAction === button.action);
    if (!row.active) return;
    const r = button.rect;
    chrome.selectedUnderline({ x: r.x, y: r.y + r.h - underlineH, w: r.w, h: underlineH });
  });
}

/** The order buttons' labels: the decoded `misclogic` / `vehiclewindow` strings, else the catalog's. */
function orderLabel(order: VehicleOrder, ui: UiString): string {
  const hud = messages().hud;
  switch (order) {
    case 'goTo':
      return ui('misclogic', VEHICLE_ORDER_STRING.goTo, hud.vehicleOrderGoTo);
    case 'dock':
      return ui('misclogic', VEHICLE_ORDER_STRING.dock, hud.vehicleOrderDock);
    case 'unloadPeople':
      // The catalog's own short label: the mod's "put people ashore" reads wrong on a cart or catapult.
      return hud.vehicleOrderUnloadPeople;
    case 'stop':
      return hud.vehicleOrderStop;
    case 'attackInhabitants':
      return ui('misclogic', VEHICLE_ORDER_STRING.attackInhabitants, hud.vehicleOrderAttackInhabitants);
    case 'attackBuilding':
      return ui('misclogic', VEHICLE_ORDER_STRING.attackBuilding, hud.vehicleOrderAttackBuilding);
    case 'attackVehicle':
      return ui('misclogic', VEHICLE_ORDER_STRING.attackVehicle, hud.vehicleOrderAttackVehicle);
    case 'attackPosition':
      return ui('misclogic', VEHICLE_ORDER_STRING.attackPosition, hud.vehicleOrderAttackPosition);
    case 'stanceAttack':
      return ui('misclogic', VEHICLE_ORDER_STRING.attackMode, hud.vehicleOrderAttackMode);
    case 'stanceDefence':
      return ui('misclogic', VEHICLE_ORDER_STRING.defenceMode, hud.vehicleOrderDefenceMode);
    case 'stanceHold':
      return hud.vehicleOrderHoldMode;
    case 'loadIntoShip':
      return ui('vehiclewindow', VEHICLEWINDOW.assignToShip, hud.vehicleOrderLoadIntoShip);
    case 'leaveShip':
      return ui('vehiclewindow', VEHICLEWINDOW.removeFromShip, hud.vehicleOrderLeaveShip);
    case 'unloadGoods':
      return ui('vehiclewindow', VEHICLEWINDOW.unloadGoods, hud.vehicleOrderUnloadGoods);
    default: {
      const unreachable: never = order;
      return unreachable;
    }
  }
}

/** Mieszkańcy: the commander first, then the passengers and the carried vehicles; a rider still walking
 *  to the door is marked. Each row selects what it names. */
function drawPeopleSection(
  chrome: Chrome,
  layout: VehicleLayout,
  model: VehiclePanelModel,
  ui: UiString,
  hoveredRow: number | null,
): void {
  const hud = messages().hud;
  chrome.window(layout.people.frame);
  const count = formatMessage(hud.vehicleCrewCount, { count: model.crewCount, capacity: model.crewCapacity });
  chrome.headline(
    layout.people.title,
    `${ui('vehiclewindow', VEHICLEWINDOW.people, hud.vehiclePeople)} ${count}`,
  );
  layout.crewRows.forEach((row, i) => {
    const crew = model.crew[i];
    if (crew === undefined) return;
    if (hoveredRow === crew.entity) chrome.scrim(row.rect, 0.25);
    const role =
      crew.role === 'commander'
        ? hud.vehicleCommander
        : crew.role === 'passenger'
          ? hud.vehiclePassenger
          : hud.vehicle;
    const outside = crew.inside ? '' : ` (${hud.vehicleCrewOutside})`;
    chrome.textLeftMiddle(
      `${role}: ${crew.label}${outside}`,
      row.rect.x,
      row.rect.y + row.rect.h / 2,
      crew.inside ? 'white' : 'dimmed',
      'body',
      row.rect.w,
    );
  });
  if (layout.crewHint !== null) {
    chrome.textLeftMiddle(
      hud.vehicleNoCrew,
      layout.crewHint.x,
      layout.crewHint.y + layout.crewHint.h / 2,
      'dimmed',
      'body',
      layout.crewHint.w,
    );
  }
}

/** Magazyn: the category tabs over two columns of cells, each a good's icon, its "aboard/wanted" plate
 *  and the two wanted steps. The "Wszystkie" tab lists the lines with anything on them. */
function drawCargoSection(
  chrome: Chrome,
  view: Extract<PanelView, { kind: 'vehicle' }>,
  layout: VehicleLayout,
  ui: UiString,
  hover: PanelHover,
  activeStockTab: number,
  s: number,
): void {
  if (layout.cargo === null) return;
  const hud = messages().hud;
  chrome.window(layout.cargo.frame);
  chrome.headline(layout.cargo.title, ui('vehiclewindow', VEHICLEWINDOW.cargo, hud.vehicleCargo));
  drawStockTabs(chrome, layout.cargoTabHits, activeStockTab, s);
  const rows = visibleCargoRows(view, activeStockTab);
  if (rows.length === 0) {
    const first = layout.cargoCells[0];
    if (first !== undefined) {
      const hint: Rect = { x: first.cell.x, y: first.cell.y, w: layout.cargo.body.w, h: first.cell.h };
      chrome.textLeftMiddle(
        hud.vehicleCargoNothingWanted,
        hint.x,
        hint.y + hint.h / 2,
        'dimmed',
        'body',
        hint.w,
      );
    }
    return;
  }
  rows.forEach((row, i) => {
    const cell = layout.cargoCells[i];
    if (cell === undefined) return;
    chrome.stockField(cell.plate);
    if (row.goodId !== undefined) chrome.goodIcon(row.goodId, cell.icon);
    chrome.textLeftMiddle(
      `${row.current}/${row.wanted}`,
      cell.plate.x + Math.round(STOCK_AMOUNT_INSET * s),
      cell.plate.y + cell.plate.h / 2,
      row.wanted > 0 || row.current > 0 ? 'white' : 'dimmed',
      'body',
      cell.plate.w - Math.round(STOCK_AMOUNT_INSET * s),
    );
    const lit = hover.cargoStep?.goodType === row.goodType ? hover.cargoStep.step : 0;
    chrome.roundButton(cell.less, row.wanted > 0, lit === -1);
    chrome.glyphMinus(cell.less, row.wanted > 0);
    chrome.roundButton(cell.more, view.model.wantedRoom > 0, lit === 1);
    chrome.glyphPlus(cell.more);
  });
}
