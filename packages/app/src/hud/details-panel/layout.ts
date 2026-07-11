import { WIN_PAD } from '../chrome.js';
import type { Rect } from '../geometry.js';
import type { UnitPanelModel } from './model.js';
import { stockTabRects } from './stock-tabs.js';

/**
 * The details panel's geometry, all in one place so the height a section RESERVES and the rows a section
 * DRAWS cannot drift apart. Metrics are design px (multiplied by uiscale here, so consumers only see
 * screen-px rects).
 *
 * Source basis: the original hardcodes this window's geometry in `Game.exe` (`CSelectionHouseWindow` is
 * named-only in OpenVikings, not decompiled), so every metric is an explicit approximation MEASURED off
 * native 1024×768 screenshots of the original (panel ≈322 px wide, preview ≈183 px square, headline
 * ≈18 px, button column ≈118×16, stock rows ≈22 px with a fixed six-row body, fixed worker body) —
 * pending human visual sign-off.
 */

/** Panel width measured off the 1024×768 original (≈322 px, right edge 6 px off the screen). */
const PANEL_W = 322;
/** Gap between the panel and the screen's right/bottom edge. */
const PANEL_MARGIN = 6;
/**
 * Vertical gap between two section windows. The original stacks them FLUSH (adjacent rope borders touch,
 * no parchment seam between), so this is 0; a positive value would show a thin background strip between
 * the workers/stock/general windows that the original doesn't have.
 */
const SECTION_GAP = 0;
/** The headline strip's height (fits the font-12 small-caps titles like the original). */
const TITLE_H = 18;
/** Vertical padding between a section's headline/body/end. */
const BODY_PAD_Y = 5;
/** A plain text row (key/value lines, worker rows). */
export const ROW_H = 15;
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
/** `bar_frame_96`'s decoded native width (96×18 atlas rect) — the design width bars are drawn at. */
export const BAR_NATIVE_W = 96;
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

/**
 * The stock body's cell rects (icon + amount plate together), COLUMN-MAJOR: the left column top→bottom,
 * then the right — the ONE geometry the stock rows draw into AND the hover hit-test probes, so a hovered
 * slot is exactly a drawn slot by construction. `rowsPerColumn * 2` slots: the tabbed store body reserves
 * its fixed {@link MAX_STOCK_ROWS}; a COMPACT store (few goods, no tabs) passes its own fitted row count.
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
 * The settler panel's portrait box (Ogólne, left) — a square, smaller than the building's 183 px preview
 * so the name + stat bars sit beside it in the right column (measured against the original's human window).
 */
const SETTLER_PREVIEW = 96;
/** The profession (name) line at the top of the Ogólne right column. */
const SETTLER_NAME_H = 15;
/** The owner/tribe/stance meta line under the name. */
const SETTLER_META_H = 14;
/** One stat-bar row in the Ogólne right column (label + bar). */
const BAR_ROW_H = 13;
/** Text rows the fixed Praca / Doświadczenie bodies reserve. */
const WORK_ROWS = 2;
const EXP_ROWS = 1;
/** One labeled equipment row (Buty/Narzędzia/…): a label column + a row of slot sockets. */
export const EQUIP_ROW_H = 24;
/** A round equipment-slot socket's square bounding box (design px). */
export const EQUIP_SOCKET = 18;
/** The use-% column drawn right of each socket (a wearing item's "degree of use"). */
export const EQUIP_USE_W = 28;
/** Gap after a socket's use-% column before the next socket (the misc Ekwipunek row). */
const EQUIP_SOCKET_GAP = 6;
/** The row-label column width before the sockets (fits the widest slot label, "Narzędzia"). */
export const EQUIP_LABEL_W = 74;

export type ButtonAction = 'demolish' | 'center' | 'workers' | 'help';

export interface ButtonHit {
  readonly action: ButtonAction;
  readonly rect: Rect;
  readonly enabled: boolean;
}

/** One section window: its whole frame, the headline strip, and the padded body below it. */
export interface SectionRect {
  readonly frame: Rect;
  readonly title: Rect;
  readonly body: Rect;
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
  readonly defence: SectionRect | null;
  readonly production: SectionRect | null;
  /** The Magazyn section — null for a building that stores NOTHING (no stock slots: a home), which
   *  simply has no store window, matching the original's per-building window set. */
  readonly stock: SectionRect | null;
  /**
   * Whether the stock body is the COMPACT shape — a small store (every good fits the grid at once,
   * `rows ≤ MAX_STOCK_ROWS × 2`: the farm's single wheat slot, a mill's two) drops the category tabs
   * and shrinks the body to exactly its rows ({@link stockRows}); only a big store (a warehouse's full
   * catalog) keeps the original's fixed-height eight-tab window. The dynamic-magazyn rule is a GENERAL
   * one, keyed on the good count — never a per-building-type branch.
   */
  readonly stockCompact: boolean;
  /** Rows per column the stock body reserves ({@link MAX_STOCK_ROWS}, or the compact fitted count). */
  readonly stockRows: number;
  /**
   * The eight category-tab plate rects at the top of the stock body — carried in the layout (like
   * {@link buttons}) so `mapLayout` derives the draw copy from the hit copy, and the drawn plate equals its
   * clickable rect by construction (never two independent `stockTabRects` roundings at different scales).
   * EMPTY for a compact/absent stock body (no tabs to click).
   */
  readonly stockTabHits: readonly Rect[];
  readonly workers: SectionRect;
}

/** One labeled equipment row's geometry: its label column + the slot sockets to its right. */
export interface EquipRowRect {
  readonly label: Rect;
  readonly slots: readonly Rect[];
}

/**
 * The settler view: the original's stacked human-window sections — Ogólne (portrait + name + meta + stat
 * bars), Praca (workplace + product), Doświadczenie (highest specialization), Ekwipunek (labeled slot
 * rows) — laid out like the building's section stack.
 */
export interface SettlerLayout {
  readonly kind: 'settler';
  readonly panel: Rect;
  readonly general: SectionRect;
  readonly preview: Rect;
  /** The profession (name) line, right of the portrait. */
  readonly name: Rect;
  /** The owner/tribe/stance meta line under the name. */
  readonly meta: Rect;
  /** One rect per `model.bars` entry (same order). */
  readonly bars: readonly Rect[];
  readonly work: SectionRect;
  /** The Praca body's two text rows (workplace, product). */
  readonly workRows: readonly Rect[];
  readonly experience: SectionRect;
  /** The Doświadczenie body's single text row. */
  readonly expRow: Rect;
  readonly equipment: SectionRect;
  /** One entry per `model.equipmentRows` (same order): its label rect + slot-socket rects. */
  readonly equipRows: readonly EquipRowRect[];
}

/** The multi-select / generic views: one section window with a single hint row. */
export interface CompactLayout {
  readonly kind: 'compact';
  readonly panel: Rect;
  readonly section: SectionRect;
}

export type DetailsLayout = BuildingLayout | SettlerLayout | CompactLayout;

/**
 * Apply `fn` to every rect in a layout, returning a new layout of the same shape. The off-screen
 * supersample DRAW layout is derived from the on-canvas HIT layout this way — scaled by the oversample /
 * display ratio and re-origined to the texture (see `panel.ts`) — so the drawn geometry equals the
 * hit-tested geometry by construction, never by two independent `layoutDetails` roundings agreeing.
 */
export function mapLayout<T extends DetailsLayout>(layout: T, fn: (r: Rect) => Rect): T {
  const sec = (s: SectionRect): SectionRect => ({ frame: fn(s.frame), title: fn(s.title), body: fn(s.body) });
  if (layout.kind === 'building') {
    return {
      ...layout,
      panel: fn(layout.panel),
      general: sec(layout.general),
      preview: fn(layout.preview),
      name: fn(layout.name),
      underline: fn(layout.underline),
      buttons: layout.buttons.map((b) => ({ ...b, rect: fn(b.rect) })),
      defence: layout.defence ? sec(layout.defence) : null,
      production: layout.production ? sec(layout.production) : null,
      stock: layout.stock ? sec(layout.stock) : null,
      stockTabHits: layout.stockTabHits.map(fn),
      workers: sec(layout.workers),
    };
  }
  if (layout.kind === 'settler') {
    return {
      ...layout,
      panel: fn(layout.panel),
      general: sec(layout.general),
      preview: fn(layout.preview),
      name: fn(layout.name),
      meta: fn(layout.meta),
      bars: layout.bars.map(fn),
      work: sec(layout.work),
      workRows: layout.workRows.map(fn),
      experience: sec(layout.experience),
      expRow: fn(layout.expRow),
      equipment: sec(layout.equipment),
      equipRows: layout.equipRows.map((r) => ({ label: fn(r.label), slots: r.slots.map(fn) })),
    };
  }
  return { ...layout, panel: fn(layout.panel), section: sec(layout.section) };
}

/** Which buttons the building's general section offers; only demolish is wired on this slice. */
const BUILDING_BUTTONS: ReadonlyArray<{ action: ButtonAction; enabled: boolean }> = [
  { action: 'demolish', enabled: true },
  { action: 'center', enabled: false },
  { action: 'workers', enabled: false },
  { action: 'help', enabled: false },
];

/** Compact (multi/generic) rows: the count lives in the headline, the body is the controls hint. */
const COMPACT_ROWS = 1;

function sectionAt(x: number, y: number, w: number, bodyH: number, s: number): SectionRect {
  const titleH = Math.round(TITLE_H * s);
  const pad = Math.round(BODY_PAD_Y * s);
  const frame: Rect = { x, y, w, h: titleH + pad + bodyH + pad };
  return {
    frame,
    title: { x, y, w, h: titleH },
    body: {
      x: x + Math.round(WIN_PAD * s),
      y: y + titleH + pad,
      w: w - 2 * Math.round(WIN_PAD * s),
      h: bodyH,
    },
  };
}

function panelRect(totalH: number, screen: { width: number; height: number }, s: number): Rect {
  const w = Math.round(PANEL_W * s);
  const margin = Math.round(PANEL_MARGIN * s);
  return {
    x: Math.max(margin, screen.width - w - margin),
    y: Math.max(margin, screen.height - totalH - margin),
    w,
    h: totalH,
  };
}

export function layoutDetails(
  model: UnitPanelModel,
  screen: { readonly width: number; readonly height: number },
  s: number,
): DetailsLayout | null {
  if (model.kind === 'empty') return null;
  const w = Math.round(PANEL_W * s);
  const gap = Math.round(SECTION_GAP * s);

  if (model.kind === 'multi-settler' || model.kind === 'generic') {
    const bodyH = COMPACT_ROWS * Math.round(ROW_H * s);
    const probe = sectionAt(0, 0, w, bodyH, s);
    const panel = panelRect(probe.frame.h, screen, s);
    return { kind: 'compact', panel, section: sectionAt(panel.x, panel.y, w, bodyH, s) };
  }

  if (model.kind === 'settler') {
    // Stacked sections, bottom-anchored like the building panel. Each body reserves a fixed height (the
    // original's human window doesn't fit-to-content); the equipment body scales with its row count.
    const pad = Math.round(WIN_PAD * s);
    const rowH = Math.round(ROW_H * s);
    const barRowH = Math.round(BAR_ROW_H * s);
    const equipRowH = Math.round(EQUIP_ROW_H * s);
    const generalBodyH = Math.round(SETTLER_PREVIEW * s);
    const workBodyH = WORK_ROWS * rowH;
    const expBodyH = EXP_ROWS * rowH;
    const equipBodyH = model.equipmentRows.length * equipRowH;

    const heights = [generalBodyH, workBodyH, expBodyH, equipBodyH].map(
      (bodyH) => sectionAt(0, 0, w, bodyH, s).frame.h,
    );
    const gaps = gap * (heights.length - 1);
    const panel = panelRect(heights.reduce((a, b) => a + b, 0) + gaps, screen, s);

    let y = panel.y;
    const next = (bodyH: number): SectionRect => {
      const sec = sectionAt(panel.x, y, w, bodyH, s);
      y += sec.frame.h + gap;
      return sec;
    };

    // Ogólne: the portrait box (left) + the name / meta / stat-bar column (right).
    const general = next(generalBodyH);
    const preview: Rect = {
      x: general.body.x,
      y: general.body.y,
      w: Math.round(SETTLER_PREVIEW * s),
      h: general.body.h,
    };
    const colX = preview.x + preview.w + pad;
    const colW = general.body.x + general.body.w - colX;
    const name: Rect = { x: colX, y: general.body.y, w: colW, h: Math.round(SETTLER_NAME_H * s) };
    const meta: Rect = { x: colX, y: name.y + name.h, w: colW, h: Math.round(SETTLER_META_H * s) };
    const barsTop = meta.y + meta.h;
    const bars: Rect[] = model.bars.map((_, i) => ({
      x: colX,
      y: barsTop + i * barRowH,
      w: colW,
      h: barRowH,
    }));

    const work = next(workBodyH);
    const workRows: Rect[] = Array.from({ length: WORK_ROWS }, (_unused, i) => ({
      x: work.body.x,
      y: work.body.y + i * rowH,
      w: work.body.w,
      h: rowH,
    }));

    const experience = next(expBodyH);
    const expRow: Rect = { x: experience.body.x, y: experience.body.y, w: experience.body.w, h: rowH };

    // Ekwipunek: one labeled row per equipment slot group — a label column, then the slot sockets.
    const equipment = next(equipBodyH);
    const socket = Math.round(EQUIP_SOCKET * s);
    const labelW = Math.round(EQUIP_LABEL_W * s);
    // Each socket owns a pitch of itself + its use-% column + a trailing gap, so the misc row's sockets
    // and their percentages don't collide.
    const pitch = socket + Math.round(EQUIP_USE_W * s) + Math.round(EQUIP_SOCKET_GAP * s);
    const socketPadY = Math.round((equipRowH - socket) / 2);
    const equipRows: EquipRowRect[] = model.equipmentRows.map((row, i) => {
      const rowY = equipment.body.y + i * equipRowH;
      const label: Rect = { x: equipment.body.x, y: rowY, w: labelW, h: equipRowH };
      const slotsX = equipment.body.x + labelW;
      const slots: Rect[] = row.slots.map((_unused, j) => ({
        x: slotsX + j * pitch,
        y: rowY + socketPadY,
        w: socket,
        h: socket,
      }));
      return { label, slots };
    });

    return {
      kind: 'settler',
      panel,
      general,
      preview,
      name,
      meta,
      bars,
      work,
      workRows,
      experience,
      expRow,
      equipment,
      equipRows,
    };
  }

  // Building: measure each section, then stack bottom-anchored. The TABBED stock and the workers body
  // reserve their FULL fixed height regardless of content — the original's windows keep their height,
  // they don't shrink; a COMPACT stock (every good fits at once — few slots, no tabs) instead fits its
  // rows exactly, and a store-less building (a home) has no Magazyn window at all.
  const pad = Math.round(WIN_PAD * s);
  const buttonH = Math.round(BUTTON_H * s);
  const buttonGap = Math.round(BUTTON_GAP * s);
  const generalBodyH = Math.round(PREVIEW_H * s);
  const defenceBodyH = model.showDefense ? Math.round(ROW_H * s) : 0;
  const productionBodyH = model.production !== null ? Math.round(STOCK_ROW_H * s) : 0;
  const stockRowCount = model.stock.length;
  const stockCompact = stockRowCount <= MAX_STOCK_ROWS * 2;
  const stockRows = stockCompact ? Math.ceil(stockRowCount / 2) : MAX_STOCK_ROWS;
  const stockBodyH =
    (stockCompact ? 0 : Math.round(STOCK_TAB_H * s) + Math.round(STOCK_TAB_GAP * s)) +
    stockRows * Math.round(STOCK_ROW_H * s);
  const workersBodyH = MAX_WORKER_ROWS * Math.round(ROW_H * s);

  const heights = [
    sectionAt(0, 0, w, generalBodyH, s).frame.h,
    model.showDefense ? sectionAt(0, 0, w, defenceBodyH, s).frame.h : 0,
    model.production !== null ? sectionAt(0, 0, w, productionBodyH, s).frame.h : 0,
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

  const defence = model.showDefense ? next(defenceBodyH) : null;
  const production = model.production !== null ? next(productionBodyH) : null;
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
    stockTabHits = stockTabRects(stockTabStrip, s);
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
    defence,
    production,
    stock,
    stockCompact,
    stockRows,
    stockTabHits,
    workers,
  };
}
