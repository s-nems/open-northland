import { WIN_PAD } from '../../chrome.js';
import type { Rect } from '../../geometry.js';
import type { UnitPanelModel } from '../model/index.js';
import type { ButtonHit } from './building.js';
import {
  EQUIP_ROW_H,
  type EquipActionHit,
  type EquipRowRect,
  equipRowLines,
  equipSlotMetrics,
  layoutEquipRows,
} from './settler-equipment.js';
import { PANEL_W, panelRect, ROW_H, SECTION_GAP, type SectionRect, sectionAt } from './shared.js';

type SettlerModel = Extract<UnitPanelModel, { kind: 'settler' }>;

/** The settler portrait box, a square smaller than the building's 183 px preview so the name and stat
 *  bars fit beside it (measured against the original's human window). */
const SETTLER_PREVIEW = 96;
/** The profession (name) line at the top of the Ogólne right column. */
const SETTLER_NAME_H = 15;
/** The owner/tribe/stance meta line under the name. */
const SETTLER_META_H = 14;
/** One stat-bar row in the Ogólne right column (label + bar). */
const BAR_ROW_H = 13;
/** Text rows the fixed Praca body reserves. */
const WORK_ROWS = 2;
/** Diameter of the small round "przydziel miejsce pracy" button. */
const ASSIGN_ICON = 20;
/** Gap between the Praca text rows and the assign row when there are no gather buttons above it. */
const ASSIGN_BUTTON_GAP = 3;
/** Diameter of a round gather-choice button (a good's icon in a wooden well). */
const GATHER_ICON = 20;
/** Gap between adjacent round gather buttons (both axes). */
const GATHER_ICON_GAP = 4;
/** Gap between the Praca text rows and the row of round gather buttons. */
const GATHER_ROW_GAP = 3;
/** Extra separation between the gather-button block and the assign row, so the two don't read as one
 *  cluster. */
const GATHER_ASSIGN_SEP = 9;
export interface GatherChoiceHit {
  readonly goodType: number | null;
  readonly label: string;
  /** The good's icon key, carried through from the model; absent for the "Wszystko" choice. */
  readonly goodId?: string;
  readonly selected: boolean;
  readonly rect: Rect;
}

/** A craft operator's product toggle: the multi-select twin of {@link GatherChoiceHit}, sharing the same
 *  round-button grid, and a settler shows one block or the other, never both. */
export interface CraftChoiceHit {
  readonly goodType: number;
  readonly label: string;
  readonly goodId?: string;
  readonly selected: boolean;
  readonly rect: Rect;
}

/** The original's stacked human-window sections: Ogólne, Praca, Doświadczenie and Ekwipunek. */
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
  /** Equals {@link assignIcon}: only the round disc is clickable, so pointing at the label does nothing. */
  readonly assignButton: ButtonHit;
  readonly assignIcon: Rect;
  /** The assign row's description column, right of the round button. */
  readonly assignLabel: Rect;
  /** Equals {@link homeIcon}. */
  readonly homeButton: ButtonHit;
  readonly homeIcon: Rect;
  /** The assign-home row's description column. */
  readonly homeLabel: Rect;
  /** Equals {@link unassignIcon}. */
  readonly unassignButton: ButtonHit;
  readonly unassignIcon: Rect;
  /** The remove-from-home row's description column. */
  readonly unassignLabel: Rect;
  readonly gatherChoiceHits: readonly GatherChoiceHit[];
  /** The craft product toggles, exclusive with {@link gatherChoiceHits}: they share one grid slot. */
  readonly craftChoiceHits: readonly CraftChoiceHit[];
  readonly experience: SectionRect;
  /** One row per `model.experience` entry; empty when untrained. */
  readonly expRows: readonly Rect[];
  readonly equipment: SectionRect;
  /** One entry per `model.equipmentRows` (same order): its label rect + slot-socket rects. */
  readonly equipRows: readonly EquipRowRect[];
  /** The per-slot action buttons (equip/swap + take-off), flat across every equipment row. */
  readonly equipActionHits: readonly EquipActionHit[];
}

export function layoutSettler(
  model: SettlerModel,
  screen: { readonly width: number; readonly height: number },
  s: number,
): SettlerLayout {
  const w = Math.round(PANEL_W * s);
  const gap = Math.round(SECTION_GAP * s);

  // Stacked sections, bottom-anchored like the building panel. Each body reserves a fixed height, since
  // the original's human window does not fit to content; the equipment body scales with its row count.
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
  // Every section's body is inset from the panel width the same way, so probe it before the section
  // rects exist to size the wrapped round-button block.
  const bodyW = sectionAt(0, 0, w, 0, s).body.w;
  const gatherPerRow = Math.max(1, Math.floor((bodyW + gatherIconGap) / (gatherIcon + gatherIconGap)));
  // Gather and craft choices never coexist, so the one non-empty list sizes the shared button block.
  const choiceCount = model.work.gatherChoices.length + model.work.craftChoices.length;
  const gatherRows = choiceCount > 0 ? Math.ceil(choiceCount / gatherPerRow) : 0;
  const hasGather = gatherRows > 0;
  const gatherBlockH = hasGather ? gatherRows * gatherIcon + (gatherRows - 1) * gatherIconGap : 0;
  const gatherTopGap = hasGather ? gatherRowGap : 0;
  const preAssignGap = hasGather ? gatherAssignSep : assignRowGap;
  // Three stacked control rows close the Praca body: assign-workplace, assign-home, remove-from-home.
  const workBodyH =
    WORK_ROWS * rowH + gatherTopGap + gatherBlockH + preAssignGap + 3 * assignIconSize + 2 * assignRowGap;
  // The Doświadczenie body holds the trained specializations plus the dimmed upcoming-unlock rows.
  const expRowCount = model.experience.length + model.upcomingUnlocks.length;
  const expBodyH = expRowCount * rowH;
  const { slotsPerLine } = equipSlotMetrics(bodyW, s);
  const equipBodyH = equipRowLines(model.equipmentRows, slotsPerLine).reduce((a, b) => a + b, 0) * equipRowH;

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
  // Gather and craft choices share this grid, whichever list the model filled.
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
  const homeTop = assignTop + assignIconSize + assignRowGap;
  const homeIcon: Rect = { x: work.body.x, y: homeTop, w: assignIconSize, h: assignIconSize };
  const homeLabel: Rect = { x: assignLabel.x, y: homeTop, w: assignLabel.w, h: assignIconSize };
  const homeButton: ButtonHit = { action: 'assign-home', enabled: model.canAssignHome, rect: homeIcon };
  const unassignTop = homeTop + assignIconSize + assignRowGap;
  const unassignIcon: Rect = { x: work.body.x, y: unassignTop, w: assignIconSize, h: assignIconSize };
  const unassignLabel: Rect = { x: assignLabel.x, y: unassignTop, w: assignLabel.w, h: assignIconSize };
  const unassignButton: ButtonHit = {
    action: 'unassign-home',
    enabled: model.canUnassignHome,
    rect: unassignIcon,
  };

  const experience = next(expBodyH);
  const expRows: Rect[] = Array.from({ length: expRowCount }, (_unused, i) => ({
    x: experience.body.x,
    y: experience.body.y + i * rowH,
    w: experience.body.w,
    h: rowH,
  }));

  const equipment = next(equipBodyH);
  const { rects: equipRows, hits: equipActionHits } = layoutEquipRows(model.equipmentRows, equipment.body, s);

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
    expRows,
    equipment,
    equipRows,
    equipActionHits,
  };
}
