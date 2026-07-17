import { GUI_FRAME } from '../../../content/gui-atlas-map.js';
import type { UiString } from '../../../content/gui-gfx.js';
import { messages } from '../../../i18n/index.js';
import type { Rect } from '../../geometry.js';
import type { Chrome } from '../chrome.js';
import { type ButtonAction, EQUIP_ROW_H, ROW_H, ROW_TEXT_PAD, type SettlerLayout } from '../layout/index.js';
import { HUMANWINDOW, type SettlerPanelModel } from '../model/index.js';

/** Key column width of a key/value row. */
const KV_KEY_W = 82;
/** The Ogólne stat rows' label column (fits the widest label, "Towarzystwo") — the gauge fills the
 *  rest of the row, so the bars run edge-to-edge with the column instead of floating as short stubs
 *  (user feedback 2026-07-11: wider bars). */
const STAT_LABEL_W = 78;
/** An Ogólne stat gauge's height — a touch taller than the building's 10-px progress bar so the
 *  gradient has room to read, still inside the 13-px bar row. */
const STAT_BAR_H = 11;
/** How far an equip good's icon extends beyond its socket ring on every side (design px). The original's
 *  chunky equip icons spill a touch over the ring — a bigger icon reads far better than a tiny one
 *  rattling inside the circle. */
const SLOT_ICON_OVERFLOW = 3;
/** Inset (design px) of a gather-choice good icon inside its round button, so the pile clears the rim. */
const GATHER_ICON_PAD = 3;

/**
 * The settler view: the original's stacked human-window sections — Ogólne, Praca, Doświadczenie,
 * Ekwipunek — each a parchment window with a decoded `humanwindow` headline (see {@link HUMANWINDOW}).
 */
export function drawSettler(
  chrome: Chrome,
  layout: SettlerLayout,
  model: SettlerPanelModel,
  ui: UiString,
  hoverAction: ButtonAction | null,
  hoveredGatherGood: number | null | undefined,
  s: number,
): void {
  drawGeneralSection(chrome, layout, model, s);
  drawWorkSection(chrome, layout, model, ui, hoverAction, hoveredGatherGood, s);
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
  s: number,
): void {
  chrome.window(layout.general.frame);
  // The section title is the character's personal name (see `model.name`), personalising the panel in
  // place of the original's generic "Ogólne" heading.
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

  // Stat bars: the model's pinned label (Zdrowie/Głód/…) in a fixed column, then a level-coloured
  // gauge (the decoded ramp sweeps red→orange→green with the level) filling the rest of the row; the
  // hover value lives in the panel's cursor tooltip.
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

/** Praca: the workplace and the good it makes (or what the settler carries). Key labels are pinned
 *  Polish — the original shows an icon inline, not a key column, so there is no decoded key string. */
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
  // Round choice buttons hugging the left edge — a gatherer's single-select goods or a craft worker's
  // multi-select products (never both) — each showing the good's icon (the generic pile for the
  // "Wszystko" choice); their names live in the cursor tooltip. Selected/hovered ones read brighter.
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
  // The "przydziel miejsce pracy" control: a small round button on the left, its decoded-original
  // description to the right (greyed for a jobless settler — nothing to place). The hint stays in the
  // cursor tooltip.
  chrome.textLeftMiddle(
    ui('humanwindow', HUMANWINDOW.assignWork, hud.assignWorkplace),
    layout.assignLabel.x,
    layout.assignLabel.y + layout.assignLabel.h / 2,
    model.canAssignWorkplace ? 'white' : 'dimmed',
  );
  chrome.roundButton(layout.assignIcon, model.canAssignWorkplace, hoverAction === 'assign-workplace');
  chrome.glyphHouse(layout.assignIcon, model.canAssignWorkplace);
  // The "przydziel dom" control below it — same shape, arms the click-a-house pick mode.
  chrome.textLeftMiddle(
    ui('humanwindow', HUMANWINDOW.assignHome, hud.assignHome),
    layout.homeLabel.x,
    layout.homeLabel.y + layout.homeLabel.h / 2,
    model.canAssignHome ? 'white' : 'dimmed',
  );
  chrome.roundButton(layout.homeIcon, model.canAssignHome, hoverAction === 'assign-home');
  chrome.glyphHouse(layout.homeIcon, model.canAssignHome);
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
  const hud = messages().hud;
  chrome.headline(layout.experience.title, ui('humanwindow', HUMANWINDOW.experience, hud.experience));
  const r = layout.expRow;
  chrome.textAt(
    ui('humanwindow', HUMANWINDOW.highestExp, hud.highestExperience),
    r.x,
    r.y + ROW_TEXT_PAD * s,
    'white',
  );
  const value =
    model.experience === null
      ? ui('humanwindow', HUMANWINDOW.none, hud.nothing)
      : `${model.experience.label} (${model.experience.points})`;
  chrome.textRight(value, r.x + r.w, r.y + ROW_TEXT_PAD * s, 'white');
}

/**
 * Ekwipunek: one labeled row per slot group (Buty / Narzędzia / Broń / Zbroja / Ekwipunek). Each row's
 * label sits left of its round sockets; an occupied socket shows the good's icon (when it has an
 * `ls_goods` pile — potions/amulets have none, so they read by the warm-tinted socket) and, for a
 * wearing good, its "degree of use" percent in the column right of the socket.
 */
function drawEquipmentSection(
  chrome: Chrome,
  layout: SettlerLayout,
  model: SettlerPanelModel,
  ui: UiString,
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
