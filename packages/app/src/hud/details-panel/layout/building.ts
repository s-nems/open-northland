import { WIN_PAD } from '../../chrome.js';
import type { Rect } from '../../geometry.js';
import type { UnitPanelModel } from '../model/index.js';
import { DETAILS_STOCK_TAB_COUNT, stockTabRects } from '../stock-tabs.js';
import { PANEL_W, panelRect, ROW_H, SECTION_GAP, type SectionRect, sectionAt } from './shared.js';

/** The building selection model — the `layoutBuilding` input narrowed off the panel model union. */
type BuildingModel = Extract<UnitPanelModel, { kind: 'building' }>;

/** A stock cell row (icon + amount plate) — ≈22 px in the original. */
export const STOCK_ROW_H = 22;
/** The stock section's category-tab strip (the row of eight 32×18 tab plates). */
export const STOCK_TAB_H = 18;
/** Gap under the tab strip before the first stock row. */
const STOCK_TAB_GAP = 4;
const BUTTON_H = 16;
const BUTTON_GAP = 4;
/** The general section's building-preview box (≈183 px square in the original). */
const PREVIEW_W = 183;
const PREVIEW_H = 183;
/** The building-name line at the top of the right column. */
const NAME_H = 14;
/** The yellow-green selected strip under the name (≈5 px in the original). */
export const UNDERLINE_H = 5;
/**
 * Buttons start this far below the general body's top — the original puts the name, its underline, and a
 * capacity line ("Pojemność: 100", not yet extracted) above them; the offset reserves that room.
 */
const BUTTONS_TOP = 60;
/** Need/progress bar height. */
export const BAR_H = 10;
/** Inset between the preview box's frame and the building bob drawn inside it. */
export const PREVIEW_INSET = 4;
/** The amount plate's height inside a {@link STOCK_ROW_H} stock cell (≈11 px in the original). */
export const STOCK_PLATE_H = 11;
/**
 * Stock rows per column (two columns side by side). The body always reserves all six rows — the
 * original's stock window is fixed-height, not fit-to-content.
 */
export const MAX_STOCK_ROWS = 6;
/** Worker rows the fixed-height workers body always reserves (the original's bottom window ≈4 rows). */
export const MAX_WORKER_ROWS = 4;
/** Horizontal gap between the stock window's two columns (a window pad). */
export const STOCK_COL_GAP = WIN_PAD;

export type ButtonAction = 'demolish' | 'center' | 'workers' | 'help' | 'assign-workplace';

export interface ButtonHit {
  readonly action: ButtonAction;
  readonly rect: Rect;
  readonly enabled: boolean;
}

export interface BuildingLayout {
  readonly kind: 'building';
  readonly panel: Rect;
  readonly general: SectionRect;
  readonly preview: Rect;
  /** The building-name line at the top of the right column. */
  readonly name: Rect;
  /** The selected strip directly under the name line. */
  readonly underline: Rect;
  readonly buttons: readonly ButtonHit[];
  /** The Construction section — replaces defence/production/stock/workers while the building is a
   *  site (those windows mean nothing before completion). Null once built. */
  readonly construction: SectionRect | null;
  readonly defence: SectionRect | null;
  readonly production: SectionRect | null;
  /** One rect per Produkcja product row (same order as `ProductionModel.rows`) — the hover target the
   *  inputs tooltip probes; empty for a farm's fields view or no production window. */
  readonly productionRowRects: readonly Rect[];
  /** The Magazyn section — null for a building that stores nothing (no stock slots: a home), which
   *  simply has no store window, matching the original's per-building window set. */
  readonly stock: SectionRect | null;
  /**
   * Whether the stock body is the compact shape — a small store (up to {@link COMPACT_STOCK_MAX}
   * goods: the farm's single wheat slot, the mint's 16) drops the category tabs and sizes the body to
   * exactly its rows ({@link stockRows}); only a big store (a warehouse's full catalog) keeps the
   * original's fixed-height tabbed window. The dynamic-magazyn rule is a general one, keyed on the
   * good count — never a per-building-type branch.
   */
  readonly stockCompact: boolean;
  /** Rows per column the stock body reserves ({@link MAX_STOCK_ROWS}, or the compact fitted count). */
  readonly stockRows: number;
  /**
   * The eight category-tab plate rects at the top of the stock body — carried in the layout (like
   * {@link buttons}) so `mapLayout` derives the draw copy from the hit copy, and the drawn plate equals its
   * clickable rect by construction (never two independent `stockTabRects` roundings at different scales).
   * Empty for a compact/absent stock body (no tabs to click).
   */
  readonly stockTabHits: readonly Rect[];
  /** Always present: for a finished building the bound workers, for a construction site the live
   *  building crew (the panel feeds the overlay a different selector — see panel.ts). */
  readonly workers: SectionRect;
}

/**
 * The stock body's cell rects (icon + amount plate together), column-major: the left column top→bottom,
 * then the right — the one geometry the stock rows draw into and the hover hit-test probes, so a hovered
 * slot is exactly a drawn slot by construction. `rowsPerColumn * 2` slots: the tabbed store body reserves
 * its fixed {@link MAX_STOCK_ROWS}; a compact store (few goods, no tabs) passes its own fitted row count.
 * A slot past the current good count is simply empty. `s` is the caller's scale (the draw oversample
 * `ss`, or the hit scale), so the same fixed metrics resolve into either space.
 */
export function stockSlotRects(body: Rect, s: number, rowsPerColumn: number = MAX_STOCK_ROWS): Rect[] {
  const colGap = Math.round(STOCK_COL_GAP * s);
  const colW = Math.round((body.w - colGap) / 2);
  const cellH = Math.round(STOCK_ROW_H * s);
  // Rows fill the body bottom-up; whatever the tab strip leaves over becomes the gap under it.
  const rowsTop = body.y + body.h - rowsPerColumn * cellH;
  const slots: Rect[] = [];
  for (let i = 0; i < rowsPerColumn * 2; i++) {
    const col = Math.floor(i / rowsPerColumn);
    slots.push({
      x: body.x + col * (colW + colGap),
      y: rowsTop + (i % rowsPerColumn) * cellH,
      w: colW,
      h: cellH,
    });
  }
  return slots;
}

/**
 * A store with up to this many goods draws the compact tab-less body (fitted rows, taller panel);
 * bigger stores (the barracks' arsenal, the warehouse/HQ catalogs) keep the fixed tabbed window.
 * Sized to the biggest specialist workshop store — the mint's 16 slots — which should read on one
 * page (user decision 2026-07-16); the rule stays keyed on the good count, never the building type.
 */
const COMPACT_STOCK_MAX = 16;

/** Which buttons the building's general section offers; only demolish is wired on this slice. */
const BUILDING_BUTTONS: ReadonlyArray<{ action: ButtonAction; enabled: boolean }> = [
  { action: 'demolish', enabled: true },
  { action: 'center', enabled: false },
  { action: 'workers', enabled: false },
  { action: 'help', enabled: false },
];

export function layoutBuilding(
  model: BuildingModel,
  screen: { readonly width: number; readonly height: number },
  s: number,
): BuildingLayout {
  const w = Math.round(PANEL_W * s);
  const gap = Math.round(SECTION_GAP * s);

  // Building: measure each section, then stack bottom-anchored.
  const pad = Math.round(WIN_PAD * s);
  const buttonH = Math.round(BUTTON_H * s);
  const buttonGap = Math.round(BUTTON_GAP * s);
  const generalBodyH = Math.round(PREVIEW_H * s);
  // A construction site swaps production/stock/defence for the Construction window (delivered materials
  // would otherwise read as store stock). The workers window stays — it shows the live building crew
  // (user-requested). The Construction body is one gauge row + one row per material line.
  const underConstruction = model.construction !== null;
  const constructionBodyH = underConstruction
    ? (1 + (model.construction?.rows.length ?? 0)) * Math.round(STOCK_ROW_H * s)
    : 0;
  const showDefence = model.showDefense && !underConstruction;
  const showProduction = model.production !== null && !underConstruction;
  const defenceBodyH = showDefence ? Math.round(ROW_H * s) : 0;
  // A recipe workshop reserves one row per producible good (`ProductionModel.rows` — the model is
  // the single source, the section's row loop draws the same count); a farm's field counters keep
  // the single row.
  const productionRows = model.production?.kind === 'recipe' ? Math.max(1, model.production.rows.length) : 1;
  const productionBodyH = showProduction ? productionRows * Math.round(STOCK_ROW_H * s) : 0;
  const stockRowCount = underConstruction ? 0 : model.stock.length;
  const stockCompact = stockRowCount <= COMPACT_STOCK_MAX;
  const stockRows = stockCompact ? Math.ceil(stockRowCount / 2) : MAX_STOCK_ROWS;
  const stockBodyH =
    (stockCompact ? 0 : Math.round(STOCK_TAB_H * s) + Math.round(STOCK_TAB_GAP * s)) +
    stockRows * Math.round(STOCK_ROW_H * s);
  const workersBodyH = MAX_WORKER_ROWS * Math.round(ROW_H * s);

  const heights = [
    sectionAt(0, 0, w, generalBodyH, s).frame.h,
    underConstruction ? sectionAt(0, 0, w, constructionBodyH, s).frame.h : 0,
    showDefence ? sectionAt(0, 0, w, defenceBodyH, s).frame.h : 0,
    showProduction ? sectionAt(0, 0, w, productionBodyH, s).frame.h : 0,
    stockRowCount > 0 ? sectionAt(0, 0, w, stockBodyH, s).frame.h : 0,
    sectionAt(0, 0, w, workersBodyH, s).frame.h,
  ];
  const gaps = gap * (heights.filter((h) => h > 0).length - 1);
  const panel = panelRect(heights.reduce((a, b) => a + b, 0) + gaps, screen, s);

  let y = panel.y;
  const next = (bodyH: number): SectionRect => {
    const sec = sectionAt(panel.x, y, w, bodyH, s);
    y += sec.frame.h + gap;
    return sec;
  };

  const general = next(generalBodyH);
  const preview: Rect = {
    x: general.body.x,
    y: general.body.y,
    w: Math.round(PREVIEW_W * s),
    h: general.body.h,
  };
  const columnX = preview.x + preview.w + pad;
  const columnW = general.frame.x + general.frame.w - pad - columnX;
  const name: Rect = { x: columnX, y: general.body.y, w: columnW, h: Math.round(NAME_H * s) };
  const underline: Rect = {
    x: columnX,
    y: name.y + name.h,
    w: columnW,
    h: Math.round(UNDERLINE_H * s),
  };
  const buttons: ButtonHit[] = BUILDING_BUTTONS.map((b, i) => ({
    action: b.action,
    enabled: b.enabled,
    rect: {
      x: columnX,
      y: general.body.y + Math.round(BUTTONS_TOP * s) + i * (buttonH + buttonGap),
      w: columnW,
      h: buttonH,
    },
  }));

  const construction = underConstruction ? next(constructionBodyH) : null;
  const defence = showDefence ? next(defenceBodyH) : null;
  const production = showProduction ? next(productionBodyH) : null;
  const productionRowRects: Rect[] =
    production !== null && model.production?.kind === 'recipe'
      ? model.production.rows.map((_, i) => ({
          x: production.body.x,
          y: production.body.y + i * Math.round(STOCK_ROW_H * s),
          w: production.body.w,
          h: Math.round(STOCK_ROW_H * s),
        }))
      : [];
  const stock = stockRowCount > 0 ? next(stockBodyH) : null;
  // Only the full tabbed store carries clickable tabs; a compact/absent body has none.
  let stockTabHits: readonly Rect[] = [];
  if (stock !== null && !stockCompact) {
    const stockTabStrip: Rect = {
      x: stock.body.x,
      y: stock.body.y,
      w: stock.body.w,
      h: Math.round(STOCK_TAB_H * s),
    };
    stockTabHits = stockTabRects(stockTabStrip, s, DETAILS_STOCK_TAB_COUNT);
  }
  const workers = next(workersBodyH);

  return {
    kind: 'building',
    panel,
    general,
    preview,
    name,
    underline,
    buttons,
    construction,
    defence,
    production,
    productionRowRects,
    stock,
    stockCompact,
    stockRows,
    stockTabHits,
    workers,
  };
}
