import { GUI_FRAME } from '../../../content/gui-atlas-map.js';
import type { UiString } from '../../../content/gui-gfx.js';
import { messages } from '../../../i18n/index.js';
import type { Rect } from '../../geometry.js';
import type { Chrome } from '../chrome.js';
import {
  type ButtonAction,
  EQUIP_ROW_H,
  equipActionKey,
  ROW_H,
  ROW_TEXT_PAD,
  type SettlerLayout,
  type WorkControlAction,
} from '../layout/index.js';
import { HUMANWINDOW, type SettlerPanelModel } from '../model/index.js';

/** Key column width of a key/value row. */
const KV_KEY_W = 82;
/** The Ogólne stat rows' label column, sized to the widest label ("Towarzystwo"); the gauge fills the
 *  rest of the row. */
const STAT_LABEL_W = 78;
/** An Ogólne stat gauge's height, a touch taller than the building's 10 px progress bar so the gradient
 *  has room to read, still inside the 13 px bar row. */
const STAT_BAR_H = 11;
/** How far an equip good's icon extends beyond its socket ring on every side (design px); the original's
 *  chunky equip icons spill a touch over the ring. */
const SLOT_ICON_OVERFLOW = 3;
/** Inset (design px) of a gather-choice good icon inside its round button, so the pile clears the rim. */
const GATHER_ICON_PAD = 3;
/** A wearing equip slot's condition gauge under its socket (design px tall, socket wide); the exact
 *  percent stays in the socket tooltip. */
const WEAR_BAR_H = 3;

/** The original's stacked human-window sections, each with a decoded `humanwindow` headline. */
export function drawSettler(
  chrome: Chrome,
  layout: SettlerLayout,
  model: SettlerPanelModel,
  ui: UiString,
  hoverAction: ButtonAction | null,
  hoveredGatherGood: number | null | undefined,
  hoveredEquipAction: string | null,
  s: number,
): void {
  drawGeneralSection(chrome, layout, model, s);
  drawWorkSection(chrome, layout, model, ui, hoverAction, hoveredGatherGood, s);
  drawExperienceSection(chrome, layout, model, ui, s);
  drawEquipmentSection(chrome, layout, model, ui, hoveredEquipAction, s);
}

/**
 * Ogólne: the portrait box, whose person glyph and live status caption stand in for the original's
 * animated "co robi" preview, and the name / meta / stat-bar column beside it.
 */
function drawGeneralSection(
  chrome: Chrome,
  layout: SettlerLayout,
  model: SettlerPanelModel,
  s: number,
): void {
  chrome.window(layout.general.frame);
  // The section title is the character's personal name, not the original's generic "Ogólne" heading.
  chrome.headline(layout.general.title, model.name);

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

  const labelW = Math.round(STAT_LABEL_W * s);
  const barH = Math.round(STAT_BAR_H * s);
  model.bars.forEach((barModel, i) => {
    const r = layout.bars[i];
    if (r === undefined) return;
    chrome.textAt(barModel.label, r.x, r.y + ROW_TEXT_PAD * s, 'white');
    chrome.bar(
      { x: r.x + labelW, y: r.y + Math.round((r.h - barH) / 2), w: r.w - labelW, h: barH },
      barModel.pct,
      'gauge',
    );
  });
}

/** Praca: the workplace and the good it makes. Key labels are pinned Polish, since the original shows
 *  an icon inline rather than a key column and so has no decoded key string. */
function drawWorkSection(
  chrome: Chrome,
  layout: SettlerLayout,
  model: SettlerPanelModel,
  ui: UiString,
  hoverAction: ButtonAction | null,
  hoveredGatherGood: number | null | undefined,
  s: number,
): void {
  chrome.window(layout.work.frame);
  const hud = messages().hud;
  chrome.headline(layout.work.title, ui('humanwindow', HUMANWINDOW.work, hud.work));
  const keyW = Math.round(KV_KEY_W * s);
  const [place, product] = layout.workRows;
  if (place !== undefined) {
    chrome.textAt(hud.place, place.x, place.y + ROW_TEXT_PAD * s, 'white');
    chrome.textAt(model.work.place, place.x + keyW, place.y + ROW_TEXT_PAD * s, 'white');
  }
  if (product !== undefined) {
    const key =
      model.work.gatherChoices.length > 0
        ? hud.gatherTarget
        : model.work.craftChoices.length > 0
          ? hud.craftTarget
          : hud.product;
    chrome.textAt(key, product.x, product.y + ROW_TEXT_PAD * s, 'white');
    // Shrink-to-fit so a two-product list can never spill past the panel's right edge.
    chrome.textLeftMiddle(
      model.work.product,
      product.x + keyW,
      product.y + product.h / 2,
      'white',
      'body',
      product.w - keyW,
    );
  }
  // A gatherer's single-select goods or a craft worker's multi-select products, never both; the choice
  // names live in the cursor tooltip rather than beside the buttons.
  const iconPad = Math.round(GATHER_ICON_PAD * s);
  const drawChoice = (rect: Rect, goodId: string | undefined, active: boolean): void => {
    chrome.roundButton(rect, true, active);
    const face: Rect = {
      x: rect.x + iconPad,
      y: rect.y + iconPad,
      w: rect.w - 2 * iconPad,
      h: rect.h - 2 * iconPad,
    };
    if (goodId !== undefined) chrome.goodIcon(goodId, face);
    else chrome.glyphAll(face);
  };
  for (const choice of layout.gatherChoiceHits) {
    drawChoice(choice.rect, choice.goodId, choice.selected || choice.goodType === hoveredGatherGood);
  }
  for (const choice of layout.craftChoiceHits) {
    drawChoice(choice.rect, choice.goodId, choice.selected || choice.goodType === hoveredGatherGood);
  }
  for (const { action, button, label } of layout.workControls) {
    const { enabled, rect } = button;
    chrome.textLeftMiddle(
      workControlLabel(action, ui),
      label.x,
      label.y + label.h / 2,
      enabled ? 'white' : 'dimmed',
    );
    chrome.roundButton(rect, enabled, hoverAction === action);
    chrome.glyphHouse(rect, enabled);
  }
}

/** The Praca control rows' decoded `humanwindow` labels. */
function workControlLabel(action: WorkControlAction, ui: UiString): string {
  const hud = messages().hud;
  switch (action) {
    case 'assign-workplace':
      return ui('humanwindow', HUMANWINDOW.assignWork, hud.assignWorkplace);
    case 'unassign-workplace':
      return ui('humanwindow', HUMANWINDOW.removeWork, hud.unassignWorkplace);
    case 'assign-home':
      return ui('humanwindow', HUMANWINDOW.assignHome, hud.assignHome);
    case 'unassign-home':
      return ui('humanwindow', HUMANWINDOW.removeHome, hud.unassignHome);
  }
}

/** Doświadczenie: one left-aligned "label count (+bonus%)" line per trained specialization; an
 *  untrained settler's body stays empty, with no placeholder row. */
function drawExperienceSection(
  chrome: Chrome,
  layout: SettlerLayout,
  model: SettlerPanelModel,
  ui: UiString,
  s: number,
): void {
  chrome.window(layout.experience.frame);
  chrome.headline(
    layout.experience.title,
    ui('humanwindow', HUMANWINDOW.experience, messages().hud.experience),
  );
  layout.expRows.forEach((r, i) => {
    const row = model.experience[i];
    if (row !== undefined) {
      const pct = row.bonusPct === null ? '' : ` (+${row.bonusPct}%)`;
      chrome.textAt(`${row.label} ${row.repeats}${pct}`, r.x, r.y + ROW_TEXT_PAD * s, 'white');
      return;
    }
    // Past the trained rows come the dimmed upcoming-unlock progress lines.
    const unlock = model.upcomingUnlocks[i - model.experience.length];
    if (unlock === undefined) return;
    chrome.textAt(unlock.label, r.x, r.y + ROW_TEXT_PAD * s, 'dimmed');
  });
}

/**
 * Ekwipunek: one labeled row per slot group, its label left of the round sockets, an occupied socket
 * showing the good's icon. A wearing good's condition draws as a thin gauge under its socket, a
 * deviation from the manual's "A percentage indicating the degree of use is displayed" (the original manual
 * p. 27), traded for four misc cells that fit one line at every ui scale. The per-slot plus/arrows/cross
 * glyphs are an approximation of the original's hand buttons described on the same page, and take-off
 * walks the item to a store instead of dropping it where the settler stands.
 */
function drawEquipmentSection(
  chrome: Chrome,
  layout: SettlerLayout,
  model: SettlerPanelModel,
  ui: UiString,
  hoveredEquipAction: string | null,
  s: number,
): void {
  chrome.window(layout.equipment.frame);
  chrome.headline(layout.equipment.title, ui('humanwindow', HUMANWINDOW.equip, messages().hud.equipment));
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
      if (slot?.conditionPct != null) {
        chrome.bar(
          { x: slotRect.x, y: slotRect.y + slotRect.h, w: slotRect.w, h: Math.round(WEAR_BAR_H * s) },
          slot.conditionPct,
          'gauge',
        );
      }
    });
  });
  for (const hit of layout.equipActionHits) {
    chrome.roundButton(hit.rect, true, equipActionKey(hit) === hoveredEquipAction);
    if (hit.kind === 'equip') chrome.glyphPlus(hit.rect);
    else if (hit.kind === 'swap') chrome.glyphSwap(hit.rect);
    else chrome.glyphCross(hit.rect);
  }
}
