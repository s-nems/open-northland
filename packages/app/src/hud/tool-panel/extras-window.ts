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
/** Ctrl/Cmd-click stepper multiplier (feature spec: a held Ctrl steps by ten). */
const CTRL_STEP = 10;

const faceDiffers = (a: AssistantCounterFace, b: AssistantCounterFace): boolean =>
  a.value !== b.value || a.infinite !== b.infinite;

const countersEqual = (
  a: Readonly<Record<AssistantCounterId, AssistantCounterFace>>,
  b: Readonly<Record<AssistantCounterId, AssistantCounterFace>>,
): boolean => COUNTER_IDS.every((id) => !faceDiffers(a[id], b[id]));

/**
 * The grant switches' sim seam: the switch faces mirror the sim's per-player grant list, a click
 * writes through it (one `setAssistantGrant` command per mapped good - the mapping is the seam
 * builder's content join, `view/assistant-grants.ts`).
 */
export interface ExtrasGrantsSeam {
  /** The live per-switch state (a switch is ON when every good it flips is granted). */
  read(): Readonly<Record<AssistantGrantId, boolean>>;
  /** Flip one switch; false when the write was rejected (a read-only session, an unmapped switch) -
   *  the window must not echo a rejected write, or its face would lie until the next open. */
  set(id: AssistantGrantId, enabled: boolean): boolean;
}

/**
 * The counters' sim seam (`view/assistant-counters.ts`): the faces mirror the sim's per-player
 * counter block - which DRAINS as the queue produces, so the window re-reads it every frame - and a
 * click writes one absolute `setAssistantCounter` through it.
 */
export interface ExtrasCountersSeam {
  read(): Readonly<Record<AssistantCounterId, AssistantCounterFace>>;
  /** Set one counter's absolute face; false when rejected (a read-only session) - no echo then. */
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

/**
 * Build the extras-window controller over the pure {@link layoutExtrasMenu} geometry, on the shared
 * {@link createWindowShell} lifecycle and the build menu's chrome (tiled wood body, rust headline,
 * button-card rows; every bitmap degrades to flat Graphics). Rebuilt on open and on any control click
 * (every click moves a visible value, and the window is a dozen runs). Both control blocks live in
 * the sim: grants read on open, counters re-read every frame (the queues drain as they produce),
 * each written through its seam on click with a local echo while the command applies next tick.
 */
export function createExtrasWindow(deps: ExtrasWindowDeps): ExtrasWindow {
  const { ctx } = deps;
  const { scale } = ctx;
  const shell = createWindowShell(deps.container);
  const back = new Container();
  shell.container.addChildAt(back, 0); // the tiled bitmap fills, behind the shell's frame Graphics
  // Right of the strip, dropping from the extras (chest) button - same reasoning as the building
  // menu's origin: it clears the top-left debug overlay and anchors the window to its button.
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
   *  block, the write has not applied (a queued command, a paused game) and the click's echo must
   *  hold - a frame countdown would snap back under pause. Any live change clears it: commands apply
   *  FIFO, so the first change after the write already contains it. */
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

  /** Queue a run centred in `rect` (native-px width scaled for screen px, cap height for the y). */
  const addRunCentred = (text: string, color: 'white' | 'dimmed', rect: Rect, px?: number): void => {
    const run = ctx.makeText(text, color, px);
    shell.container.addChild(run.container);
    shell.runs.push(run);
    runsAt.push({
      x: Math.round(rect.x + Math.max(0, (rect.w - run.width * scale) / 2)),
      y: Math.round(rect.y + (rect.h - TEXT_CAP_H * scale) / 2),
    });
  };

  /** The row's card plate inside its slot - inset vertically so consecutive cards read as separate. */
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

  /** The lemniscate as two stroked circles - drawn, not text: the decoded bitmap font has no '∞'. */
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

    // Window body: tiled wood, framed in gilt (flat warm fill when the bitmap is absent).
    if (!tileBitmap(back, ctx.bitmaps.bg, layout.window, scale)) {
      shell.graphics.rect(layout.window.x, layout.window.y, layout.window.w, layout.window.h).fill(WOOD_FILL);
    }
    drawWindowFrame(shell.graphics, layout.window, scale);

    // Headline band: tiled rust (flat fill fallback), inset so the frame reads around it.
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
    // Decoded title (`miscwindow` 500 "Okno Dodatków") with the catalog fallback.
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
      // The value sits in a recessed cell between the steppers.
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
      drawPlate(g.switchRect, g.on); // lit when ON, dull when OFF
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
    // The sim drains counters as the queues produce; mirror it without waiting for a reopen. A
    // rebuild only when a face actually changed - the frame's usual cost is the comparison.
    const live = deps.counters.read();
    if (echoBase === null || !countersEqual(live, echoBase)) {
      echoBase = null; // the sim moved: whatever we wrote is applied (or overtaken) - show live
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
        // The sim owns both blocks' state.
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
          // Ctrl (or Cmd) steps by ten - the coarse stepper the spec asks for.
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
            state = toggleGrant(state, hit.id); // local echo; the command applies next sim tick
            rebuild();
          }
          break;
        case 'window':
          break; // a click on the window body is consumed, nothing to do
        default: {
          const unreachable: never = hit; // exhaustive: a new hit kind fails to compile here
          return unreachable;
        }
      }
      return true;
    },
    place,
  };
}
