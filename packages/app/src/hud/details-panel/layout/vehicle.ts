import { WIN_PAD } from '../../chrome.js';
import type { Rect } from '../../geometry.js';
import type { VehicleOrder, VehiclePanelModel } from '../model/index.js';
import { DETAILS_STOCK_TAB_COUNT, stockTabRects } from '../stock-tabs.js';
import { BAR_H, type ButtonHit, STOCK_ROW_H } from './building.js';
import { PANEL_W, panelRect, ROW_H, SECTION_GAP, type SectionRect, sectionAt } from './shared.js';

/** The order buttons' action ids, one per {@link VehicleOrder}. */
export type VehicleOrderAction = `vehicle-${VehicleOrder}`;

export const vehicleOrderAction = (order: VehicleOrder): VehicleOrderAction => `vehicle-${order}`;

/** The order behind a button action, or undefined for an action of another window. */
export function vehicleOrderOf(action: string): VehicleOrder | undefined {
  return action.startsWith('vehicle-') ? (action.slice('vehicle-'.length) as VehicleOrder) : undefined;
}

/** An order button's height and the gap between two; two columns keep a catapult's twelve orders short. */
const ORDER_BUTTON_H = 16;
const ORDER_BUTTON_GAP = 4;
const ORDER_COLUMNS = 2;
/** The Ogólne health row: a label column and the gauge beside it, like a settler's stat rows. */
const HEALTH_ROW_H = 13;
/** Height of the cargo body's category-tab strip, matching the decoded tab plate. */
const CARGO_TAB_H = 18;
/** Gap under the tab strip before the first cargo row. */
const CARGO_TAB_GAP = 4;
/** Cargo cells per column; two columns, so twelve goods show per tab, which fits the biggest category. */
export const CARGO_ROWS = 6;
/** Horizontal gap between the two cargo columns. */
const CARGO_COL_GAP = WIN_PAD;
/** A cargo cell's good icon column. */
const CARGO_ICON_W = 18;
/** The round wanted step buttons' diameter and the gap between the pair. */
const CARGO_STEP_BTN = 15;
const CARGO_STEP_GAP = 2;

/** One cargo cell: the good icon, the counts plate, and the two wanted-amount step buttons. */
export interface VehicleCargoCell {
  readonly cell: Rect;
  readonly icon: Rect;
  readonly plate: Rect;
  readonly less: Rect;
  readonly more: Rect;
}

export interface VehicleCrewRowRect {
  readonly entity: number;
  readonly rect: Rect;
}

export interface VehicleLayout {
  readonly kind: 'vehicle';
  readonly panel: Rect;
  readonly general: SectionRect;
  /** One rect per `model` text line: meta, task, then the optional stance, carrier and capacity lines. */
  readonly generalRows: readonly Rect[];
  /** Laid out whether or not the model carries a health pool; null health draws nothing there. */
  readonly health: Rect;
  readonly orders: SectionRect;
  readonly orderButtons: readonly ButtonHit[];
  readonly people: SectionRect;
  /** One rect per `model.crew` row; empty crew leaves one hint row instead. */
  readonly crewRows: readonly VehicleCrewRowRect[];
  readonly crewHint: Rect | null;
  /** Null for a vehicle without a hold. */
  readonly cargo: SectionRect | null;
  readonly cargoTabHits: readonly Rect[];
  /** Column-major cells, the visible rows of the active tab fill them in order. */
  readonly cargoCells: readonly VehicleCargoCell[];
}

/** The Ogólne text lines a model draws, in row order. */
export function vehicleGeneralLines(model: VehiclePanelModel): string[] {
  const lines = [model.meta, model.taskLabel];
  if (model.stanceLabel !== null) lines.push(model.stanceLabel);
  if (model.carrierLabel !== null) lines.push(model.carrierLabel);
  if (model.capacityLabel !== null) lines.push(model.capacityLabel);
  return lines;
}

function cargoCells(body: Rect, s: number): VehicleCargoCell[] {
  const colGap = Math.round(CARGO_COL_GAP * s);
  const colW = Math.round((body.w - colGap) / 2);
  const cellH = Math.round(STOCK_ROW_H * s);
  const iconW = Math.round(CARGO_ICON_W * s);
  const btn = Math.round(CARGO_STEP_BTN * s);
  const btnGap = Math.round(CARGO_STEP_GAP * s);
  const rowsTop = body.y + body.h - CARGO_ROWS * cellH;
  const cells: VehicleCargoCell[] = [];
  for (let i = 0; i < CARGO_ROWS * 2; i++) {
    const col = Math.floor(i / CARGO_ROWS);
    const cell: Rect = {
      x: body.x + col * (colW + colGap),
      y: rowsTop + (i % CARGO_ROWS) * cellH,
      w: colW,
      h: cellH,
    };
    const btnY = cell.y + Math.round((cellH - btn) / 2);
    const more: Rect = { x: cell.x + cell.w - btn, y: btnY, w: btn, h: btn };
    const less: Rect = { x: more.x - btnGap - btn, y: btnY, w: btn, h: btn };
    const icon: Rect = { x: cell.x, y: cell.y + Math.round(s), w: iconW, h: cellH - Math.round(2 * s) };
    const plateH = Math.round(BAR_H * s) + Math.round(2 * s);
    const plate: Rect = {
      x: cell.x + iconW,
      y: cell.y + Math.round((cellH - plateH) / 2),
      w: Math.max(0, less.x - btnGap - (cell.x + iconW)),
      h: plateH,
    };
    cells.push({ cell, icon, plate, less, more });
  }
  return cells;
}

export function layoutVehicle(
  model: VehiclePanelModel,
  screen: { readonly width: number; readonly height: number },
  s: number,
): VehicleLayout {
  const w = Math.round(PANEL_W * s);
  const gap = Math.round(SECTION_GAP * s);
  const rowH = Math.round(ROW_H * s);
  const lineCount = vehicleGeneralLines(model).length;
  const generalBodyH = lineCount * rowH + Math.round(HEALTH_ROW_H * s);
  const buttonH = Math.round(ORDER_BUTTON_H * s);
  const buttonGap = Math.round(ORDER_BUTTON_GAP * s);
  const orderRowCount = Math.ceil(model.orders.length / ORDER_COLUMNS);
  const ordersBodyH = orderRowCount * buttonH + Math.max(0, orderRowCount - 1) * buttonGap;
  const peopleBodyH = Math.max(1, model.crew.length) * rowH;
  const hasCargo = model.cargo.length > 0;
  const cargoBodyH = hasCargo
    ? Math.round(CARGO_TAB_H * s) + Math.round(CARGO_TAB_GAP * s) + CARGO_ROWS * Math.round(STOCK_ROW_H * s)
    : 0;

  const heights = [generalBodyH, ordersBodyH, peopleBodyH].map(
    (bodyH) => sectionAt(0, 0, w, bodyH, s).frame.h,
  );
  if (hasCargo) heights.push(sectionAt(0, 0, w, cargoBodyH, s).frame.h);
  const panel = panelRect(heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1), screen, s);

  let y = panel.y;
  const next = (bodyH: number): SectionRect => {
    const sec = sectionAt(panel.x, y, w, bodyH, s);
    y += sec.frame.h + gap;
    return sec;
  };

  const general = next(generalBodyH);
  const generalRows: Rect[] = Array.from({ length: lineCount }, (_unused, i) => ({
    x: general.body.x,
    y: general.body.y + i * rowH,
    w: general.body.w,
    h: rowH,
  }));
  const health: Rect = {
    x: general.body.x,
    y: general.body.y + lineCount * rowH,
    w: general.body.w,
    h: Math.round(HEALTH_ROW_H * s),
  };

  const orders = next(ordersBodyH);
  const colGap = Math.round(WIN_PAD * s);
  const colW = Math.round((orders.body.w - colGap) / ORDER_COLUMNS);
  const orderButtons: ButtonHit[] = model.orders.map((row, i) => ({
    action: vehicleOrderAction(row.order),
    enabled: row.enabled,
    rect: {
      x: orders.body.x + (i % ORDER_COLUMNS) * (colW + colGap),
      y: orders.body.y + Math.floor(i / ORDER_COLUMNS) * (buttonH + buttonGap),
      w: colW,
      h: buttonH,
    },
  }));

  const people = next(peopleBodyH);
  const crewRows: VehicleCrewRowRect[] = model.crew.map((row, i) => ({
    entity: row.entity,
    rect: { x: people.body.x, y: people.body.y + i * rowH, w: people.body.w, h: rowH },
  }));
  const crewHint: Rect | null =
    model.crew.length > 0 ? null : { x: people.body.x, y: people.body.y, w: people.body.w, h: rowH };

  const cargo = hasCargo ? next(cargoBodyH) : null;
  const cargoTabHits =
    cargo === null
      ? []
      : stockTabRects(
          { x: cargo.body.x, y: cargo.body.y, w: cargo.body.w, h: Math.round(CARGO_TAB_H * s) },
          s,
          DETAILS_STOCK_TAB_COUNT,
        );
  const cells = cargo === null ? [] : cargoCells(cargo.body, s);

  return {
    kind: 'vehicle',
    panel,
    general,
    generalRows,
    health,
    orders,
    orderButtons,
    people,
    crewRows,
    crewHint,
    cargo,
    cargoTabHits,
    cargoCells: cells,
  };
}

/** {@link mapLayout}'s vehicle half: every rect through `fn`, the rest untouched. */
export function mapVehicleLayout(layout: VehicleLayout, fn: (r: Rect) => Rect): VehicleLayout {
  const sec = (s: SectionRect): SectionRect => ({ frame: fn(s.frame), title: fn(s.title), body: fn(s.body) });
  return {
    ...layout,
    panel: fn(layout.panel),
    general: sec(layout.general),
    generalRows: layout.generalRows.map(fn),
    health: fn(layout.health),
    orders: sec(layout.orders),
    orderButtons: layout.orderButtons.map((b) => ({ ...b, rect: fn(b.rect) })),
    people: sec(layout.people),
    crewRows: layout.crewRows.map((row) => ({ ...row, rect: fn(row.rect) })),
    crewHint: layout.crewHint === null ? null : fn(layout.crewHint),
    cargo: layout.cargo === null ? null : sec(layout.cargo),
    cargoTabHits: layout.cargoTabHits.map(fn),
    cargoCells: layout.cargoCells.map((cell) => ({
      cell: fn(cell.cell),
      icon: fn(cell.icon),
      plate: fn(cell.plate),
      less: fn(cell.less),
      more: fn(cell.more),
    })),
  };
}
