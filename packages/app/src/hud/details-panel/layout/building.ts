import { WIN_PAD } from '../../chrome.js';
import type { Rect } from '../../geometry.js';
import type { UnitPanelModel } from '../model/index.js';
import { DETAILS_STOCK_TAB_COUNT, stockTabRects } from '../stock-tabs.js';
import { PANEL_W, panelRect, ROW_H, SECTION_GAP, type SectionRect, sectionAt } from './shared.js';

type BuildingModel = Extract<UnitPanelModel, { kind: 'building' }>;

/** A stock cell row (icon + amount plate) - ≈22 px in the original. */
export const STOCK_ROW_H = 22;
/** Height of the stock body's category-tab strip, matching the decoded tab plate. */
const STOCK_TAB_H = 18;
/** Gap under the tab strip before the first stock row. */
const STOCK_TAB_GAP = 4;
const BUTTON_H = 16;
const BUTTON_GAP = 4;
/** The general section's building-preview box (≈183 px square in the original). */
const PREVIEW_W = 183;
const PREVIEW_H = 183;
/** The building-name line at the top of the right column. */
const NAME_H = 14;
/** The health gauge's top, under the name line; an approximation, not measured off the original. */
const HEALTH_BAR_TOP = 22;
/** Buttons start this far below the general body's top: the original puts the name and a capacity line
 *  (`housewindow` 21 "Ładowność", not drawn here) above them, and the health gauge shares that room. */
const BUTTONS_TOP = 60;
/** The defence body's single row: a text line plus the round alarm toggle, so taller than {@link ROW_H}. */
const DEFENCE_ROW_H = 20;
/** The alarm toggle's diameter, matching the equip-slot action button it copies. */
const DEFENCE_TOGGLE_BTN = 15;
/** Gap between the alarm toggle and the status line it leads. */
export const DEFENCE_LABEL_GAP = 5;
/** Need/progress bar height. */
export const BAR_H = 10;
/** Inset between the preview box's frame and the building bob drawn inside it. */
export const PREVIEW_INSET = 4;
/** The amount plate's height inside a {@link STOCK_ROW_H} stock cell (≈11 px in the original). */
export const STOCK_PLATE_H = 11;
/** Stock rows per column (two columns); the body reserves them all, since the original's stock window is
 *  fixed-height rather than fit-to-content. */
export const MAX_STOCK_ROWS = 6;
/** Worker rows the fixed-height workers body always reserves (the original's bottom window ≈4 rows). */
const MAX_WORKER_ROWS = 4;
/** Horizontal gap between the stock window's two columns. */
const STOCK_COL_GAP = WIN_PAD;

export type ButtonAction =
  | 'upgrade'
  | 'cancelUpgrade'
  | 'demolish'
  | 'center'
  | 'workers'
  | 'help'
  | 'toggle-defence'
  | 'assign-workplace'
  | 'unassign-workplace'
  | 'assign-home'
  | 'unassign-home';

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
  readonly name: Rect;
  /** Laid out for every building; `model.health` alone decides whether anything is drawn there. */
  readonly health: Rect;
  readonly buttons: readonly ButtonHit[];
  /** Replaces defence/production/stock while the building is a site; null once built. */
  readonly construction: SectionRect | null;
  readonly defence: SectionRect | null;
  /** Null whenever there is no defence window. */
  readonly defenceToggle: ButtonHit | null;
  readonly production: SectionRect | null;
  /** One rect per `ProductionModel.rows` entry; empty for a farm's fields view or no production window. */
  readonly productionRowRects: readonly Rect[];
  /** Null for a building that stores nothing, which has no store window at all. */
  readonly stock: SectionRect | null;
  /** Whether the stock body drops the category tabs and sizes itself to its rows, a shape keyed on the
   *  good count rather than the building type. */
  readonly stockCompact: boolean;
  /** Rows per column the stock body reserves ({@link MAX_STOCK_ROWS}, or the compact fitted count). */
  readonly stockRows: number;
  /** The category-tab plate rects at the top of the stock body; empty for a compact or absent one. */
  readonly stockTabHits: readonly Rect[];
  /** Always present: a construction site keeps its workers window. */
  readonly workers: SectionRect;
}

/**
 * The stock body's cell rects (icon + amount plate together), column-major: the left column top→bottom,
 * then the right. `s` is the caller's scale, so the same fixed metrics resolve into draw or hit space.
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

/** A store with up to this many goods draws the compact tab-less body; bigger stores keep the fixed
 *  tabbed window. Sized to the mint's 16 slots, the biggest specialist workshop store. */
const COMPACT_STOCK_MAX = 16;

/** Both upgrade actions sit above demolish, matching the original's button order; a building under
 *  upgrade is never also upgradable, so the two never appear together. */
function buildingButtons(model: BuildingModel): ReadonlyArray<{ action: ButtonAction; enabled: boolean }> {
  return [
    ...(model.upgradable ? [{ action: 'upgrade', enabled: !model.upgradeBlockedReason } as const] : []),
    ...(model.cancelable ? [{ action: 'cancelUpgrade', enabled: true } as const] : []),
    { action: 'demolish', enabled: true },
    { action: 'center', enabled: true },
    { action: 'workers', enabled: false },
    { action: 'help', enabled: false },
  ];
}

/** Always enabled: raising or lowering the alarm is legal for any building that has the window at all. */
function defenceToggleHit(body: Rect, s: number): ButtonHit {
  const size = Math.round(DEFENCE_TOGGLE_BTN * s);
  return {
    action: 'toggle-defence',
    enabled: true,
    rect: {
      x: body.x,
      y: body.y + Math.round((body.h - size) / 2),
      w: size,
      h: size,
    },
  };
}

export function layoutBuilding(
  model: BuildingModel,
  screen: { readonly width: number; readonly height: number },
  s: number,
): BuildingLayout {
  const w = Math.round(PANEL_W * s);
  const gap = Math.round(SECTION_GAP * s);

  const pad = Math.round(WIN_PAD * s);
  const buttonH = Math.round(BUTTON_H * s);
  const buttonGap = Math.round(BUTTON_GAP * s);
  const generalBodyH = Math.round(PREVIEW_H * s);
  const underConstruction = model.construction !== null;
  // The Construction window's body is one gauge row plus one row per material line.
  const constructionBodyH = underConstruction
    ? (1 + (model.construction?.rows.length ?? 0)) * Math.round(STOCK_ROW_H * s)
    : 0;
  const showDefence = model.showDefense && !underConstruction;
  const showProduction = model.production !== null && !underConstruction;
  const defenceBodyH = showDefence ? Math.round(DEFENCE_ROW_H * s) : 0;
  // A recipe workshop reserves one row per producible good; a farm's field counters keep a single row.
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
  const health: Rect = {
    x: columnX,
    y: general.body.y + Math.round(HEALTH_BAR_TOP * s),
    w: columnW,
    h: Math.round(BAR_H * s),
  };
  const buttons: ButtonHit[] = buildingButtons(model).map((b, i) => ({
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
  const defenceToggle: ButtonHit | null = defence === null ? null : defenceToggleHit(defence.body, s);
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
    health,
    buttons,
    construction,
    defence,
    defenceToggle,
    production,
    productionRowRects,
    stock,
    stockCompact,
    stockRows,
    stockTabHits,
    workers,
  };
}
