import type { Container } from 'pixi.js';
import { messages } from '../../i18n/index.js';
import { drawCloseX, drawTabButton, drawWindowPanel, WIN_PAD } from '../chrome.js';
import type { Rect } from '../geometry.js';
import type { PanelContext } from './context.js';
import {
  type AssistantState,
  adjustCounter,
  defaultAssistantState,
  type ExtrasMenuLayout,
  type ExtrasTab,
  hitTestExtrasMenu,
  layoutExtrasMenu,
  toggleGrant,
} from './extras-menu.js';
import { createWindowShell } from './window-shell.js';

/** Text insets (design px) — where a run sits inside its rect. Match the goods window's nudges. */
const TAB_INSET_X = 3;
const TAB_INSET_Y = 2;
const LABEL_INSET_Y = 1;
/** The −/+ glyph strokes (the same pale tone as the close X). */
const GLYPH_COLOR = 0xd8ccb0;
const GLYPH_INSET = 3;

export interface ExtrasWindowDeps {
  readonly ctx: PanelContext;
  /** The panel's window container the window parents its graphics + text under. */
  readonly container: Container;
}

/** The pop-up extras ("chest") window: the assistant/plans tabs and the assistant's controls. */
export interface ExtrasWindow {
  isOpen(): boolean;
  toggle(): void;
  close(): void;
  /** True when the point is over the open window (the HUD claims it before world picking). */
  claims(x: number, y: number): boolean;
  /** Route a canvas-space click; returns true when the window consumed it. */
  handleClick(x: number, y: number): boolean;
  /** Per-frame while open: re-place the text runs against the live canvas size. */
  place(): void;
}

/**
 * Build the extras-window controller over the pure {@link layoutExtrasMenu} geometry, on the shared
 * {@link createWindowShell} lifecycle — rebuilt on open and on any control click (every click moves a
 * visible value, and the window is a dozen runs). The assistant state survives close/reopen: it is the
 * player's session settings, not a per-open scratch value.
 */
export function createExtrasWindow(deps: ExtrasWindowDeps): ExtrasWindow {
  const { ctx } = deps;
  const { scale } = ctx;
  const shell = createWindowShell(deps.container);
  // Right of the strip, dropping from the extras (chest) button — same reasoning as the building
  // menu's origin: it clears the top-left debug overlay and anchors the window to its button.
  const origin = {
    x: ctx.layout.width + WIN_PAD * scale,
    y: ctx.layout.buttons.find((b) => b.id === 'extras')?.placed.y ?? ctx.layout.strip.y,
  };

  let tab: ExtrasTab = 'assistant';
  let state: AssistantState = defaultAssistantState();
  let menuLayout: ExtrasMenuLayout | null = null;
  /** Screen position per run, same order as `shell.runs` — `place()` replays them. */
  let runsAt: { x: number; y: number }[] = [];

  const addRun = (text: string, color: 'white' | 'dimmed', x: number, y: number): void => {
    const run = ctx.makeText(text, color);
    deps.container.addChild(run.container);
    shell.runs.push(run);
    runsAt.push({ x, y });
  };

  const drawStepper = (r: Rect, glyph: 'minus' | 'plus'): void => {
    drawTabButton(shell.graphics, r, scale, false);
    const inset = Math.max(2, GLYPH_INSET * scale);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    shell.graphics.moveTo(r.x + inset, cy).lineTo(r.x + r.w - inset, cy);
    if (glyph === 'plus') shell.graphics.moveTo(cx, r.y + inset).lineTo(cx, r.y + r.h - inset);
    shell.graphics.stroke({ color: GLYPH_COLOR, width: Math.max(1, scale) });
  };

  const rebuild = (): void => {
    shell.clear();
    runsAt = [];
    menuLayout = layoutExtrasMenu({ originX: origin.x, originY: origin.y, scale, tab, state });
    drawWindowPanel(shell.graphics, menuLayout.window, scale);
    drawCloseX(shell.graphics, menuLayout.closeRect, scale);

    for (const t of menuLayout.tabs) {
      drawTabButton(shell.graphics, t.rect, scale, t.selected);
      addRun(
        t.label,
        t.selected ? 'white' : 'dimmed',
        t.rect.x + TAB_INSET_X * scale,
        t.rect.y + TAB_INSET_Y * scale,
      );
    }
    for (const c of menuLayout.counters) {
      addRun(c.label, 'white', c.labelPos.x, c.labelPos.y + LABEL_INSET_Y * scale);
      drawStepper(c.minusRect, 'minus');
      drawStepper(c.plusRect, 'plus');
      const value = ctx.makeText(String(c.value), 'white');
      deps.container.addChild(value.container);
      shell.runs.push(value);
      // Centre the value in its cell (TextRun.width is native font px — scale it for screen px).
      runsAt.push({
        x: c.valueRect.x + (c.valueRect.w - value.width * scale) / 2,
        y: c.valueRect.y,
      });
    }
    for (const g of menuLayout.grants) {
      addRun(g.label, 'white', g.labelPos.x, g.labelPos.y + LABEL_INSET_Y * scale);
      drawTabButton(shell.graphics, g.switchRect, scale, g.on);
      const face = ctx.makeText(
        g.on ? messages().hud.extras.on : messages().hud.extras.off,
        g.on ? 'white' : 'dimmed',
      );
      deps.container.addChild(face.container);
      shell.runs.push(face);
      runsAt.push({
        x: g.switchRect.x + (g.switchRect.w - face.width * scale) / 2,
        y: g.switchRect.y,
      });
    }
    if (menuLayout.plansPlaceholder !== null) {
      const p = menuLayout.plansPlaceholder;
      addRun(p.label, 'dimmed', p.x, p.y + LABEL_INSET_Y * scale);
    }
    place();
  };

  const place = (): void => {
    if (menuLayout === null) return;
    const { width: rw, height: rh } = ctx.screen();
    for (let i = 0; i < shell.runs.length; i++) {
      const at = runsAt[i];
      if (at !== undefined) shell.runs[i]?.place(at.x, at.y, scale, rw, rh);
    }
  };

  const close = (): void => {
    shell.setOpen(false);
    shell.clear();
    menuLayout = null;
    runsAt = [];
  };

  return {
    isOpen: shell.isOpen,
    toggle: () => {
      if (shell.isOpen()) close();
      else {
        shell.setOpen(true);
        rebuild();
      }
    },
    close,
    claims: (x, y) => shell.claims(menuLayout?.window ?? null, x, y),
    handleClick: (x, y): boolean => {
      if (!shell.isOpen() || menuLayout === null) return false;
      const hit = hitTestExtrasMenu(menuLayout, x, y);
      if (hit === null) return false;
      if (hit.kind === 'close') close();
      else if (hit.kind === 'tab') {
        tab = hit.tab;
        rebuild();
      } else if (hit.kind === 'counter') {
        state = adjustCounter(state, hit.id, hit.delta);
        rebuild();
      } else if (hit.kind === 'grant') {
        state = toggleGrant(state, hit.id);
        rebuild();
      }
      // 'window' → consumed, no-op
      return true;
    },
    place,
  };
}
