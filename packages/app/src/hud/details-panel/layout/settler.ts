import { WIN_PAD } from '../../chrome.js';
import type { Rect } from '../../geometry.js';
import type { UnitPanelModel } from '../model/index.js';
import type { ButtonAction, ButtonHit } from './building.js';
import {
  EQUIP_ROW_H,
  type EquipActionHit,
  type EquipRowRect,
  equipRowLines,
  equipSlotMetrics,
  layoutEquipRows,
} from './settler-equipment.js';
import { layoutTrade, type TradeLayout, tradeBodyHeight } from './settler-trade.js';
import { PANEL_W, panelRect, ROW_H, SECTION_GAP, type SectionRect, sectionAt } from './shared.js';

type SettlerModel = Extract<UnitPanelModel, { kind: 'settler' }>;

/** The settler portrait box, smaller than the building preview so the name and stat bars fit beside it
 *  (observed off the original's human window). */
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

/** A craft operator's product toggle: the multi-select twin of {@link GatherChoiceHit}. */
export interface CraftChoiceHit {
  readonly goodType: number;
  readonly label: string;
  readonly goodId?: string;
  readonly selected: boolean;
  readonly rect: Rect;
}

/** The Praca body's post-and-home controls. The labels are decoded `humanwindow` strings; stacking them
 *  as rows in the work section is authored, like the rest of the panel's metrics. */
export type WorkControlAction = Extract<
  ButtonAction,
  'assign-workplace' | 'unassign-workplace' | 'assign-home' | 'unassign-home'
>;

/** One control row: the round glyph button, which is the whole clickable area, and the description
 *  column right of it, which is not hit-tested. */
export interface WorkControlRow {
  readonly action: WorkControlAction;
  readonly button: ButtonHit;
  readonly label: Rect;
}

/** The original's stacked human-window sections: Ogólne, Praca, Doświadczenie and Ekwipunek. */
export interface SettlerLayout {
  readonly kind: 'settler';
  readonly panel: Rect;
  readonly general: SectionRect;
  readonly preview: Rect;
  readonly name: Rect;
  readonly meta: Rect;
  /** One rect per `model.bars` entry (same order). */
  readonly bars: readonly Rect[];
  readonly work: SectionRect;
  /** The Handel section, only for a trader. */
  readonly trade: TradeLayout | null;
  /** The Praca body's two text rows (workplace, product). */
  readonly workRows: readonly Rect[];
  readonly workControls: readonly WorkControlRow[];
  readonly gatherChoiceHits: readonly GatherChoiceHit[];
  readonly craftChoiceHits: readonly CraftChoiceHit[];
  readonly experience: SectionRect;
  /** One row per trained specialization, then one per upcoming unlock. */
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

  // The original's human window does not fit to content, so the fixed rows below stay reserved whether
  // or not the settler fills them.
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
  // Every section body is inset the same way, so probe one to size the wrapped round-button block before
  // the section rects exist.
  const bodyW = sectionAt(0, 0, w, 0, s).body.w;
  const gatherPerRow = Math.max(1, Math.floor((bodyW + gatherIconGap) / (gatherIcon + gatherIconGap)));
  // The one non-empty choice list sizes the block they share.
  const choiceCount = model.work.gatherChoices.length + model.work.craftChoices.length;
  const gatherRows = choiceCount > 0 ? Math.ceil(choiceCount / gatherPerRow) : 0;
  const hasGather = gatherRows > 0;
  const gatherBlockH = hasGather ? gatherRows * gatherIcon + (gatherRows - 1) * gatherIconGap : 0;
  const gatherTopGap = hasGather ? gatherRowGap : 0;
  const preAssignGap = hasGather ? gatherAssignSep : assignRowGap;
  const controls: readonly { action: WorkControlAction; enabled: boolean }[] = [
    { action: 'assign-workplace', enabled: model.canAssignWorkplace },
    { action: 'unassign-workplace', enabled: model.canUnassignWorkplace },
    { action: 'assign-home', enabled: model.canAssignHome },
    { action: 'unassign-home', enabled: model.canUnassignHome },
  ];
  const controlsH = controls.length * assignIconSize + (controls.length - 1) * assignRowGap;
  const workBodyH = WORK_ROWS * rowH + gatherTopGap + gatherBlockH + preAssignGap + controlsH;
  const tradeBodyH = model.trade === null ? 0 : tradeBodyHeight(model.trade, bodyW, s);
  const expRowCount = model.experience.length + model.upcomingUnlocks.length;
  const expBodyH = expRowCount * rowH;
  const { slotsPerLine } = equipSlotMetrics(bodyW, s);
  const equipBodyH = equipRowLines(model.equipmentRows, slotsPerLine).reduce((a, b) => a + b, 0) * equipRowH;

  const heights = [generalBodyH, workBodyH, expBodyH, equipBodyH].map(
    (bodyH) => sectionAt(0, 0, w, bodyH, s).frame.h,
  );
  if (model.trade !== null) heights.push(sectionAt(0, 0, w, tradeBodyH, s).frame.h);
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
  const controlsTop = (hasGather ? gatherTop + gatherBlockH : work.body.y + WORK_ROWS * rowH) + preAssignGap;
  const labelX = work.body.x + assignIconSize + pad;
  const workControls: WorkControlRow[] = controls.map(({ action, enabled }, i) => {
    const y = controlsTop + i * (assignIconSize + assignRowGap);
    return {
      action,
      button: { action, enabled, rect: { x: work.body.x, y, w: assignIconSize, h: assignIconSize } },
      label: {
        x: labelX,
        y,
        w: Math.max(0, work.body.x + work.body.w - labelX),
        h: assignIconSize,
      },
    };
  });

  const trade = model.trade === null ? null : layoutTrade(model.trade, next(tradeBodyH), s);

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
    workControls,
    trade,
    gatherChoiceHits,
    craftChoiceHits,
    experience,
    expRows,
    equipment,
    equipRows,
    equipActionHits,
  };
}
