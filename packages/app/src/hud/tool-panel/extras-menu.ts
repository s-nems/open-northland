import { messages } from '../../i18n/index.js';
import { contains, type Rect } from '../geometry.js';

/**
 * The extras ("chest") window model: the assistant/plans tabs, the assistant's counter and grant
 * controls, their layout and hit-test (pure, no Pixi/DOM). UI-only: nothing consumes this state yet
 * (the sim's auto-drink runs regardless of the mead switch until the grant wiring lands).
 *
 * Source basis: the chest button binding is decoded (gfx 0x2d, tooltip `main/5` "Otwiera okno
 * dodatków"), and the original window's own labels exist in the decoded `miscwindow` table (500
 * "Okno Dodatków", 501 "Papiery", 502-510 the grant commands "Zgromadź Buty!" etc.). The tab pair,
 * the wording used here, the counter set and the geometry are a project reconstruction (named
 * deviation): labels follow the feature spec, not the decoded table.
 */

export type ExtrasTab = 'assistant' | 'plans';

/** The assistant's three population counters (extra women / extra men / soldiers to train). */
export type AssistantCounterId = 'extraWomen' | 'extraMen' | 'trainSoldiers';

/** The assistant's four "give everyone …" grant switches. */
export type AssistantGrantId = 'giveBoots' | 'giveWoodenTools' | 'giveIronTools' | 'giveMead';

export interface AssistantState {
  readonly counters: Readonly<Record<AssistantCounterId, number>>;
  readonly grants: Readonly<Record<AssistantGrantId, boolean>>;
}

/** Counter bounds: never negative, capped where the two-digit value cell ends. */
export const COUNTER_MIN = 0;
export const COUNTER_MAX = 99;

/** All grants default ON: the assistant hands out gear unless switched off - a project decision
 *  (the original's decoded "Zgromadź X!" command labels suggest player-armed toggles). */
export function defaultAssistantState(): AssistantState {
  return {
    counters: { extraWomen: 0, extraMen: 0, trainSoldiers: 0 },
    grants: { giveBoots: true, giveWoodenTools: true, giveIronTools: true, giveMead: true },
  };
}

/** `state` with `id` stepped by `delta`, clamped to the counter bounds; identical state on a no-op. */
export function adjustCounter(state: AssistantState, id: AssistantCounterId, delta: number): AssistantState {
  const next = Math.min(COUNTER_MAX, Math.max(COUNTER_MIN, state.counters[id] + delta));
  if (next === state.counters[id]) return state;
  return { ...state, counters: { ...state.counters, [id]: next } };
}

export function toggleGrant(state: AssistantState, id: AssistantGrantId): AssistantState {
  return { ...state, grants: { ...state.grants, [id]: !state.grants[id] } };
}

// --- Layout (design px, scaled by uiscale like the tool panel) ------------------------------------

const MENU_PAD = 6;
const TAB_W = 70;
const TAB_H = 16;
const ROW_H = 15;
const MENU_CLOSE = 13;
/** Gap between the tab strip and the first row, and between the counter and grant blocks. */
const BLOCK_GAP = 8;
/** Fits the longest grant label ("Przyznaj wszystkim drewniane narzędzia") at the HUD text size. */
const MENU_WIDTH = 250;
/** The −/+ stepper squares and the value cell between them. */
const STEPPER = 12;
const VALUE_W = 22;
const CONTROL_GAP = 2;
/** The ON/OFF switch plate. */
const SWITCH_W = 30;
const SWITCH_H = 12;

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
  readonly labelPos: { readonly x: number; readonly y: number };
  readonly minusRect: Rect;
  readonly valueRect: Rect;
  readonly plusRect: Rect;
}

export interface ExtrasGrantRow {
  readonly id: AssistantGrantId;
  readonly label: string;
  readonly on: boolean;
  readonly labelPos: { readonly x: number; readonly y: number };
  readonly switchRect: Rect;
}

export interface ExtrasMenuLayout {
  readonly scale: number;
  readonly window: Rect;
  readonly closeRect: Rect;
  readonly tabs: readonly ExtrasMenuTabRect[];
  /** Empty on the plans tab. */
  readonly counters: readonly ExtrasCounterRow[];
  /** Empty on the plans tab. */
  readonly grants: readonly ExtrasGrantRow[];
  /** The plans tab's placeholder line; null on the assistant tab. */
  readonly plansPlaceholder: { readonly label: string; readonly x: number; readonly y: number } | null;
}

export interface ExtrasMenuLayoutOptions {
  readonly originX: number;
  readonly originY: number;
  readonly scale: number;
  readonly tab: ExtrasTab;
  readonly state: AssistantState;
}

const COUNTER_IDS: readonly AssistantCounterId[] = ['extraWomen', 'extraMen', 'trainSoldiers'];
const GRANT_IDS: readonly AssistantGrantId[] = ['giveBoots', 'giveWoodenTools', 'giveIronTools', 'giveMead'];

/**
 * Resolve the window to screen rects: the two tabs + close X on top, then (assistant tab) the three
 * counter rows and, after a block gap, the four grant rows - controls right-aligned on a shared column.
 * Purely geometric - text fits each rect at render time.
 */
export function layoutExtrasMenu(opts: ExtrasMenuLayoutOptions): ExtrasMenuLayout {
  // Fractional scale (the building menu's convention) so the geometry agrees with the text runs,
  // which draw at the same fractional uiscale - the long grant labels must not overrun the switches.
  const s = Math.max(1, opts.scale);
  const { originX, originY, tab, state } = opts;
  const labels = messages().hud.extras;

  const width = MENU_WIDTH * s;
  const pad = MENU_PAD * s;
  const tabH = TAB_H * s;
  const rowH = ROW_H * s;
  const bodyTop = originY + tabH + BLOCK_GAP * s;
  const controlRight = originX + width - pad;

  const tabs: ExtrasMenuTabRect[] = (
    [
      { tab: 'assistant', label: labels.assistantTab },
      { tab: 'plans', label: labels.plansTab },
    ] as const
  ).map((t, i) => ({
    ...t,
    selected: t.tab === tab,
    rect: { x: originX + pad + i * TAB_W * s, y: originY, w: TAB_W * s, h: tabH },
  }));

  const counterLabels: Readonly<Record<AssistantCounterId, string>> = {
    extraWomen: labels.extraWomen,
    extraMen: labels.extraMen,
    trainSoldiers: labels.trainSoldiers,
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
          return {
            id,
            label: counterLabels[id],
            value: state.counters[id],
            labelPos: { x: originX + pad, y },
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
            labelPos: { x: originX + pad, y },
            switchRect: {
              x: controlRight - switchW,
              y: y + (rowH - switchH) / 2,
              w: switchW,
              h: switchH,
            },
          };
        });

  const bodyH = tab === 'assistant' ? (COUNTER_IDS.length + GRANT_IDS.length) * rowH + BLOCK_GAP * s : rowH;
  const height = tabH + BLOCK_GAP * s + bodyH + pad;

  const closeSize = MENU_CLOSE * s;
  return {
    scale: s,
    window: { x: originX, y: originY, w: width, h: height },
    closeRect: {
      x: originX + width - closeSize - pad,
      y: originY + (tabH - closeSize) / 2,
      w: closeSize,
      h: closeSize,
    },
    tabs,
    counters,
    grants,
    plansPlaceholder: tab === 'plans' ? { label: labels.plansEmpty, x: originX + pad, y: bodyTop } : null,
  };
}

/** What the cursor is over inside the open window. */
export type ExtrasMenuHit =
  | { readonly kind: 'tab'; readonly tab: ExtrasTab }
  | { readonly kind: 'counter'; readonly id: AssistantCounterId; readonly delta: 1 | -1 }
  | { readonly kind: 'grant'; readonly id: AssistantGrantId }
  | { readonly kind: 'close' }
  | { readonly kind: 'window' } // over the chrome but not an interactive element
  | null;

/** Resolve a screen point against the open window (close > tab > stepper > switch > background > miss). */
export function hitTestExtrasMenu(layout: ExtrasMenuLayout, x: number, y: number): ExtrasMenuHit {
  if (contains(layout.closeRect, x, y)) return { kind: 'close' };
  for (const t of layout.tabs) {
    if (contains(t.rect, x, y)) return { kind: 'tab', tab: t.tab };
  }
  for (const c of layout.counters) {
    if (contains(c.minusRect, x, y)) return { kind: 'counter', id: c.id, delta: -1 };
    if (contains(c.plusRect, x, y)) return { kind: 'counter', id: c.id, delta: 1 };
  }
  for (const g of layout.grants) {
    if (contains(g.switchRect, x, y)) return { kind: 'grant', id: g.id };
  }
  if (contains(layout.window, x, y)) return { kind: 'window' };
  return null;
}
