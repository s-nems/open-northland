import { Container } from 'pixi.js';
import { messages } from '../../i18n/index.js';
import {
  CLOSE_X_COLOR,
  drawBevel,
  drawCloseX,
  drawPlateOutline,
  drawTabButton,
  drawWindowFrame,
  HEADLINE_FILL,
  tileBitmap,
  WIN_PAD,
  WOOD_FILL,
} from '../chrome.js';
import type { Rect } from '../geometry.js';
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
import { type ClickModifiers, createWindowShell, type ToolWindow } from './window-shell.js';

/** Text sizes (design px) - the build menu's title/tab/row scale. */
const TITLE_PX = 13;
const TAB_PX = 11;
const ROW_PX = 11;
/** Approx. cap height (design px) of the body text - vertical centring inside a chrome rect. */
const TEXT_CAP_H = 10;
/** Left inset (design px) of a row label inside its button-card. */
const ROW_INSET_X = 8;
/** Vertical inset (design px) of a row card inside its slot - the gap separating consecutive cards. */
const CARD_INSET_Y = 2;
/** Design-px inset of the headline strip inside the window frame (so the frame reads around it). */
const HEADLINE_INSET = 2;
/** The −/+ glyph stroke inset inside its stepper plate (design px). */
const GLYPH_INSET = 4;
/** The recessed value cell's dark backdrop. */
const VALUE_CELL_FILL = 0x161009;
/** The decoded `miscwindow` id of the original extras-window title ("Okno Dodatków"). */
const EXTRAS_TITLE_STRING_ID = 500;
/** Ctrl/Cmd-click stepper multiplier. */
const CTRL_STEP = 10;

const faceDiffers = (a: AssistantCounterFace, b: AssistantCounterFace): boolean =>
  a.value !== b.value || a.infinite !== b.infinite;

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

export interface ExtrasWindowDeps {
  readonly ctx: PanelContext;
  /** The panel's window container the window mounts its own container under. */
  readonly container: Container;
  readonly grants: ExtrasGrantsSeam;
  readonly counters: ExtrasCountersSeam;
}

/** The pop-up extras ("chest") window: the assistant/plans tabs and the assistant's controls. */
export interface ExtrasWindow extends ToolWindow {
  /** Per-frame while open: re-place the text runs against the live canvas size. */
  place(): void;
}

/** Build the extras-window controller; the whole window is rebuilt on open and on any control click. */
export function createExtrasWindow(deps: ExtrasWindowDeps): ExtrasWindow {
  const { ctx } = deps;
  const { scale } = ctx;
  const shell = createWindowShell(deps.container);
  const back = new Container();
  shell.container.addChildAt(back, 0); // the tiled bitmap fills, behind the shell's frame Graphics
  const origin = {
    x: ctx.layout.width + WIN_PAD * scale,
    y: ctx.layout.buttons.find((b) => b.id === 'extras')?.placed.y ?? ctx.layout.strip.y,
  };

  let tab: ExtrasTab = 'assistant';
  let state: AssistantState = defaultAssistantState();
  let menuLayout: ExtrasMenuLayout | null = null;
  /** Screen position per run, same order as `shell.runs` - `place()` replays them. */
  let runsAt: { x: number; y: number }[] = [];
  /** The live counter block as read at the last local write. While the sim still shows exactly this
   *  block the write has not applied, so the click's echo must hold; any live change clears it. Several
   *  pending writes can briefly show an intermediate value, an accepted transient. */
  let echoBase: AssistantState['counters'] | null = null;

  const clear = (): void => {
    shell.clear();
    for (const child of back.removeChildren()) child.destroy();
    runsAt = [];
  };

  /** Queue a run with its top-left already resolved (rounded for crisp glyphs). */
  const addRunAt = (text: string, color: 'white' | 'dimmed', x: number, y: number, px?: number): void => {
    const run = ctx.makeText(text, color, px);
    shell.container.addChild(run.container);
    shell.runs.push(run);
    runsAt.push({ x: Math.round(x), y: Math.round(y) });
  };

  /** Queue a run centred in `rect`. */
  const addRunCentred = (text: string, color: 'white' | 'dimmed', rect: Rect, px?: number): void => {
    const run = ctx.makeText(text, color, px);
    shell.container.addChild(run.container);
    shell.runs.push(run);
    runsAt.push({
      x: Math.round(rect.x + Math.max(0, (rect.w - run.width * scale) / 2)),
      y: Math.round(rect.y + (rect.h - TEXT_CAP_H * scale) / 2),
    });
  };

  /** The row's card plate inside its slot. */
  const cardRect = (slot: Rect): Rect => ({
    x: slot.x,
    y: Math.round(slot.y + CARD_INSET_Y * scale),
    w: slot.w,
    h: Math.round(slot.h - 2 * CARD_INSET_Y * scale),
  });

  /** A raised button plate: tiled button bitmap + gold outline (flat tab-button fallback). */
  const drawPlate = (r: Rect, lit: boolean): void => {
    const tex = lit ? ctx.bitmaps.buttonHilite : ctx.bitmaps.button;
    if (tileBitmap(back, tex, r, scale)) drawPlateOutline(shell.graphics, r, scale);
    else drawTabButton(shell.graphics, r, scale, lit);
  };

  const drawStepper = (r: Rect, glyph: 'minus' | 'plus'): void => {
    drawPlate(r, false);
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
    clear();
    menuLayout = layoutExtrasMenu({ originX: origin.x, originY: origin.y, scale, tab, state });
    const layout = menuLayout;

    if (!tileBitmap(back, ctx.bitmaps.bg, layout.window, scale)) {
      shell.graphics.rect(layout.window.x, layout.window.y, layout.window.w, layout.window.h).fill(WOOD_FILL);
    }
    drawWindowFrame(shell.graphics, layout.window, scale);

    const inset = Math.round(HEADLINE_INSET * scale);
    const band: Rect = {
      x: layout.titleRect.x + inset,
      y: layout.titleRect.y + inset,
      w: layout.titleRect.w - 2 * inset,
      h: layout.titleRect.h - inset,
    };
    if (!tileBitmap(back, ctx.bitmaps.headline, band, scale)) {
      shell.graphics.rect(band.x, band.y, band.w, band.h).fill(HEADLINE_FILL);
    }
    drawCloseX(shell.graphics, layout.closeRect, scale);
    addRunCentred(
      ctx.uiString('miscwindow', EXTRAS_TITLE_STRING_ID, layout.title),
      'white',
      layout.titleRect,
      TITLE_PX,
    );

    for (const t of layout.tabs) {
      drawPlate(t.rect, t.selected);
      if (!t.selected && ctx.bitmaps.button !== undefined) {
        drawBevel(shell.graphics, t.rect, scale, 'pressed'); // recede the inactive tab
      }
      addRunCentred(t.label, t.selected ? 'white' : 'dimmed', t.rect, TAB_PX);
    }
    for (const c of layout.counters) {
      const card = cardRect(c.rect);
      drawPlate(card, false);
      addRunAt(
        c.label,
        'white',
        card.x + ROW_INSET_X * scale,
        card.y + (card.h - TEXT_CAP_H * scale) / 2,
        ROW_PX,
      );
      if (c.infinityRect !== null) {
        drawPlate(c.infinityRect, c.infinite); // lit while the queue never drains
        drawInfinityGlyph(c.infinityRect);
      }
      drawStepper(c.minusRect, 'minus');
      drawStepper(c.plusRect, 'plus');
      shell.graphics.rect(c.valueRect.x, c.valueRect.y, c.valueRect.w, c.valueRect.h).fill(VALUE_CELL_FILL);
      drawBevel(shell.graphics, c.valueRect, scale, 'pressed');
      if (c.infinite) drawInfinityGlyph(c.valueRect);
      else addRunCentred(String(c.value), 'white', c.valueRect, ROW_PX);
    }
    for (const g of layout.grants) {
      const card = cardRect(g.rect);
      drawPlate(card, false);
      addRunAt(
        g.label,
        'white',
        card.x + ROW_INSET_X * scale,
        card.y + (card.h - TEXT_CAP_H * scale) / 2,
        ROW_PX,
      );
      drawPlate(g.switchRect, g.on);
      if (!g.on && ctx.bitmaps.button !== undefined)
        drawBevel(shell.graphics, g.switchRect, scale, 'pressed');
      addRunCentred(
        g.on ? messages().hud.extras.on : messages().hud.extras.off,
        g.on ? 'white' : 'dimmed',
        g.switchRect,
        ROW_PX,
      );
    }
    if (layout.plansPlaceholder !== null) {
      const p = layout.plansPlaceholder;
      addRunAt(p.label, 'dimmed', p.x, p.y + (layout.scale * TEXT_CAP_H) / 2, ROW_PX);
    }
    place();
  };

  const place = (): void => {
    if (menuLayout === null) return;
    // Rebuild only when a live face actually changed.
    const live = deps.counters.read();
    if (echoBase === null || !countersEqual(live, echoBase)) {
      echoBase = null; // the sim moved: whatever we wrote is applied or overtaken, so show live
      if (!countersEqual(state.counters, live)) {
        state = { ...state, counters: live };
        rebuild();
        return; // rebuild ends by re-running place()
      }
    }
    const { width: rw, height: rh } = ctx.screen();
    for (let i = 0; i < shell.runs.length; i++) {
      const at = runsAt[i];
      if (at !== undefined) shell.runs[i]?.place(at.x, at.y, scale, rw, rh);
    }
  };

  const close = (): void => {
    shell.setOpen(false);
    clear();
    menuLayout = null;
  };

  return {
    isOpen: shell.isOpen,
    toggle: () => {
      if (shell.isOpen()) close();
      else {
        shell.setOpen(true);
        state = { counters: deps.counters.read(), grants: deps.grants.read() };
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
      switch (hit.kind) {
        case 'close':
          close();
          break;
        case 'tab':
          tab = hit.tab;
          rebuild();
          break;
        case 'counter': {
          const next = adjustCounter(state, hit.id, hit.delta * (mods?.bigStep === true ? CTRL_STEP : 1));
          const face = next.counters[hit.id];
          if (next !== state && deps.counters.set(hit.id, face.value, face.infinite)) {
            echoBase = deps.counters.read(); // the pre-apply block the echo holds against
            state = next; // local echo; the command applies next sim tick
            rebuild();
          }
          break;
        }
        case 'counterInfinity': {
          const next = toggleInfinity(state, hit.id);
          const face = next.counters[hit.id];
          if (next !== state && deps.counters.set(hit.id, face.value, face.infinite)) {
            echoBase = deps.counters.read();
            state = next;
            rebuild();
          }
          break;
        }
        case 'grant':
          if (deps.grants.set(hit.id, !state.grants[hit.id])) {
            state = toggleGrant(state, hit.id); // local echo
            rebuild();
          }
          break;
        case 'window':
          break; // a click on the window body is consumed
        default: {
          const unreachable: never = hit;
          return unreachable;
        }
      }
      return true;
    },
    place,
  };
}
