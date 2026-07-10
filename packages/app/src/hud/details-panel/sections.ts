import { GUI_FRAME } from '../../content/gui-atlas-map.js';
import type { UiString } from '../../content/gui-gfx.js';
import { WIN_PAD } from '../chrome.js';
import type { Rect } from '../geometry.js';
import type { Chrome } from './chrome.js';
import {
  BAR_H,
  BAR_NATIVE_W,
  type BuildingLayout,
  type ButtonAction,
  MAX_STOCK_ROWS,
  MAX_WORKER_ROWS,
  PREVIEW_INSET,
  ROW_H,
  STOCK_PLATE_H,
  STOCK_ROW_H,
  type SimpleLayout,
} from './layout.js';
import type {
  BuildingPanelModel,
  GenericSelectionPanelModel,
  MultiSettlerPanelModel,
  SettlerPanelModel,
} from './model.js';

/**
 * The decoded `housewindow` string ids the building sections consume (see `content/gui/strings/<lang>.json`,
 * decoded from the original `ingamegui` tables) — titles and button labels come from the original, with
 * pinned Polish fallbacks for a checkout without `content/`.
 */
const HOUSEWINDOW = {
  general: 1, // 'Ogólny'
  defence: 2, // 'Obrona'
  stock: 5, // 'Magazyn'
  workers: 7, // 'Pracownicy'
  demolish: 114, // 'Zniszcz'
  center: 116, // 'Wycentruj'
  workersButton: 118, // 'Pracownicy'
  help: 120, // 'Pomoc'
} as const;
/** `humanwindow` 0: 'Poddany' — the settler window's own name. */
const HUMANWINDOW_TITLE = 0;
/** `humanlistwindow` 2: 'Liczba poddanych na liście: %d'. */
const HUMANLIST_COUNT = 2;

const BUTTON_STRING: Readonly<Record<ButtonAction, { id: number; fallback: string }>> = {
  demolish: { id: HOUSEWINDOW.demolish, fallback: 'Zniszcz' },
  center: { id: HOUSEWINDOW.center, fallback: 'Wycentruj' },
  workers: { id: HOUSEWINDOW.workersButton, fallback: 'Pracownicy' },
  help: { id: HOUSEWINDOW.help, fallback: 'Pomoc' },
};

/** Top padding that vertically centers a font-10 line in a {@link ROW_H} row. */
const ROW_TEXT_PAD = 2;
/** Stock cell: icon slot width before the amount plate (≈15 px icon + a small gap in the original). */
const STOCK_ICON_W = 18;
/** Gap between the two stock columns. */
const STOCK_COL_GAP = WIN_PAD;
/** Left inset of the amount text inside its plate (eyeballed off the 1024×768 screenshots). */
const STOCK_AMOUNT_INSET = 6;
/** How strongly an inactive stock tab is dimmed (translucent dark scrim alpha) vs. the active one. */
const STOCK_TAB_DIM_ALPHA = 0.5;
/** The active stock tab's lime underline height in design px (kept ≥2 screen px so it reads at uiscale 1). */
const STOCK_TAB_UNDERLINE_H = 2;
/** Design width of the settler need-bar block (label column before it, pct column after). */
const NEED_LABEL_W = 84;
const NEED_PCT_W = 30;
/** Key column width of a key/value row. */
const KV_KEY_W = 82;

/**
 * Stock amounts render with one decimal, LEFT-aligned inside the plate ("15.0") — both observed off
 * the original's 1024×768 screenshots.
 */
function stockAmount(amount: number): string {
  return amount.toFixed(1);
}

export function drawBuilding(
  chrome: Chrome,
  layout: BuildingLayout,
  model: BuildingPanelModel,
  ui: UiString,
  hover: ButtonAction | null,
  activeTab: number,
  s: number,
): void {
  chrome.window(layout.general.frame);
  chrome.headline(layout.general.title, ui('housewindow', HOUSEWINDOW.general, 'Ogólny'));

  // Preview: a thin-bevel inner box with the building's real world bob fitted inside.
  chrome.innerBox(layout.preview);
  const previewInset = Math.round(PREVIEW_INSET * s);
  const previewArt: Rect = {
    x: layout.preview.x + previewInset,
    y: layout.preview.y + previewInset,
    w: layout.preview.w - previewInset * 2,
    h: layout.preview.h - previewInset * 2,
  };
  if (!chrome.buildingPreview(model.typeId, previewArt)) {
    chrome.guiCentered(GUI_FRAME.house_plate, layout.preview, 'magenta', 'bg_normal');
    chrome.guiCentered(GUI_FRAME.tool_button_buildings, layout.preview, 'full');
  }

  // Name line + the selected-strip under it (the original highlights the selected house's name row).
  chrome.textCentered(model.title, layout.name, 'white');
  chrome.selectedUnderline(layout.underline);

  for (const hit of layout.buttons) {
    const str = BUTTON_STRING[hit.action];
    chrome.button(hit, ui('housewindow', str.id, str.fallback), hover === hit.action);
  }

  if (layout.defence !== null) {
    chrome.window(layout.defence.frame);
    chrome.headline(layout.defence.title, ui('housewindow', HOUSEWINDOW.defence, 'Obrona'));
    // Light body text like the original's defence status line (screenshot-observed).
    chrome.textAt(
      model.defenseLabel,
      layout.defence.body.x,
      layout.defence.body.y + ROW_TEXT_PAD * s,
      'white',
    );
  }

  if (layout.production !== null && model.production !== null) {
    chrome.window(layout.production.frame);
    // No extracted title for the production strip (the original folds it into per-building tabs) —
    // 'Produkcja' is a named approximation.
    chrome.headline(layout.production.title, 'Produkcja');
    const body = layout.production.body;
    const barW = Math.round(BAR_NATIVE_W * s);
    chrome.textAt(model.production.label, body.x, body.y + ROW_TEXT_PAD * s, 'white');
    chrome.bar(
      {
        x: body.x + body.w - barW,
        y: body.y + Math.round((STOCK_ROW_H - BAR_H) * s) / 2,
        w: barW,
        h: Math.round(BAR_H * s),
      },
      model.production.pct,
    );
  }

  chrome.window(layout.stock.frame);
  chrome.headline(layout.stock.title, ui('housewindow', HOUSEWINDOW.stock, 'Magazyn'));
  drawStockTabs(chrome, layout.stockTabHits, activeTab, s);
  {
    const body = layout.stock.body;
    const colGap = Math.round(STOCK_COL_GAP * s);
    const colW = Math.round((body.w - colGap) / 2);
    const cellH = Math.round(STOCK_ROW_H * s);
    // Rows fill the fixed body bottom-up; whatever the tab strip leaves over becomes the gap under it.
    const rowsTop = body.y + body.h - MAX_STOCK_ROWS * cellH;
    // Only the active category tab's goods are listed (the original filters the store by tab).
    const rows = model.stock.filter((row) => row.category === activeTab);
    const shown = rows.slice(0, MAX_STOCK_ROWS * 2);
    shown.forEach((row, i) => {
      // Column-major like the original's two stock columns: fill the left column, then the right.
      const col = Math.floor(i / MAX_STOCK_ROWS);
      const x = body.x + col * (colW + colGap);
      const y = rowsTop + (i % MAX_STOCK_ROWS) * cellH;
      const icon: Rect = { x, y, w: Math.round(STOCK_ICON_W * s), h: cellH - Math.round(2 * s) };
      const plate: Rect = {
        x: x + icon.w,
        y: y + Math.round((STOCK_ROW_H - STOCK_PLATE_H) * s) / 2,
        w: colW - icon.w,
        h: Math.round(STOCK_PLATE_H * s),
      };
      chrome.stockField(plate);
      // The good's recoloured pile icon sits on the wood, LEFT of the amount plate (drawn after the plate
      // so a slightly oversized pile overlaps its edge rather than being clipped) — the original's row look.
      if (row.goodId !== undefined) chrome.goodIcon(row.goodId, icon);
      chrome.textAt(
        stockAmount(row.amount),
        plate.x + Math.round(STOCK_AMOUNT_INSET * s),
        y + ROW_TEXT_PAD * s,
        'white',
      );
    });
    if (rows.length > shown.length) {
      chrome.textRight(
        `+${rows.length - shown.length}`,
        body.x + body.w,
        body.y - Math.round(2 * s),
        'dimmed',
      );
    }
  }

  chrome.window(layout.workers.frame);
  // One line PER TRADE with its filled/capacity ("Cieśla 1/3 · Tragarz 1/1 · Zbieracz 0/1"), so the
  // player sees each slot's own limit — not one aggregate; the trade's role reads off the door-badge colour.
  chrome.headline(layout.workers.title, ui('housewindow', HOUSEWINDOW.workers, 'Pracownicy'));
  const body = layout.workers.body;
  model.workerSlots.slice(0, MAX_WORKER_ROWS).forEach((row, i) => {
    const y = body.y + i * Math.round(ROW_H * s) + ROW_TEXT_PAD * s;
    chrome.textAt(row.label, body.x, y, row.filled > 0 ? 'white' : 'dimmed');
    chrome.textRight(`${row.filled}/${row.capacity}`, body.x + body.w, y, 'dimmed');
  });
}

/**
 * The stock window's eight category tabs, justified across the body width (whether the original spreads
 * or packs them flush is unread — a guess alongside the per-tab categories; montage provenance, pending
 * the plan's step-3 human pass). Each tab bob carries its own plate plus a category glyph; drawn through the
 * `bg_invert` palette, which renders the glyph as BRIGHT cream line-art on a recessed plate — legible where
 * the earlier `context` pairing rendered it dark-on-dark (invisible). The palette pick is a named legibility
 * choice, not verified to be the original's tab palette — pending the step-3 human pass.
 *
 * The tabs are now interactive: clicking one filters the stock list to its category (see `stock-tabs.ts`
 * and `panel.ts`). The active tab carries a lime underline (the same selected-strip look as the name row)
 * so the current category reads at a glance.
 */
function drawStockTabs(chrome: Chrome, rects: readonly Rect[], activeTab: number, s: number): void {
  rects.forEach((r, i) => {
    chrome.guiCentered(GUI_FRAME.stock_tab_0 + i, r, 'magenta', 'bg_invert');
    // Recede every tab but the active one so the current category reads at a glance even at uiscale 1,
    // where a thin underline alone would be a single pixel.
    if (i !== activeTab) chrome.scrim(r, STOCK_TAB_DIM_ALPHA);
  });
  const active = rects[activeTab];
  if (active !== undefined) {
    const underlineH = Math.max(2, Math.round(STOCK_TAB_UNDERLINE_H * s));
    chrome.selectedUnderline({
      x: active.x,
      y: active.y + active.h - underlineH,
      w: active.w,
      h: underlineH,
    });
  }
}

export function drawSettler(
  chrome: Chrome,
  layout: SimpleLayout,
  model: SettlerPanelModel,
  ui: UiString,
  s: number,
): void {
  chrome.window(layout.section.frame);
  chrome.headline(
    layout.section.title,
    `${ui('humanwindow', HUMANWINDOW_TITLE, 'Poddany')} — ${model.title}`,
  );
  const body = layout.section.body;
  const rowH = Math.round(ROW_H * s);
  let y = body.y;
  const kv = (key: string, value: string): void => {
    chrome.textAt(key, body.x, y + ROW_TEXT_PAD * s, 'dimmed');
    chrome.textAt(value, body.x + Math.round(KV_KEY_W * s), y + ROW_TEXT_PAD * s, 'white');
    y += rowH;
  };
  kv('Gracz', model.owner);
  kv('Plemię', model.tribe);
  for (const n of model.needs) {
    chrome.textAt(n.label, body.x, y + ROW_TEXT_PAD * s, 'dimmed');
    chrome.bar(
      {
        x: body.x + Math.round(NEED_LABEL_W * s),
        y: y + Math.round((ROW_H - BAR_H) * s) / 2,
        w: body.w - Math.round((NEED_LABEL_W + NEED_PCT_W) * s),
        h: Math.round(BAR_H * s),
      },
      n.pct,
    );
    chrome.textRight(`${n.pct}%`, body.x + body.w, y + ROW_TEXT_PAD * s, 'dimmed');
    y += rowH;
  }
  kv('Niesie', model.carry);
  kv('Postawa', model.stance);
  kv('Status', model.status);
}

export function drawCompact(
  chrome: Chrome,
  layout: SimpleLayout,
  model: MultiSettlerPanelModel | GenericSelectionPanelModel,
  ui: UiString,
  s: number,
): void {
  chrome.window(layout.section.frame);
  const title =
    model.kind === 'multi-settler'
      ? ui('humanlistwindow', HUMANLIST_COUNT, 'Liczba poddanych na liście: %d').replace(
          '%d',
          String(model.count),
        )
      : `${model.count} zaznaczonych`;
  chrome.headline(layout.section.title, title);
  chrome.textAt(
    'PPM — rozkaz ruchu, Spacja — akcje',
    layout.section.body.x,
    layout.section.body.y + ROW_TEXT_PAD * s,
    'dimmed',
  );
}
