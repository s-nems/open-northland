import { GUI_FRAME, guiFrameIndex } from '../../content/gui-atlas-map.js';
import type { UiString } from '../../content/gui-gfx.js';
import type { Rect } from '../geometry.js';
import type { Chrome } from './chrome.js';
import {
  BAR_H,
  BAR_NATIVE_W,
  type BuildingLayout,
  type ButtonAction,
  type CompactLayout,
  EQUIP_ROW_H,
  MAX_STOCK_ROWS,
  PREVIEW_INSET,
  ROW_H,
  STOCK_PLATE_H,
  STOCK_ROW_H,
  type SettlerLayout,
  stockSlotRects,
} from './layout.js';
import {
  type BuildingPanelModel,
  type GenericSelectionPanelModel,
  HUMANWINDOW,
  type MultiSettlerPanelModel,
  type SettlerPanelModel,
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
/** Left inset of the amount text inside its plate (eyeballed off the 1024×768 screenshots). */
const STOCK_AMOUNT_INSET = 6;
/** The active stock tab's lime underline height in design px (kept ≥2 screen px so it reads at uiscale 1). */
const STOCK_TAB_UNDERLINE_H = 2;
/** Key column width of a key/value row. */
const KV_KEY_W = 82;
/** Fixed gauge width for an Ogólne stat bar (the original shows no numbers on these bars). */
const SETTLER_BAR_W = 64;
/** How far an equip good's icon EXTENDS beyond its socket ring on every side (design px). The original's
 *  chunky equip icons spill a touch over the ring — a bigger icon reads far better than a tiny one
 *  rattling inside the circle. */
const SLOT_ICON_OVERFLOW = 3;

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
    // The fixed cell grid both the drawing and the hover hit-test share (column-major, two columns).
    const slots = stockSlotRects(body, s);
    const cellH = Math.round(STOCK_ROW_H * s);
    // Only the active category tab's goods are listed (the original filters the store by tab).
    const rows = model.stock.filter((row) => row.category === activeTab);
    const shown = rows.slice(0, MAX_STOCK_ROWS * 2);
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
        stockAmount(row.amount),
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

  chrome.window(layout.workers.frame);
  chrome.headline(layout.workers.title, ui('housewindow', HOUSEWINDOW.workers, 'Pracownicy'));
  const body = layout.workers.body;
  // The per-trade limits are ONE compact strip right under the header ("Kowal 1/3 · Tragarz 1/1 ·
  // Zbieracz 0/1"), leaving the field BELOW free for the animated worker sprites (drawn on-map style,
  // without terrain, by the panel's own sprite pass — see panel.ts). The limits use `s`-scaled row pad.
  const limits = model.workerSlots.map((r) => `${r.label} ${r.filled}/${r.capacity}`).join('  ·  ');
  if (limits.length > 0) chrome.textAt(limits, body.x, body.y + ROW_TEXT_PAD * s, 'dimmed');
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

/**
 * The settler view: the original's stacked human-window sections — Ogólne, Praca, Doświadczenie,
 * Ekwipunek — each a parchment window with a decoded `humanwindow` headline (see {@link HUMANWINDOW}).
 */
export function drawSettler(
  chrome: Chrome,
  layout: SettlerLayout,
  model: SettlerPanelModel,
  ui: UiString,
  s: number,
): void {
  drawGeneralSection(chrome, layout, model, ui, s);
  drawWorkSection(chrome, layout, model, ui, s);
  drawExperienceSection(chrome, layout, model, ui, s);
  drawEquipmentSection(chrome, layout, model, ui, s);
}

/**
 * Ogólne: the portrait box (a person glyph placeholder + a live status caption — an honest stand-in for
 * the original's animated "co robi" preview, the live settler bob being a deferred follow-up) and the
 * name / meta / stat-bar column beside it.
 */
function drawGeneralSection(
  chrome: Chrome,
  layout: SettlerLayout,
  model: SettlerPanelModel,
  ui: UiString,
  s: number,
): void {
  chrome.window(layout.general.frame);
  chrome.headline(layout.general.title, ui('humanwindow', HUMANWINDOW.general, 'Ogólne'));

  chrome.innerBox(layout.preview);
  chrome.guiCentered(GUI_FRAME.house_plate, layout.preview, 'magenta', 'bg_normal');
  chrome.guiCentered(GUI_FRAME.tool_button_population, layout.preview, 'full');
  const captionH = Math.round(ROW_H * s);
  const caption: Rect = {
    x: layout.preview.x,
    y: layout.preview.y + layout.preview.h - captionH,
    w: layout.preview.w,
    h: captionH,
  };
  chrome.scrim(caption, 0.55);
  chrome.textCentered(model.statusCaption, caption, 'white');

  chrome.textAt(model.profession, layout.name.x, layout.name.y + ROW_TEXT_PAD * s, 'white', 'title');
  chrome.textAt(model.meta, layout.meta.x, layout.meta.y + ROW_TEXT_PAD * s, 'dimmed');

  // Stat bars: a short decoded label (Zdrowie/Energia/…) and a fixed-width gauge right-aligned in the row.
  const barW = Math.round(SETTLER_BAR_W * s);
  const barH = Math.round(BAR_H * s);
  model.bars.forEach((barModel, i) => {
    const r = layout.bars[i];
    if (r === undefined) return;
    chrome.textAt(
      ui('humanwindow', barModel.titleId, barModel.fallback),
      r.x,
      r.y + ROW_TEXT_PAD * s,
      'white',
    );
    chrome.bar(
      { x: r.x + r.w - barW, y: r.y + Math.round((r.h - barH) / 2), w: barW, h: barH },
      barModel.pct,
    );
  });
}

/** Praca: the workplace and the good it makes (or what the settler carries). Key labels are pinned
 *  Polish — the original shows an icon inline, not a key column, so there is no decoded key string. */
function drawWorkSection(
  chrome: Chrome,
  layout: SettlerLayout,
  model: SettlerPanelModel,
  ui: UiString,
  s: number,
): void {
  chrome.window(layout.work.frame);
  chrome.headline(layout.work.title, ui('humanwindow', HUMANWINDOW.work, 'Praca'));
  const keyW = Math.round(KV_KEY_W * s);
  const [place, product] = layout.workRows;
  if (place !== undefined) {
    chrome.textAt('Miejsce', place.x, place.y + ROW_TEXT_PAD * s, 'white');
    chrome.textAt(model.work.place, place.x + keyW, place.y + ROW_TEXT_PAD * s, 'white');
  }
  if (product !== undefined) {
    chrome.textAt('Produkt', product.x, product.y + ROW_TEXT_PAD * s, 'white');
    chrome.textAt(model.work.product, product.x + keyW, product.y + ROW_TEXT_PAD * s, 'white');
  }
}

/** Doświadczenie: the settler's highest recorded specialization (or "żadne" — the sim awards none yet). */
function drawExperienceSection(
  chrome: Chrome,
  layout: SettlerLayout,
  model: SettlerPanelModel,
  ui: UiString,
  s: number,
): void {
  chrome.window(layout.experience.frame);
  chrome.headline(layout.experience.title, ui('humanwindow', HUMANWINDOW.experience, 'Doświadczenie'));
  const r = layout.expRow;
  chrome.textAt(
    ui('humanwindow', HUMANWINDOW.highestExp, 'Najwyższe Doświadczenie'),
    r.x,
    r.y + ROW_TEXT_PAD * s,
    'white',
  );
  const value =
    model.experience === null
      ? ui('humanwindow', HUMANWINDOW.none, 'żadne')
      : `${model.experience.label} (${model.experience.points})`;
  chrome.textRight(value, r.x + r.w, r.y + ROW_TEXT_PAD * s, 'white');
}

/**
 * Ekwipunek: one labeled row per slot group (Buty / Narzędzia / Broń / Zbroja / Ekwipunek). Each row's
 * label sits left of its round sockets; an occupied socket shows the good's icon (when it has an
 * `ls_goods` pile — potions/amulets have none, so they read by the warm-tinted socket) and, for a
 * WEARING good, its "degree of use" percent in the column right of the socket.
 */
function drawEquipmentSection(
  chrome: Chrome,
  layout: SettlerLayout,
  model: SettlerPanelModel,
  ui: UiString,
  s: number,
): void {
  chrome.window(layout.equipment.frame);
  chrome.headline(layout.equipment.title, ui('humanwindow', HUMANWINDOW.equip, 'Ekwipunek'));
  const iconOverflow = Math.round(SLOT_ICON_OVERFLOW * s);
  // Vertically centre a body line against the taller equipment row (and the sockets in it).
  const labelPadY = Math.round(((EQUIP_ROW_H - ROW_H) / 2 + ROW_TEXT_PAD) * s);
  layout.equipRows.forEach((rowRect, i) => {
    const row = model.equipmentRows[i];
    if (row === undefined) return;
    chrome.textAt(
      ui('humanwindow', row.titleId, row.fallback),
      rowRect.label.x,
      rowRect.label.y + labelPadY,
      'white',
    );
    rowRect.slots.forEach((slotRect, j) => {
      const slot = row.slots[j];
      chrome.slotSocket(slotRect, slot?.goodId !== undefined);
      if (slot?.goodId !== undefined) {
        chrome.goodIcon(slot.goodId, {
          x: slotRect.x - iconOverflow,
          y: slotRect.y - iconOverflow,
          w: slotRect.w + iconOverflow * 2,
          h: slotRect.h + iconOverflow * 2,
        });
      }
      if (slot?.usePct != null) {
        chrome.textAt(
          `${slot.usePct}%`,
          // Past the icon's right overflow, so a bigger icon can't crowd the "70%" badge.
          slotRect.x + slotRect.w + iconOverflow + Math.round(2 * s),
          slotRect.y + Math.round((slotRect.h - ROW_H * s) / 2) + ROW_TEXT_PAD * s,
          'white',
        );
      }
    });
  });
}

export function drawCompact(
  chrome: Chrome,
  layout: CompactLayout,
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
