import { components, type Paper, PLACING_PAPER_KINDS } from '@open-northland/sim';
import { messages } from '../../i18n/index.js';
import { contains, type Rect } from '../geometry.js';
import { MIN_UI_SCALE } from '../ui-scale.js';
import {
  CLOSE_BOX,
  HEADLINE_H,
  ROW_H,
  TAB_CONTENT_GAP,
  TAB_H,
  WINDOW_FAMILY_PAD,
} from './window-family/index.js';

/**
 * The extras ("chest") window model: the assistant/plans tabs, the counter and grant controls, the papers
 * list, their layout and hit-test. Grants drive the sim's auto-equip, counters its birth and training
 * queues, and a placing paper opens the build menu or placement it pays for.
 *
 * The decoded `miscwindow` table carries the original window's labels (500 the title, 501 "Papiery", 502
 * the block header, 503-509 the grant commands); the tab pair, row wording, counter set and geometry are
 * an approximation.
 */

export type ExtrasTab = 'assistant' | 'plans';

/** One paper as the plans tab lists it: its slot order, name, and whether a click spends it. */
export interface PaperFace {
  readonly paper: Paper;
  readonly label: string;
  /** The placing kinds are clickable; the rest are listed inert, as the original greys them. */
  readonly usable: boolean;
}

export function paperFace(paper: Paper, label: string): PaperFace {
  return { paper, label, usable: PLACING_PAPER_KINDS.has(paper.kind) };
}

/** The assistant's six production counters: two birth queues and four training queues. */
export type AssistantCounterId =
  | 'extraWomen'
  | 'extraMen'
  | 'trainSoldiers'
  | 'trainSwordsmen'
  | 'trainSpearmen'
  | 'trainArchers';

/** The assistant's four "give everyone …" grant switches. */
export type AssistantGrantId = 'giveBoots' | 'giveWoodenTools' | 'giveIronTools' | 'giveMead';

/** One counter's face: the queued amount and whether the queue never drains. */
export interface AssistantCounterFace {
  readonly value: number;
  readonly infinite: boolean;
}

export interface AssistantState {
  readonly counters: Readonly<Record<AssistantCounterId, AssistantCounterFace>>;
  readonly grants: Readonly<Record<AssistantGrantId, boolean>>;
}

/** The sim's own `setAssistantCounter` clamp, mirrored so the steppers stop where the command would. */
export const COUNTER_MIN = components.ASSISTANT_COUNTER_MIN;
export const COUNTER_MAX = components.ASSISTANT_COUNTER_MAX;

/** UI counter row → sim counter kind: the three class rows carry the display noun (swordsmen) while
 *  the sim carries the weapon class (sword); the other three share their name. */
export const SIM_KIND_BY_COUNTER_ID: Readonly<Record<AssistantCounterId, components.AssistantCounterKind>> = {
  extraWomen: 'extraWomen',
  extraMen: 'extraMen',
  trainSoldiers: 'trainSoldiers',
  trainSwordsmen: 'trainSword',
  trainSpearmen: 'trainSpear',
  trainArchers: 'trainBow',
};

/** The rows carrying an infinity toggle, derived from the sim's `INFINITE_COUNTER_KINDS` so a policy
 *  change there cannot leave a dead toggle here. */
export const INFINITE_COUNTER_IDS: ReadonlySet<AssistantCounterId> = new Set(
  (Object.keys(SIM_KIND_BY_COUNTER_ID) as AssistantCounterId[]).filter((id) =>
    components.INFINITE_COUNTER_KINDS.has(SIM_KIND_BY_COUNTER_ID[id]),
  ),
);

/** A pre-read placeholder only: the window overwrites both blocks from the sim seams on every open. */
export function defaultAssistantState(): AssistantState {
  const zero: AssistantCounterFace = { value: 0, infinite: false };
  return {
    counters: {
      extraWomen: zero,
      extraMen: zero,
      trainSoldiers: zero,
      trainSwordsmen: zero,
      trainSpearmen: zero,
      trainArchers: zero,
    },
    grants: { giveBoots: true, giveWoodenTools: true, giveIronTools: true, giveMead: true },
  };
}

/** `state` with `id` stepped by `delta`, clamped to the counter bounds. Stepping an infinite counter
 *  only drops the infinity and surfaces the retained value, since the lemniscate hides the number. */
export function adjustCounter(state: AssistantState, id: AssistantCounterId, delta: number): AssistantState {
  const current = state.counters[id];
  const next = current.infinite
    ? current.value
    : Math.min(COUNTER_MAX, Math.max(COUNTER_MIN, current.value + delta));
  if (next === current.value && !current.infinite) return state;
  return { ...state, counters: { ...state.counters, [id]: { value: next, infinite: false } } };
}

/** `state` with `id`'s infinity flipped; identical state for a row without the toggle. */
export function toggleInfinity(state: AssistantState, id: AssistantCounterId): AssistantState {
  if (!INFINITE_COUNTER_IDS.has(id)) return state;
  const current = state.counters[id];
  return {
    ...state,
    counters: { ...state.counters, [id]: { value: current.value, infinite: !current.infinite } },
  };
}

export function toggleGrant(state: AssistantState, id: AssistantGrantId): AssistantState {
  return { ...state, grants: { ...state.grants, [id]: !state.grants[id] } };
}

// This window's own layout in design px, over the shared family metrics.

/** Fixed tab width: the two tabs sit side by side instead of dividing the content width. */
const TAB_W = 80;
/** Wood gap between the counter block and the grant block. */
const BLOCK_GAP = 8;
/** Fits the longest grant label ("Przyznaj wszystkim drewniane narzędzia") at the HUD text size. */
const MENU_WIDTH = 260;
/** Side of the −/+ stepper plates, and the height of the value cell between them. */
const STEPPER = 14;
/** Sized for the cap's three digits ("100") at the row text size; an overrun drifts toward the plus plate. */
const VALUE_W = 28;
const CONTROL_GAP = 3;
/** The Wł./Wył. switch plate. */
const SWITCH_W = 36;
const SWITCH_H = 14;
/** Right-hand inset of a row's control column inside its card. */
const CONTROL_INSET_X = 4;

export interface ExtrasMenuTabRect {
  readonly tab: ExtrasTab;
  readonly label: string;
  readonly rect: Rect;
  readonly selected: boolean;
}

export interface ExtrasCounterRow {
  readonly id: AssistantCounterId;
  readonly label: string;
  readonly value: number;
  readonly infinite: boolean;
  /** The row's card slot. */
  readonly rect: Rect;
  /** The infinity toggle left of the stepper; null on a row without one (`extraWomen`). */
  readonly infinityRect: Rect | null;
  readonly minusRect: Rect;
  readonly valueRect: Rect;
  readonly plusRect: Rect;
}

export interface ExtrasGrantRow {
  readonly id: AssistantGrantId;
  readonly label: string;
  readonly on: boolean;
  /** The row's card slot. */
  readonly rect: Rect;
  readonly switchRect: Rect;
}

export interface ExtrasPaperRow {
  readonly index: number;
  readonly label: string;
  readonly usable: boolean;
  /** The row's card slot. */
  readonly rect: Rect;
}

export interface ExtrasMenuLayout {
  readonly scale: number;
  readonly window: Rect;
  /** The headline (title-band) rect; the close X sits on it. */
  readonly titleRect: Rect;
  readonly title: string;
  readonly closeRect: Rect;
  readonly tabs: readonly ExtrasMenuTabRect[];
  /** Empty on the plans tab. */
  readonly counters: readonly ExtrasCounterRow[];
  /** Empty on the plans tab. */
  readonly grants: readonly ExtrasGrantRow[];
  /** The plans tab's papers in slot order; empty on the assistant tab. */
  readonly papers: readonly ExtrasPaperRow[];
  /** The plans tab's empty-list line; null on the assistant tab and while papers are listed. */
  readonly plansPlaceholder: { readonly label: string; readonly x: number; readonly y: number } | null;
}

export interface ExtrasMenuLayoutOptions {
  readonly originX: number;
  readonly originY: number;
  readonly scale: number;
  readonly tab: ExtrasTab;
  readonly state: AssistantState;
  /** The player's papers in slot order; omitted lists none. */
  readonly papers?: readonly PaperFace[];
}

/** The counter rows in display order. */
export const COUNTER_IDS: readonly AssistantCounterId[] = [
  'extraWomen',
  'extraMen',
  'trainSoldiers',
  'trainSwordsmen',
  'trainSpearmen',
  'trainArchers',
];
const GRANT_IDS: readonly AssistantGrantId[] = ['giveBoots', 'giveWoodenTools', 'giveIronTools', 'giveMead'];

/** Resolve the window to screen rects, with every row's controls right-aligned on a shared column. */
export function layoutExtrasMenu(opts: ExtrasMenuLayoutOptions): ExtrasMenuLayout {
  // Kept fractional, like the text runs, so a long grant label cannot overrun its switch.
  const s = Math.max(MIN_UI_SCALE, opts.scale);
  const { originX, originY, tab, state } = opts;
  const labels = messages().hud.extras;

  const width = MENU_WIDTH * s;
  const pad = WINDOW_FAMILY_PAD * s;
  const headlineH = HEADLINE_H * s;
  const tabH = TAB_H * s;
  const rowH = ROW_H * s;
  const bodyTop = originY + headlineH + tabH + TAB_CONTENT_GAP * s;
  const controlRight = originX + width - pad - CONTROL_INSET_X * s;

  const tabs: ExtrasMenuTabRect[] = (
    [
      { tab: 'assistant', label: labels.assistantTab },
      { tab: 'plans', label: labels.plansTab },
    ] as const
  ).map((t, i) => ({
    ...t,
    selected: t.tab === tab,
    rect: { x: originX + pad + i * TAB_W * s, y: originY + headlineH, w: TAB_W * s, h: tabH },
  }));

  const counterLabels: Readonly<Record<AssistantCounterId, string>> = {
    extraWomen: labels.extraWomen,
    extraMen: labels.extraMen,
    trainSoldiers: labels.trainSoldiers,
    trainSwordsmen: labels.trainSwordsmen,
    trainSpearmen: labels.trainSpearmen,
    trainArchers: labels.trainArchers,
  };
  const grantLabels: Readonly<Record<AssistantGrantId, string>> = {
    giveBoots: labels.giveBoots,
    giveWoodenTools: labels.giveWoodenTools,
    giveIronTools: labels.giveIronTools,
    giveMead: labels.giveMead,
  };

  const counters: ExtrasCounterRow[] =
    tab !== 'assistant'
      ? []
      : COUNTER_IDS.map((id, i) => {
          const y = bodyTop + i * rowH;
          const stepper = STEPPER * s;
          const valueW = VALUE_W * s;
          const gap = CONTROL_GAP * s;
          const controlY = y + (rowH - stepper) / 2;
          const plusX = controlRight - stepper;
          const valueX = plusX - gap - valueW;
          const minusX = valueX - gap - stepper;
          const infinityX = minusX - gap - stepper;
          return {
            id,
            label: counterLabels[id],
            value: state.counters[id].value,
            infinite: state.counters[id].infinite,
            rect: { x: originX + pad, y, w: width - 2 * pad, h: rowH },
            infinityRect: INFINITE_COUNTER_IDS.has(id)
              ? { x: infinityX, y: controlY, w: stepper, h: stepper }
              : null,
            minusRect: { x: minusX, y: controlY, w: stepper, h: stepper },
            valueRect: { x: valueX, y: controlY, w: valueW, h: stepper },
            plusRect: { x: plusX, y: controlY, w: stepper, h: stepper },
          };
        });

  const grantsTop = bodyTop + COUNTER_IDS.length * rowH + BLOCK_GAP * s;
  const grants: ExtrasGrantRow[] =
    tab !== 'assistant'
      ? []
      : GRANT_IDS.map((id, i) => {
          const y = grantsTop + i * rowH;
          const switchW = SWITCH_W * s;
          const switchH = SWITCH_H * s;
          return {
            id,
            label: grantLabels[id],
            on: state.grants[id],
            rect: { x: originX + pad, y, w: width - 2 * pad, h: rowH },
            switchRect: {
              x: controlRight - switchW,
              y: y + (rowH - switchH) / 2,
              w: switchW,
              h: switchH,
            },
          };
        });

  const faces = tab === 'plans' ? (opts.papers ?? []) : [];
  const papers: ExtrasPaperRow[] = faces.map((face, i) => ({
    index: i,
    label: face.label,
    usable: face.usable,
    rect: { x: originX + pad, y: bodyTop + i * rowH, w: width - 2 * pad, h: rowH },
  }));

  const bodyRows = tab === 'assistant' ? COUNTER_IDS.length + GRANT_IDS.length : Math.max(1, papers.length);
  const bodyH = bodyRows * rowH + (tab === 'assistant' ? BLOCK_GAP * s : 0);
  const height = headlineH + tabH + TAB_CONTENT_GAP * s + bodyH + pad;

  const closeSize = CLOSE_BOX * s;
  return {
    scale: s,
    window: { x: originX, y: originY, w: width, h: height },
    titleRect: { x: originX, y: originY, w: width, h: headlineH },
    title: labels.title,
    closeRect: {
      x: originX + width - closeSize - pad,
      y: originY + (headlineH - closeSize) / 2,
      w: closeSize,
      h: closeSize,
    },
    tabs,
    counters,
    grants,
    papers,
    plansPlaceholder:
      tab === 'plans' && papers.length === 0
        ? { label: labels.plansEmpty, x: originX + pad + CONTROL_INSET_X * s, y: bodyTop }
        : null,
  };
}

/** What the cursor is over inside the open window. */
export type ExtrasMenuHit =
  | { readonly kind: 'tab'; readonly tab: ExtrasTab }
  | { readonly kind: 'counter'; readonly id: AssistantCounterId; readonly delta: 1 | -1 }
  | { readonly kind: 'counterInfinity'; readonly id: AssistantCounterId }
  | { readonly kind: 'grant'; readonly id: AssistantGrantId }
  /** A usable paper row; an inert row reads as the window body. */
  | { readonly kind: 'paper'; readonly index: number }
  | { readonly kind: 'close' }
  | { readonly kind: 'window' } // over the chrome but not an interactive element
  | null;

/** Resolve a screen point against the open window
 *  (close > tab > infinity > stepper > switch > paper > background > miss). */
export function hitTestExtrasMenu(layout: ExtrasMenuLayout, x: number, y: number): ExtrasMenuHit {
  if (contains(layout.closeRect, x, y)) return { kind: 'close' };
  for (const t of layout.tabs) {
    if (contains(t.rect, x, y)) return { kind: 'tab', tab: t.tab };
  }
  for (const c of layout.counters) {
    if (c.infinityRect !== null && contains(c.infinityRect, x, y)) {
      return { kind: 'counterInfinity', id: c.id };
    }
    if (contains(c.minusRect, x, y)) return { kind: 'counter', id: c.id, delta: -1 };
    if (contains(c.plusRect, x, y)) return { kind: 'counter', id: c.id, delta: 1 };
  }
  for (const g of layout.grants) {
    if (contains(g.switchRect, x, y)) return { kind: 'grant', id: g.id };
  }
  for (const p of layout.papers) {
    if (p.usable && contains(p.rect, x, y)) return { kind: 'paper', index: p.index };
  }
  if (contains(layout.window, x, y)) return { kind: 'window' };
  return null;
}
