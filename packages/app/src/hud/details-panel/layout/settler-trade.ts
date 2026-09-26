import { WIN_PAD } from '../../chrome.js';
import type { Rect } from '../../geometry.js';
import type { TradePanelModel } from '../model/index.js';
import type { ButtonHit } from './building.js';
import { ROW_H, type SectionRect } from './shared.js';

/** Diameter of a stop's round control button and of an import-mark good button. */
const TRADE_ICON = 20;
/** Gap between adjacent round buttons (both axes). */
const TRADE_ICON_GAP = 4;
/** Gap under a stop's control row before its import-mark buttons, and after them. */
const TRADE_STOP_GAP = 3;

/** One import mark: a good the stop's house may take in, with its live state. A balance mark sets the
 *  good at `house` and at `pair`, the other stop, together. */
export interface TradeImportHit {
  readonly house: number;
  readonly pair: number | null;
  readonly goodType: number;
  readonly goodId?: string;
  readonly label: string;
  readonly selected: boolean;
  readonly rect: Rect;
}

/** One agreement row of the foreign stop, a round choice button before its terms; clicking anywhere on
 *  the row trades on that agreement. */
export interface TradeOfferHit {
  readonly index: number;
  readonly label: string;
  readonly selected: boolean;
  readonly rect: Rect;
  readonly button: Rect;
}

export interface TradeStopLayout {
  readonly house: number;
  /** The round button that takes the house off the route. */
  readonly detach: ButtonHit;
  readonly label: Rect;
  readonly imports: readonly TradeImportHit[];
}

/** The Handel section: one block per stop, the attach row while a stop is free, the offer rows and
 *  the status lines. Metrics are authored, like the rest of the panel. */
export interface TradeLayout {
  readonly section: SectionRect;
  readonly stops: readonly TradeStopLayout[];
  readonly attach: { readonly button: ButtonHit; readonly label: Rect } | null;
  /** The caption over the balance marks; null without any. */
  readonly balanceCaption: Rect | null;
  readonly balance: readonly TradeImportHit[];
  /** The caption over the agreement rows; null without any. */
  readonly offersCaption: Rect | null;
  readonly offers: readonly TradeOfferHit[];
  readonly statusRows: readonly Rect[];
}

interface TradeMetrics {
  readonly icon: number;
  readonly iconGap: number;
  readonly stopGap: number;
  readonly rowH: number;
  readonly perRow: number;
}

function metricsFor(bodyW: number, s: number): TradeMetrics {
  const icon = Math.round(TRADE_ICON * s);
  const iconGap = Math.round(TRADE_ICON_GAP * s);
  return {
    icon,
    iconGap,
    stopGap: Math.round(TRADE_STOP_GAP * s),
    rowH: Math.round(ROW_H * s),
    perRow: Math.max(1, Math.floor((bodyW + iconGap) / (icon + iconGap))),
  };
}

function importBlockH(count: number, m: TradeMetrics): number {
  if (count === 0) return 0;
  const rows = Math.ceil(count / m.perRow);
  return m.stopGap + rows * m.icon + (rows - 1) * m.iconGap;
}

/** The body height the section reserves for `model`, measured with the same metrics the layout uses. */
export function tradeBodyHeight(model: TradePanelModel, bodyW: number, s: number): number {
  const m = metricsFor(bodyW, s);
  let h = 0;
  for (const stop of model.stops) h += m.icon + importBlockH(stop.imports.length, m) + m.stopGap;
  if (model.canAttach) h += m.icon + m.stopGap;
  if (model.balance.length > 0) h += m.rowH + importBlockH(model.balance.length, m) + m.stopGap;
  if (model.offers.length > 0) h += m.rowH + model.offers.length * (m.icon + m.stopGap);
  h += model.status.length * m.rowH;
  return h;
}

export function layoutTrade(model: TradePanelModel, section: SectionRect, s: number): TradeLayout {
  const body = section.body;
  const m = metricsFor(body.w, s);
  const pad = Math.round(WIN_PAD * s);
  const labelX = body.x + m.icon + pad;
  const labelW = Math.max(0, body.x + body.w - labelX);
  let y = body.y;

  /** One block of round good buttons from `y` down, advancing `y` past it. */
  const marks = (
    choices: TradePanelModel['balance'],
    house: number,
    pair: number | null,
  ): TradeImportHit[] => {
    if (choices.length === 0) return [];
    y += m.stopGap;
    const hits = choices.map((choice, i) => ({
      house,
      pair,
      goodType: choice.goodType,
      ...(choice.goodId !== undefined ? { goodId: choice.goodId } : {}),
      label: choice.label,
      selected: choice.selected,
      rect: {
        x: body.x + (i % m.perRow) * (m.icon + m.iconGap),
        y: y + Math.floor(i / m.perRow) * (m.icon + m.iconGap),
        w: m.icon,
        h: m.icon,
      },
    }));
    const rows = Math.ceil(choices.length / m.perRow);
    y += rows * m.icon + (rows - 1) * m.iconGap;
    return hits;
  };

  let attach: TradeLayout['attach'] = null;
  const attachRow = (): void => {
    attach = {
      button: { action: 'attach-trade-house', enabled: true, rect: { x: body.x, y, w: m.icon, h: m.icon } },
      label: { x: labelX, y, w: labelW, h: m.icon },
    };
    y += m.icon + m.stopGap;
  };
  if (model.canAttach && model.attachFirst) attachRow();

  const stops: TradeStopLayout[] = model.stops.map((stop) => {
    const detach: ButtonHit = {
      action: 'detach-trade-house',
      enabled: true,
      rect: { x: body.x, y, w: m.icon, h: m.icon },
    };
    const label: Rect = { x: labelX, y, w: labelW, h: m.icon };
    y += m.icon;
    const imports = marks(stop.imports, stop.house, null);
    y += m.stopGap;
    return { house: stop.house, detach, label, imports };
  });

  if (model.canAttach && !model.attachFirst) attachRow();

  let balanceCaption: Rect | null = null;
  let balance: TradeImportHit[] = [];
  const [first, second] = model.stops;
  if (model.balance.length > 0 && first !== undefined && second !== undefined) {
    balanceCaption = { x: body.x, y, w: body.w, h: m.rowH };
    y += m.rowH;
    balance = marks(model.balance, first.house, second.house);
    y += m.stopGap;
  }

  let offersCaption: Rect | null = null;
  if (model.offers.length > 0) {
    offersCaption = { x: body.x, y, w: body.w, h: m.rowH };
    y += m.rowH;
  }
  const offers: TradeOfferHit[] = model.offers.map((offer) => {
    const rect: Rect = { x: body.x, y, w: body.w, h: m.icon };
    const button: Rect = { x: body.x, y, w: m.icon, h: m.icon };
    y += m.icon + m.stopGap;
    return { index: offer.index, label: offer.label, selected: offer.selected, rect, button };
  });

  const statusRows: Rect[] = model.status.map(() => {
    const rect: Rect = { x: body.x, y, w: body.w, h: m.rowH };
    y += m.rowH;
    return rect;
  });

  return { section, stops, attach, balanceCaption, balance, offersCaption, offers, statusRows };
}

/** {@link mapLayout}'s trade half: every rect through `fn`, the rest untouched. */
export function mapTradeLayout(layout: TradeLayout, fn: (r: Rect) => Rect): TradeLayout {
  return {
    section: {
      frame: fn(layout.section.frame),
      title: fn(layout.section.title),
      body: fn(layout.section.body),
    },
    stops: layout.stops.map((stop) => ({
      ...stop,
      detach: { ...stop.detach, rect: fn(stop.detach.rect) },
      label: fn(stop.label),
      imports: stop.imports.map((hit) => ({ ...hit, rect: fn(hit.rect) })),
    })),
    attach:
      layout.attach === null
        ? null
        : {
            button: { ...layout.attach.button, rect: fn(layout.attach.button.rect) },
            label: fn(layout.attach.label),
          },
    balanceCaption: layout.balanceCaption === null ? null : fn(layout.balanceCaption),
    balance: layout.balance.map((hit) => ({ ...hit, rect: fn(hit.rect) })),
    offersCaption: layout.offersCaption === null ? null : fn(layout.offersCaption),
    offers: layout.offers.map((hit) => ({ ...hit, rect: fn(hit.rect), button: fn(hit.button) })),
    statusRows: layout.statusRows.map(fn),
  };
}

/** The buttons the trade section exposes to pointer routing. */
export function tradeButtons(layout: TradeLayout | null): ButtonHit[] {
  if (layout === null) return [];
  const buttons = layout.stops.map((stop) => stop.detach);
  if (layout.attach !== null) buttons.push(layout.attach.button);
  return buttons;
}
