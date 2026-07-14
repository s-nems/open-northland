import { GUI_FRAME, guiFrameIndex } from '../../../content/gui-atlas-map.js';
import type { UiString } from '../../../content/gui-gfx.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { Rect } from '../../geometry.js';
import type { Chrome } from '../chrome.js';
import {
  BAR_H,
  type BuildingLayout,
  type ButtonAction,
  PREVIEW_INSET,
  STOCK_PLATE_H,
  STOCK_ROW_H,
  stockSlotRects,
} from '../layout/index.js';
import type { BuildingPanelModel } from '../model/index.js';
import { ROW_TEXT_PAD } from './shared.js';

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

const BUTTON_STRING: Readonly<Record<ButtonAction, number>> = {
  demolish: HOUSEWINDOW.demolish,
  center: HOUSEWINDOW.center,
  workers: HOUSEWINDOW.workersButton,
  help: HOUSEWINDOW.help,
};

function buttonFallback(action: ButtonAction): string {
  const hud = messages().hud;
  if (action === 'demolish') return hud.demolish;
  if (action === 'center') return hud.center;
  if (action === 'workers') return hud.workers;
  return hud.help;
}

/** Stock cell: icon slot width before the amount plate (≈15 px icon + a small gap in the original). */
const STOCK_ICON_W = 18;
/** Left inset of the amount text inside its plate (eyeballed off the 1024×768 screenshots). */
const STOCK_AMOUNT_INSET = 6;
/** Where the production row's long progress bar starts (design px) — a fixed label column that fits the
 *  output icon + a localized name like "Pszenica x1"; the bar fills the rest of the row's width. */
const PRODUCTION_BAR_LEFT = 128;
/** Where the construction gauge starts (design px) — a narrow label column that fits the "100%" text. */
const CONSTRUCTION_BAR_LEFT = 40;
/** The active stock tab's lime underline height in design px (kept ≥2 screen px so it reads at uiscale 1). */
const STOCK_TAB_UNDERLINE_H = 2;

/**
 * Stock amounts render with one decimal, LEFT-aligned inside the plate ("15.0") — both observed off
 * the original's 1024×768 screenshots. A row with a declared slot also shows its ceiling
 * ("7.0 / 25.0" — user-requested; the capacity is the building's extracted `logicstock` slot), so a
 * filling store reads at a glance; a dynamic drop (no declared slot) keeps the bare amount.
 */
function stockAmount(amount: number, capacity?: number): string {
  return capacity === undefined ? amount.toFixed(1) : `${amount.toFixed(1)} / ${capacity.toFixed(1)}`;
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
  chrome.headline(layout.general.title, ui('housewindow', HOUSEWINDOW.general, messages().hud.general));

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
    chrome.button(
      hit,
      ui('housewindow', BUTTON_STRING[hit.action], buttonFallback(hit.action)),
      hover === hit.action,
    );
  }

  if (layout.construction !== null && model.construction !== null) {
    // The Construction window of a site: the health gauge that ramps with the build (the sim raises
    // hitpoints in step with `built`) beside the numeric %, then one stock-style row per material line
    // reading "delivered / needed". No extracted title exists for a site window — 'Construction' is a
    // named approximation (English pending the i18n pass), like 'Produkcja'.
    chrome.window(layout.construction.frame);
    chrome.headline(layout.construction.title, 'Construction');
    const body = layout.construction.body;
    const rowH = Math.round(STOCK_ROW_H * s);
    chrome.textAt(`${model.builtPct}%`, body.x, body.y + ROW_TEXT_PAD * s, 'white');
    const barX = body.x + Math.round(CONSTRUCTION_BAR_LEFT * s);
    chrome.bar(
      {
        x: barX,
        y: body.y + Math.round((STOCK_ROW_H - BAR_H) * s) / 2,
        w: body.x + body.w - barX,
        h: Math.round(BAR_H * s),
      },
      model.construction.hpPct ?? model.builtPct,
      'gauge',
    );
    model.construction.rows.forEach((row, i) => {
      const rowY = body.y + (i + 1) * rowH;
      const icon: Rect = {
        x: body.x,
        y: rowY + Math.round(s),
        w: Math.round(STOCK_ICON_W * s),
        h: rowH - Math.round(2 * s),
      };
      const plate: Rect = {
        x: body.x + icon.w,
        y: rowY + Math.round((STOCK_ROW_H - STOCK_PLATE_H) * s) / 2,
        w: Math.round(body.w / 2),
        h: Math.round(STOCK_PLATE_H * s),
      };
      chrome.stockField(plate);
      if (row.goodId !== undefined) chrome.goodIcon(row.goodId, icon);
      chrome.textLeftMiddle(
        stockAmount(row.delivered, row.needed),
        plate.x + Math.round(STOCK_AMOUNT_INSET * s),
        plate.y + plate.h / 2,
        'white',
      );
    });
  }

  if (layout.defence !== null) {
    chrome.window(layout.defence.frame);
    chrome.headline(layout.defence.title, ui('housewindow', HOUSEWINDOW.defence, messages().hud.defence));
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
    chrome.headline(layout.production.title, messages().hud.production);
    const body = layout.production.body;
    if (model.production.kind === 'fields') {
      // A FARM's production is its live FIELDS: the farmed good's icon + the sown/growing/ripe
      // counters (there is no recipe/cycle to bar) — the panel's window onto the field loop.
      const p = model.production;
      const icon: Rect = {
        x: body.x,
        y: body.y + Math.round(s),
        w: Math.round(STOCK_ICON_W * s),
        h: Math.round(STOCK_ROW_H * s) - Math.round(2 * s),
      };
      if (p.goodId !== undefined) chrome.goodIcon(p.goodId, icon);
      const counters = formatMessage(messages().hud.fieldCounters, {
        sown: p.sown,
        growing: p.growing,
        ripe: p.ripe,
      });
      chrome.textAt(
        counters,
        icon.x + icon.w + Math.round(STOCK_AMOUNT_INSET * s),
        body.y + ROW_TEXT_PAD * s,
        'white',
      );
    } else {
      // A workshop's batches: the output's icon + localized name on the first row, then ONE long
      // progress bar PER RESERVED ROW (`p.rows` — one row per operator slot, so a twin-staffed mill
      // always shows two bars and the section never changes height mid-work), each filling the row
      // from the fixed label column to the body's edge; rows without an in-flight batch draw empty.
      const p = model.production;
      const rowH = Math.round(STOCK_ROW_H * s);
      const icon: Rect = {
        x: body.x,
        y: body.y + Math.round(s),
        w: Math.round(STOCK_ICON_W * s),
        h: rowH - Math.round(2 * s),
      };
      if (p.goodId !== undefined) chrome.goodIcon(p.goodId, icon);
      chrome.textAt(
        p.label,
        icon.x + icon.w + Math.round(STOCK_AMOUNT_INSET * s),
        body.y + ROW_TEXT_PAD * s,
        'white',
      );
      const barX = body.x + Math.round(PRODUCTION_BAR_LEFT * s);
      const bars = Array.from({ length: p.rows }, (_, i) => p.pcts[i] ?? 0);
      bars.forEach((pct, i) => {
        chrome.bar(
          {
            x: barX,
            y: body.y + i * rowH + Math.round((STOCK_ROW_H - BAR_H) * s) / 2,
            w: body.x + body.w - barX,
            h: Math.round(BAR_H * s),
          },
          pct,
        );
      });
    }
  }

  if (layout.stock !== null) {
    chrome.window(layout.stock.frame);
    chrome.headline(layout.stock.title, ui('housewindow', HOUSEWINDOW.stock, messages().hud.stock));
    // A COMPACT store (every good fits at once) has no category tabs and lists ALL its rows; only the
    // full fixed-height store filters by the active tab (the dynamic-magazyn rule — see layout.ts).
    if (!layout.stockCompact) drawStockTabs(chrome, layout.stockTabHits, activeTab, s);
    const body = layout.stock.body;
    // The fixed cell grid both the drawing and the hover hit-test share (column-major, two columns).
    const slots = stockSlotRects(body, s, layout.stockRows);
    const cellH = Math.round(STOCK_ROW_H * s);
    // A COMPACT store keeps the model's declared slot order, stable while amounts change (the mill's
    // Pszenica/Mąka must not swap mid-work); only the big tabbed store bubbles held goods to the top —
    // there the fixed row cap hides overflow, so actual stock earns its place above the fold. The sort
    // is stable, so ties keep the declared order.
    const inTab = layout.stockCompact ? model.stock : model.stock.filter((row) => row.category === activeTab);
    const rows = layout.stockCompact
      ? inTab
      : [...inTab].sort((a, b) => (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0));
    const shown = rows.slice(0, layout.stockRows * 2);
    shown.forEach((row, i) => {
      const slot = slots[i];
      if (slot === undefined) return;
      // Icon, plate and amount all share the row's vertical centre so a row reads on one level: the icon box
      // is inset symmetrically (top+bottom) instead of top-anchored, and the amount centres in the plate.
      const icon: Rect = {
        x: slot.x,
        y: slot.y + Math.round(s),
        w: Math.round(STOCK_ICON_W * s),
        h: cellH - Math.round(2 * s),
      };
      const plate: Rect = {
        x: slot.x + icon.w,
        y: slot.y + Math.round((STOCK_ROW_H - STOCK_PLATE_H) * s) / 2,
        w: slot.w - icon.w,
        h: Math.round(STOCK_PLATE_H * s),
      };
      chrome.stockField(plate);
      // The good's recoloured pile icon sits on the wood, LEFT of the amount plate (drawn after the plate
      // so a slightly oversized pile overlaps its edge rather than being clipped) — the original's row look.
      if (row.goodId !== undefined) chrome.goodIcon(row.goodId, icon);
      // The amount sits left-inset next to the icon, vertically centred on the plate's centre line (not
      // top-anchored, which rode high) — leaving the number left-aligned as in the original row.
      chrome.textLeftMiddle(
        stockAmount(row.amount, row.capacity),
        plate.x + Math.round(STOCK_AMOUNT_INSET * s),
        plate.y + plate.h / 2,
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

  // A rising site's panel drops the workers window (the crew shows in the Construction window instead),
  // so `layout.workers` is null then — guard it. Otherwise the finished building's workers strip.
  if (layout.workers !== null) {
    chrome.window(layout.workers.frame);
    chrome.headline(layout.workers.title, ui('housewindow', HOUSEWINDOW.workers, messages().hud.workers));
    const body = layout.workers.body;
    // The per-trade limits are ONE compact strip right under the header ("Kowal 1/3 · Tragarz 1/1 ·
    // Zbieracz 0/1"), leaving the field BELOW free for the animated worker sprites (drawn on-map style,
    // without terrain, by the panel's own sprite pass — see panel.ts). The limits use `s`-scaled row pad.
    const limits = model.workerSlots.map((r) => `${r.label} ${r.filled}/${r.capacity}`).join('  ·  ');
    if (limits.length > 0) chrome.textAt(limits, body.x, body.y + ROW_TEXT_PAD * s, 'dimmed');
  }
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
/**
 * The original tab-plate glyph (frame 170–177) drawn on each category tab, index = tab — REORDERED from the
 * sheet's raw order so each category gets the fitting glyph (identified by eye: cutlery→food, house→building,
 * hammer→tools, boots→crafted, weapon→military…). The glyph semantics aren't decoded, so this pairing is a
 * named approximation; the hover tooltip carries the authoritative category name either way.
 */
const STOCK_TAB_GLYPH: readonly number[] = [
  GUI_FRAME.stock_tab_0 + 2, // 0 Żywność — cutlery
  guiFrameIndex('resource_icon_water_drop'), // 1 Napoje — water drop (the tab set has no drink glyph)
  GUI_FRAME.stock_tab_0 + 4, // 2 Surowce — (unread)
  GUI_FRAME.stock_tab_0 + 1, // 3 Budulec — house
  GUI_FRAME.stock_tab_0 + 0, // 4 Narzędzia — hammer
  GUI_FRAME.stock_tab_0 + 5, // 5 Wyroby — boots
  GUI_FRAME.stock_tab_0 + 6, // 6 Wojsko — weapon
  GUI_FRAME.stock_tab_0 + 7, // 7 Inne — (spare)
];

function drawStockTabs(chrome: Chrome, rects: readonly Rect[], activeTab: number, s: number): void {
  rects.forEach((r, i) => {
    // The original cream line-art glyph, reordered onto the fitting category tab, over a wooden plate (active
    // brighter, inactive dimmed) instead of the flat grey recessed rectangle.
    chrome.tabButton(r, i === activeTab);
    const glyph = STOCK_TAB_GLYPH[i];
    if (glyph !== undefined) chrome.guiCentered(glyph, r, 'magenta', 'bg_invert');
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
