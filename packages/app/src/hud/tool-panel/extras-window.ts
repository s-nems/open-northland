import type { Paper } from '@open-northland/sim';
import { Container } from 'pixi.js';
import { messages } from '../../i18n/index.js';
import { CLOSE_X_COLOR, drawBevel } from '../chrome.js';
import type { Rect } from '../geometry.js';
import { liftedTop } from '../regions.js';
import type { PanelContext } from './context.js';
import type { AssistantCounterFace, AssistantCounterId, AssistantGrantId } from './extras-menu.js';
import {
  type AssistantState,
  adjustCounter,
  COUNTER_IDS,
  defaultAssistantState,
  type ExtrasMenuLayout,
  type ExtrasTab,
  hitTestExtrasMenu,
  layoutExtrasMenu,
  toggleGrant,
  toggleInfinity,
} from './extras-menu.js';
import { type PaperFace, paperFace } from './extras-papers.js';
import {
  addRun,
  centreRun,
  clearFills,
  paintPlate,
  paintTitledTabWindow,
  placeOnCard,
  ROW_PX,
  rowCardRect,
  TEXT_CAP_H,
  type WindowLayers,
} from './window-family/index.js';
import { type ClickModifiers, createWindowShell, type ToolWindow } from './window-shell.js';

/** The −/+ glyph stroke inset inside its stepper plate (design px). */
const GLYPH_INSET = 4;
/** The recessed value cell's dark backdrop. */
const VALUE_CELL_FILL = 0x161009;
/** The decoded `miscwindow` id of the original extras-window title ("Okno Dodatków"). */
const EXTRAS_TITLE_STRING_ID = 500;
/** The `miscwindow` row naming the original's papers tab. */
const PAPERS_TAB_STRING_ID = 501;
/** Ctrl/Cmd-click stepper multiplier. */
const CTRL_STEP = 10;

const faceDiffers = (a: AssistantCounterFace, b: AssistantCounterFace): boolean =>
  a.value !== b.value || a.infinite !== b.infinite;

const samePapers = (a: readonly Paper[], b: readonly Paper[]): boolean =>
  a.length === b.length && a.every((p, i) => p.kind === b[i]?.kind && p.param === b[i]?.param);

const countersEqual = (
  a: Readonly<Record<AssistantCounterId, AssistantCounterFace>>,
  b: Readonly<Record<AssistantCounterId, AssistantCounterFace>>,
): boolean => COUNTER_IDS.every((id) => !faceDiffers(a[id], b[id]));

/** The grant switches' sim seam, read on open: a click writes one `setAssistantGrant` command per
 *  mapped good. */
export interface ExtrasGrantsSeam {
  /** The live per-switch state; a switch is ON when every good it flips is granted. */
  read(): Readonly<Record<AssistantGrantId, boolean>>;
  /** Flip one switch; false when the write was rejected, which the window must not echo. */
  set(id: AssistantGrantId, enabled: boolean): boolean;
}

/**
 * The counters' sim seam: the sim's per-player counter block drains as the queue produces, so the window
 * re-reads it every frame.
 */
export interface ExtrasCountersSeam {
  read(): Readonly<Record<AssistantCounterId, AssistantCounterFace>>;
  /** Set one counter's absolute face; false when rejected, and no echo then. */
  set(id: AssistantCounterId, value: number, infinite: boolean): boolean;
}

/** The papers list's sim seam: the player's papers in slot order, re-read every frame the window is open. */
export interface ExtrasPapersSeam {
  read(): readonly Paper[];
}

export interface ExtrasWindowDeps {
  readonly ctx: PanelContext;
  /** The panel's window container the window mounts its own container under. */
  readonly container: Container;
  readonly grants: ExtrasGrantsSeam;
  readonly counters: ExtrasCountersSeam;
  readonly papers: ExtrasPapersSeam;
  /** A paper's display name, the `misclogic` 180-186 row with its house, trade or good filled in. */
  readonly paperLabel: (paper: Paper) => string;
  /** A usable paper was clicked: the caller opens the build flow that spends it. Always closes the window. */
  readonly onUsePaper: (paper: Paper) => void;
}

/** The pop-up extras ("chest") window: the assistant/plans tabs and the assistant's controls. */
export interface ExtrasWindow extends ToolWindow {
  /** Per-frame hook: rebuild when the sim's live counter block moved off what the window shows. */
  refresh(): void;
  state(): ExtrasTab;
  restore(tab: ExtrasTab): void;
}

/** Build the extras-window controller; the whole window is rebuilt on open and on any control click. */
export function createExtrasWindow(deps: ExtrasWindowDeps): ExtrasWindow {
  const { ctx } = deps;
  const { scale } = ctx;
  const shell = createWindowShell(deps.container);
  const back = new Container();
  shell.container.addChildAt(back, 0); // the tiled bitmap fills, behind the shell's frame Graphics
  const layers: WindowLayers = {
    ctx,
    container: shell.container,
    back,
    graphics: shell.graphics,
    runs: shell.runs,
  };
  // The window cannot shrink, so a foot that would cross the beam lifts the whole window instead.
  const place = (width: number, height: number): { readonly x: number; readonly y: number } => {
    const screen = ctx.screen();
    const at = ctx.layout.windowOrigin(screen, width);
    return { x: at.x, y: liftedTop(at.y, height, ctx.layout.windowFloor(screen), 0) };
  };
  let screenKey = '';

  let tab: ExtrasTab = 'assistant';
  let state: AssistantState = defaultAssistantState();
  let papers: readonly PaperFace[] = [];
  /** The raw list the faces were built from, so a frame with no change labels nothing. */
  let rawPapers: readonly Paper[] = [];
  const readPapers = (): readonly PaperFace[] => {
    const live = deps.papers.read();
    if (samePapers(live, rawPapers)) return papers;
    rawPapers = live;
    return live.map((p) => paperFace(p, deps.paperLabel(p)));
  };
  let menuLayout: ExtrasMenuLayout | null = null;
  /** The live counter block as read at the last local write. While the sim still shows exactly this
   *  block the write has not applied, so the click's echo must hold; any live change clears it. Several
   *  pending writes can briefly show an intermediate value, an accepted transient. */
  let echoBase: AssistantState['counters'] | null = null;

  const drawStepper = (r: Rect, glyph: 'minus' | 'plus'): void => {
    paintPlate(layers, r, false);
    const inset = Math.max(2, GLYPH_INSET * scale);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    shell.graphics.moveTo(r.x + inset, cy).lineTo(r.x + r.w - inset, cy);
    if (glyph === 'plus') shell.graphics.moveTo(cx, r.y + inset).lineTo(cx, r.y + r.h - inset);
    shell.graphics.stroke({ color: CLOSE_X_COLOR, width: Math.max(1, scale) });
  };

  /** The lemniscate as two stroked circles - drawn, not text: the HUD font subsets carry no '∞'. */
  const drawInfinityGlyph = (r: Rect): void => {
    const radius = Math.max(2, r.h / 5);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    shell.graphics.circle(cx - radius, cy, radius).circle(cx + radius, cy, radius);
    shell.graphics.stroke({ color: CLOSE_X_COLOR, width: Math.max(1, scale) });
  };

  const rebuild = (): void => {
    shell.clear();
    clearFills(back);
    const measured = layoutExtrasMenu({ originX: 0, originY: 0, scale, tab, state, papers });
    const at = place(measured.window.w, measured.window.h);
    const screen = ctx.screen();
    screenKey = `${screen.width}x${screen.height}`;
    menuLayout = layoutExtrasMenu({ originX: at.x, originY: at.y, scale, tab, state, papers });
    const layout = menuLayout;

    paintTitledTabWindow(
      layers,
      layout,
      layout.tabs.map((t) =>
        t.tab === 'plans' ? { ...t, label: ctx.uiString('miscwindow', PAPERS_TAB_STRING_ID, t.label) } : t,
      ),
      ctx.uiString('miscwindow', EXTRAS_TITLE_STRING_ID, layout.title),
    );

    for (const c of layout.counters) {
      const card = rowCardRect(c.rect, scale);
      paintPlate(layers, card, false);
      placeOnCard(layers, addRun(layers, c.label, 'white', ROW_PX), card);
      if (c.infinityRect !== null) {
        paintPlate(layers, c.infinityRect, c.infinite); // lit while the queue never drains
        drawInfinityGlyph(c.infinityRect);
      }
      drawStepper(c.minusRect, 'minus');
      drawStepper(c.plusRect, 'plus');
      shell.graphics.rect(c.valueRect.x, c.valueRect.y, c.valueRect.w, c.valueRect.h).fill(VALUE_CELL_FILL);
      drawBevel(shell.graphics, c.valueRect, scale, 'pressed');
      if (c.infinite) drawInfinityGlyph(c.valueRect);
      else centreRun(layers, addRun(layers, String(c.value), 'white', ROW_PX), c.valueRect);
    }
    for (const g of layout.grants) {
      const card = rowCardRect(g.rect, scale);
      paintPlate(layers, card, false);
      placeOnCard(layers, addRun(layers, g.label, 'white', ROW_PX), card);
      if (paintPlate(layers, g.switchRect, g.on) === 'tiled' && !g.on) {
        drawBevel(shell.graphics, g.switchRect, scale, 'pressed'); // recede the OFF switch
      }
      centreRun(
        layers,
        addRun(
          layers,
          g.on ? messages().hud.extras.on : messages().hud.extras.off,
          g.on ? 'white' : 'dimmed',
          ROW_PX,
        ),
        g.switchRect,
      );
    }
    for (const p of layout.papers) {
      const card = rowCardRect(p.rect, scale);
      paintPlate(layers, card, false);
      placeOnCard(layers, addRun(layers, p.label, p.usable ? 'white' : 'dimmed', ROW_PX), card);
    }
    if (layout.plansPlaceholder !== null) {
      const p = layout.plansPlaceholder;
      const run = addRun(layers, p.label, 'dimmed', ROW_PX);
      const { width: rw, height: rh } = ctx.screen();
      run.place(Math.round(p.x), Math.round(p.y + (layout.scale * TEXT_CAP_H) / 2), scale, rw, rh);
    }
  };

  const close = (): void => {
    shell.setOpen(false);
    shell.clear();
    clearFills(back);
    menuLayout = null;
  };

  /** Push one counter's face to the sim and echo it locally, unless the seam rejected the write. */
  const commitCounter = (next: AssistantState, id: AssistantCounterId): void => {
    if (next === state) return;
    const face = next.counters[id];
    if (!deps.counters.set(id, face.value, face.infinite)) return;
    echoBase = deps.counters.read(); // the pre-apply block the echo holds against
    state = next; // local echo; the command applies next sim tick
    rebuild();
  };

  return {
    isOpen: shell.isOpen,
    toggle: () => {
      if (shell.isOpen()) close();
      else {
        shell.setOpen(true);
        state = { counters: deps.counters.read(), grants: deps.grants.read() };
        papers = readPapers();
        echoBase = null; // a fresh read has nothing pending to hold
        rebuild();
      }
    },
    close,
    claims: (x, y) => shell.claims(menuLayout?.window ?? null, x, y),
    handleClick: (x, y, mods?: ClickModifiers): boolean => {
      if (!shell.isOpen() || menuLayout === null) return false;
      const hit = hitTestExtrasMenu(menuLayout, x, y);
      if (hit === null) return false;
      if (hit.kind !== 'window') ctx.cue('confirm');
      switch (hit.kind) {
        case 'close':
          close();
          break;
        case 'tab':
          tab = hit.tab;
          rebuild();
          break;
        case 'counter':
          commitCounter(
            adjustCounter(state, hit.id, hit.delta * (mods?.bigStep === true ? CTRL_STEP : 1)),
            hit.id,
          );
          break;
        case 'counterInfinity':
          commitCounter(toggleInfinity(state, hit.id), hit.id);
          break;
        case 'grant':
          if (deps.grants.set(hit.id, !state.grants[hit.id])) {
            state = toggleGrant(state, hit.id); // local echo
            rebuild();
          }
          break;
        case 'paper': {
          const face = papers[hit.index];
          close();
          if (face !== undefined) deps.onUsePaper(face.paper);
          break;
        }
        case 'window':
          break; // a click on the window body is consumed
        default: {
          const unreachable: never = hit;
          return unreachable;
        }
      }
      return true;
    },
    refresh: (): void => {
      if (!shell.isOpen()) return;
      const screen = ctx.screen();
      if (`${screen.width}x${screen.height}` !== screenKey) rebuild();
      const livePapers = readPapers();
      if (livePapers !== papers) {
        papers = livePapers;
        rebuild();
      }
      const live = deps.counters.read();
      if (echoBase !== null && countersEqual(live, echoBase)) return; // the write has not applied yet
      echoBase = null; // the sim moved: whatever we wrote is applied or overtaken, so show live
      if (countersEqual(state.counters, live)) return;
      state = { ...state, counters: live };
      rebuild();
    },
    state: () => tab,
    restore: (nextTab): void => {
      tab = nextTab;
    },
  };
}
