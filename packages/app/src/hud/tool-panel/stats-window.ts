import type { HudLayout } from '@open-northland/render';
import type { Container } from 'pixi.js';
import { messages } from '../../i18n/index.js';
import { drawWindowPanel, WIN_LINE_H, WIN_PAD, WIN_TITLE_H } from '../chrome.js';
import type { Rect } from '../geometry.js';
import type { PanelContext } from './context.js';
import { createWindowShell, type ToolWindow } from './window-shell.js';

/** Stats window width (design px). */
const STATS_WIDTH = 150;
/** Horizontal gap between the strip and the window (design px). */
const STATS_GAP_X = WIN_PAD + STATS_WIDTH + 3 * WIN_PAD;
/** Vertical drop below the strip top (design px). */
const STATS_OFFSET_Y = 15;
/** Title text inset (design px). */
const TITLE_INSET_Y = 2;
/** Index of `layoutHud`'s volatile tick row, excluded from the change key. */
const TICK_ROW = 0;

export interface StatsWindowDeps {
  readonly ctx: PanelContext;
  readonly container: Container;
}

/** The pop-up statistics window; a click anywhere inside it closes it. */
export interface StatsWindow extends ToolWindow {
  /** `hudFor` is pulled only while the window is open, because building it is an O(entities) scan. */
  refresh(hudFor: () => HudLayout): void;
}

export function createStatsWindow(deps: StatsWindowDeps): StatsWindow {
  const { ctx } = deps;
  const { scale } = ctx;
  const shell = createWindowShell(deps.container);

  let key = '';
  let rect: Rect | null = null;

  const origin = (): { x: number; y: number } => ({
    x: ctx.layout.width + STATS_GAP_X * scale,
    y: ctx.layout.strip.y + STATS_OFFSET_Y * scale,
  });

  const place = (): void => {
    const { x: ox, y: oy } = origin();
    const { width: rw, height: rh } = ctx.screen();
    const pad = WIN_PAD * scale;
    const runs = shell.runs;
    let i = 0;
    runs[i++]?.place(ox + pad, oy + TITLE_INSET_Y * scale, scale, rw, rh);
    for (let r = 0; r < runs.length - 1; r++) {
      runs[i++]?.place(ox + pad, oy + (WIN_TITLE_H + r * WIN_LINE_H) * scale, scale, rw, rh);
    }
  };

  const rebuild = (rows: readonly string[]): void => {
    shell.clear();
    const { x: ox, y: oy } = origin();
    const w = STATS_WIDTH * scale;
    const h = (WIN_TITLE_H + rows.length * WIN_LINE_H + WIN_PAD) * scale;
    rect = { x: ox, y: oy, w, h };
    drawWindowPanel(shell.graphics, rect, scale);
    const title = ctx.makeText(ctx.uiString('miscwindow', 180, messages().hud.statistics), 'white');
    shell.container.addChild(title.container);
    shell.runs.push(title);
    for (const text of rows) {
      const run = ctx.makeText(text, 'white');
      shell.container.addChild(run.container);
      shell.runs.push(run);
    }
    place();
  };

  const close = (): void => {
    shell.setOpen(false);
    shell.clear();
    rect = null;
    key = '';
  };

  return {
    isOpen: shell.isOpen,
    toggle: () => {
      if (shell.isOpen()) close();
      else shell.setOpen(true); // built on the next refresh, which supplies the rows
    },
    close,
    claims: (x, y) => shell.claims(rect, x, y),
    handleClick: (x, y): boolean => {
      if (!shell.claims(rect, x, y)) return false;
      close();
      return true;
    },
    refresh: (hudFor): void => {
      if (!shell.isOpen()) return;
      const hud = hudFor();
      // The key skips the tick row by index: the tick advances every frame, so keying on it would rebuild
      // every glyph mesh each frame.
      let next = '';
      for (let i = TICK_ROW + 1; i < hud.rows.length; i++) {
        next += `${hud.rows[i]?.text}|`;
      }
      if (next === key) return;
      key = next;
      rebuild(hud.rows.map((r) => r.text));
    },
  };
}
