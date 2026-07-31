import { messages } from '../../i18n/index.js';
import { contains, type Rect } from '../geometry.js';

/**
 * The extras ("chest") window model: the assistant/plans tabs, the assistant's counter and grant
 * controls, their layout and hit-test (pure, no Pixi/DOM). The grant switches drive the sim's
 * auto-equip (`setAssistantGrant` through the controller's seam); the counters are still UI-only.
 *
 * Source basis: the chest button binding is decoded (gfx 0x2d, tooltip `main/5` "Otwiera okno
 * dodatków"), and the original window's own labels exist in the decoded `miscwindow` table (500
 * "Okno Dodatków" - the title used here, 501 "Papiery", 502 the block header, 503-509 the grant
 * commands "Zgromadź Buty!" etc. with their descriptions). The tab pair, the row wording, the
 * counter set and the geometry are a project reconstruction (named deviation): labels follow the
 * feature spec, not the decoded table.
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

/** Counters start at zero; the grant values are only the pre-read placeholder - the window
 *  overwrites them from the sim seam on every open, and the real default-ON rule lives in the map
 *  entry's `grantAssistantDefaults` (view/assistant-grants.ts). */
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

// --- Layout (design px, scaled by uiscale like the tool panel; building-menu proportions) ----------

const MENU_PAD = 6;
/** The rust title band across the top of the window (matches the build menu's). */
const HEADLINE_H = 18;
const TAB_W = 80;
const TAB_H = 18;
/** A small gap between the tab row and the first card, so the tabs read as a header. */
const LIST_GAP = 3;
/** Each control row sits on its own button-card, so the slot is taller than a plain text line. */
const ROW_H = 20;
const MENU_CLOSE = 13;
/** Wood gap between the counter block and the grant block. */
const BLOCK_GAP = 8;
/** Fits the longest grant label ("Przyznaj wszystkim drewniane narzędzia") at the HUD text size. */
const MENU_WIDTH = 260;
/** The −/+ stepper plates and the recessed value cell between them. */
const STEPPER = 14;
const VALUE_W = 24;
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
  /** The row's card slot (the controller insets it vertically into a plate, like the build menu). */
  readonly rect: Rect;
  readonly minusRect: Rect;
  readonly valueRect: Rect;
  readonly plusRect: Rect;
}

export interface ExtrasGrantRow {
  readonly id: AssistantGrantId;
  readonly label: string;
  readonly on: boolean;
  /** The row's card slot (see {@link ExtrasCounterRow.rect}). */
  readonly rect: Rect;
  readonly switchRect: Rect;
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
 * Resolve the window to screen rects: the rust headline + close X on top, the two tabs under it, then
 * (assistant tab) three counter cards and, after a wood gap, four grant cards - controls right-aligned
 * on a shared column. Purely geometric - text fits each rect at render time.
 */
export function layoutExtrasMenu(opts: ExtrasMenuLayoutOptions): ExtrasMenuLayout {
  // Fractional scale, the HUD-wide rule owned by `tabbed-list/model.ts`, so the geometry agrees with the
  // text runs, which draw at the same fractional uiscale - long grant labels must not overrun the switches.
  const s = Math.max(1, opts.scale);
  const { originX, originY, tab, state } = opts;
  const labels = messages().hud.extras;

  const width = MENU_WIDTH * s;
  const pad = MENU_PAD * s;
  const headlineH = HEADLINE_H * s;
  const tabH = TAB_H * s;
  const rowH = ROW_H * s;
  const bodyTop = originY + headlineH + tabH + LIST_GAP * s;
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
            rect: { x: originX + pad, y, w: width - 2 * pad, h: rowH },
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

  const bodyH = tab === 'assistant' ? (COUNTER_IDS.length + GRANT_IDS.length) * rowH + BLOCK_GAP * s : rowH;
  const height = headlineH + tabH + LIST_GAP * s + bodyH + pad;

  const closeSize = MENU_CLOSE * s;
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
    plansPlaceholder:
      tab === 'plans'
        ? { label: labels.plansEmpty, x: originX + pad + CONTROL_INSET_X * s, y: bodyTop }
        : null,
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
