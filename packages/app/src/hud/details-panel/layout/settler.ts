import { WIN_PAD } from '../../chrome.js';
import type { Rect } from '../../geometry.js';
import type { UnitPanelModel } from '../model/index.js';
import type { ButtonHit } from './building.js';
import { PANEL_W, panelRect, ROW_H, SECTION_GAP, type SectionRect, sectionAt } from './shared.js';

/** The settler selection model — the `layoutSettler` input narrowed off the panel model union. */
type SettlerModel = Extract<UnitPanelModel, { kind: 'settler' }>;

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
/** Diameter of the small round "przydziel miejsce pracy" button — left-aligned under the gather row, with
 *  its description to its right. */
const ASSIGN_ICON = 20;
/** Gap between the Praca text rows and the assign row when there are no gather buttons above it. */
const ASSIGN_BUTTON_GAP = 3;
/** Diameter of a round gather-choice button (a good's icon in a wooden well); small, left-aligned. */
const GATHER_ICON = 20;
/** Gap between adjacent round gather buttons (both axes). */
const GATHER_ICON_GAP = 4;
/** Gap between the Praca text rows and the row of round gather buttons. */
const GATHER_ROW_GAP = 3;
/** Extra separation between the gather-button block and the assign row, so the two don't read as one
 *  cluster. */
const GATHER_ASSIGN_SEP = 9;
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

/** One labeled equipment row's geometry: its label column + the slot sockets to its right. */
export interface EquipRowRect {
  readonly label: Rect;
  readonly slots: readonly Rect[];
}

export interface GatherChoiceHit {
  readonly goodType: number | null;
  readonly label: string;
  /** The good's icon key, carried through from the model; absent for the "Wszystko" choice. */
  readonly goodId?: string;
  readonly selected: boolean;
  readonly rect: Rect;
}

/** A craft operator's product toggle — the multi-select twin of {@link GatherChoiceHit} (same round
 *  button grid; a settler shows one block or the other, never both). */
export interface CraftChoiceHit {
  readonly goodType: number;
  readonly label: string;
  readonly goodId?: string;
  readonly selected: boolean;
  readonly rect: Rect;
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
  /** The "przydziel miejsce pracy" hit target — the round button disc only (its `enabled` tracks
   *  `canAssignWorkplace`), so hover/click/tooltip stay on the control, not the label. Equals {@link assignIcon}. */
  readonly assignButton: ButtonHit;
  /** The small round assign button, left-aligned under the gather row (the drawn control). */
  readonly assignIcon: Rect;
  /** The assign row's description column, right of the round button ("Przydziel miejsce pracy"). */
  readonly assignLabel: Rect;
  /** The "przypisz dom" hit target under the assign row — same shape as {@link assignButton}. */
  readonly homeButton: ButtonHit;
  /** The small round assign-home button (the drawn control). Equals {@link homeButton}'s rect. */
  readonly homeIcon: Rect;
  /** The assign-home row's description column ("Przypisz dom"). */
  readonly homeLabel: Rect;
  /** The "usuń z domu" hit target under the assign-home row — same shape as {@link homeButton}. */
  readonly unassignButton: ButtonHit;
  /** The small round remove-from-home button (the drawn control). Equals {@link unassignButton}'s rect. */
  readonly unassignIcon: Rect;
  /** The remove-from-home row's description column ("Usuń z domu"). */
  readonly unassignLabel: Rect;
  readonly gatherChoiceHits: readonly GatherChoiceHit[];
  /** The craft product toggles (exclusive with {@link gatherChoiceHits} — same grid slot). */
  readonly craftChoiceHits: readonly CraftChoiceHit[];
  readonly experience: SectionRect;
  /** The Doświadczenie body's single text row. */
  readonly expRow: Rect;
  readonly equipment: SectionRect;
  /** One entry per `model.equipmentRows` (same order): its label rect + slot-socket rects. */
  readonly equipRows: readonly EquipRowRect[];
}

export function layoutSettler(
  model: SettlerModel,
  screen: { readonly width: number; readonly height: number },
  s: number,
): SettlerLayout {
  const w = Math.round(PANEL_W * s);
  const gap = Math.round(SECTION_GAP * s);

  // Stacked sections, bottom-anchored like the building panel. Each body reserves a fixed height (the
  // original's human window doesn't fit-to-content); the equipment body scales with its row count.
  const pad = Math.round(WIN_PAD * s);
  const rowH = Math.round(ROW_H * s);
  const barRowH = Math.round(BAR_ROW_H * s);
  const equipRowH = Math.round(EQUIP_ROW_H * s);
  const generalBodyH = Math.round(SETTLER_PREVIEW * s);
  const assignIconSize = Math.round(ASSIGN_ICON * s);
  const assignRowGap = Math.round(ASSIGN_BUTTON_GAP * s);
  const gatherIcon = Math.round(GATHER_ICON * s);
  const gatherIconGap = Math.round(GATHER_ICON_GAP * s);
  const gatherRowGap = Math.round(GATHER_ROW_GAP * s);
  const gatherAssignSep = Math.round(GATHER_ASSIGN_SEP * s);
  // Round gather buttons wrap left-to-right across the section body; the body width is padding-inset from
  // the panel width the same for every section, so probe it here (before the section rects exist) to size
  // the block's height.
  const bodyW = sectionAt(0, 0, w, 0, s).body.w;
  const gatherPerRow = Math.max(1, Math.floor((bodyW + gatherIconGap) / (gatherIcon + gatherIconGap)));
  // Gather and craft choices never coexist (a flag gatherer vs a workplace-bound crafter), so the one
  // non-empty list sizes the shared round-button block.
  const choiceCount = model.work.gatherChoices.length + model.work.craftChoices.length;
  const gatherRows = choiceCount > 0 ? Math.ceil(choiceCount / gatherPerRow) : 0;
  const hasGather = gatherRows > 0;
  const gatherBlockH = hasGather ? gatherRows * gatherIcon + (gatherRows - 1) * gatherIconGap : 0;
  const gatherTopGap = hasGather ? gatherRowGap : 0;
  // Larger separation before the assign row when gather buttons sit above it; the small default otherwise.
  const preAssignGap = hasGather ? gatherAssignSep : assignRowGap;
  // Three stacked control rows close the Praca body: assign-workplace, assign-home, remove-from-home.
  const workBodyH =
    WORK_ROWS * rowH + gatherTopGap + gatherBlockH + preAssignGap + 3 * assignIconSize + 2 * assignRowGap;
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
  // Round choice buttons hugging the left edge, wrapping across the body width (gather or craft —
  // the same grid, whichever list the model filled).
  const gatherTop = work.body.y + WORK_ROWS * rowH + gatherTopGap;
  const choiceRect = (i: number): Rect => ({
    x: work.body.x + (i % gatherPerRow) * (gatherIcon + gatherIconGap),
    y: gatherTop + Math.floor(i / gatherPerRow) * (gatherIcon + gatherIconGap),
    w: gatherIcon,
    h: gatherIcon,
  });
  const gatherChoiceHits: GatherChoiceHit[] = model.work.gatherChoices.map((choice, i) => ({
    ...choice,
    selected: choice.goodType === model.work.selectedGood,
    rect: choiceRect(i),
  }));
  const craftChoiceHits: CraftChoiceHit[] = model.work.craftChoices.map((choice, i) => ({
    ...choice,
    selected: model.work.selectedCraftGoods.includes(choice.goodType),
    rect: choiceRect(i),
  }));
  // The assign row: the small round button on the left (aligned under the gather buttons), its description
  // to the right. Only the round button is the hit target — hover/click/tooltip stay on the control, so
  // pointing at the label text doesn't light the button.
  const assignTop = (hasGather ? gatherTop + gatherBlockH : work.body.y + WORK_ROWS * rowH) + preAssignGap;
  const assignIcon: Rect = {
    x: work.body.x,
    y: assignTop,
    w: assignIconSize,
    h: assignIconSize,
  };
  const assignLabel: Rect = {
    x: assignIcon.x + assignIconSize + pad,
    y: assignTop,
    w: Math.max(0, work.body.x + work.body.w - (assignIcon.x + assignIconSize + pad)),
    h: assignIconSize,
  };
  const assignButton: ButtonHit = {
    action: 'assign-workplace',
    enabled: model.canAssignWorkplace,
    rect: assignIcon,
  };
  // The assign-home row, directly below — the residential twin (same geometry, one row down).
  const homeTop = assignTop + assignIconSize + assignRowGap;
  const homeIcon: Rect = { x: work.body.x, y: homeTop, w: assignIconSize, h: assignIconSize };
  const homeLabel: Rect = { x: assignLabel.x, y: homeTop, w: assignLabel.w, h: assignIconSize };
  const homeButton: ButtonHit = { action: 'assign-home', enabled: model.canAssignHome, rect: homeIcon };
  // The remove-from-home row below it — the inverse control, one more row down.
  const unassignTop = homeTop + assignIconSize + assignRowGap;
  const unassignIcon: Rect = { x: work.body.x, y: unassignTop, w: assignIconSize, h: assignIconSize };
  const unassignLabel: Rect = { x: assignLabel.x, y: unassignTop, w: assignLabel.w, h: assignIconSize };
  const unassignButton: ButtonHit = {
    action: 'unassign-home',
    enabled: model.canUnassignHome,
    rect: unassignIcon,
  };

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
    assignButton,
    assignIcon,
    assignLabel,
    homeButton,
    homeIcon,
    homeLabel,
    unassignButton,
    unassignIcon,
    unassignLabel,
    gatherChoiceHits,
    craftChoiceHits,
    experience,
    expRow,
    equipment,
    equipRows,
  };
}
