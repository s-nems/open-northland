import type { HudLayout } from '@open-northland/render';
import { type Container, Graphics } from 'pixi.js';
import { messages } from '../../i18n/index.js';
import type { TextRun } from '../bitmap-text.js';
import { drawWindowPanel, WIN_LINE_H, WIN_PAD, WIN_TITLE_H } from '../chrome.js';
import { contains, type Rect } from '../geometry.js';
import type { PanelContext } from './context.js';

/** Stats window width (design px) — sized to the read-view's longest tally rows. */
const STATS_WIDTH = 150;
/** Horizontal gap between the strip and the window (design px): past the menu column + breathing room. */
const STATS_GAP_X = WIN_PAD + STATS_WIDTH + 3 * WIN_PAD;
/** Vertical drop below the strip top (design px). */
const STATS_OFFSET_Y = 15;
/** Title text inset (design px). */
const TITLE_INSET_Y = 2;
/** The index of `layoutHud`'s volatile `Tribe N · tick T` row — excluded from the change key. */
const TICK_ROW = 0;

export interface StatsWindowDeps {
  readonly ctx: PanelContext;
  /** The panel's window container the stats parents its graphics + text under. */
  readonly container: Container;
}

/** The pop-up statistics window: toggled by the strip button, refreshed each frame from the HUD read-view. */
export interface StatsWindow {
  isOpen(): boolean;
  toggle(): void;
  close(): void;
  /** True when the point is over the open window (the HUD claims it before world picking). */
  claims(x: number, y: number): boolean;
  /** A click strictly inside the open window closes it (v1 has no window chrome controls). */
  handleClick(x: number, y: number): boolean;
  /** Per-frame while open: rebuild only when a tally row actually changed (see the change key). */
  refresh(hud: HudLayout): void;
}

/**
 * Build the statistics-window controller. The per-frame `refresh` is allocation-light: it derives a
 * change key in one pass over the HUD rows and returns early when nothing but the tick moved — the
 * glyph meshes rebuild only on a real tally change.
 */
export function createStatsWindow(deps: StatsWindowDeps): StatsWindow {
  const { ctx } = deps;
  const { scale } = ctx;

  let open = false;
  let key = '';
  /** The window's actual drawn rect — the single source of truth for its hit region + close-on-inside. */
  let rect: Rect | null = null;
  const runs: TextRun[] = [];
  const graphics = new Graphics();
  deps.container.addChild(graphics);

  const origin = (): { x: number; y: number } => ({
    x: ctx.layout.width + STATS_GAP_X * scale,
    y: ctx.layout.strip.y + STATS_OFFSET_Y * scale,
  });

  const clear = (): void => {
    for (const r of runs) r.destroy();
    runs.length = 0;
    graphics.clear();
    rect = null;
  };

  const place = (): void => {
    const { x: ox, y: oy } = origin();
    const { width: rw, height: rh } = ctx.screen();
    const pad = WIN_PAD * scale;
    let i = 0;
    runs[i++]?.place(ox + pad, oy + TITLE_INSET_Y * scale, scale, rw, rh);
    for (let r = 0; r < runs.length - 1; r++) {
      runs[i++]?.place(ox + pad, oy + (WIN_TITLE_H + r * WIN_LINE_H) * scale, scale, rw, rh);
    }
  };

  const rebuild = (rows: readonly string[]): void => {
    clear();
    const { x: ox, y: oy } = origin();
    const w = STATS_WIDTH * scale;
    const h = (WIN_TITLE_H + rows.length * WIN_LINE_H + WIN_PAD) * scale;
    rect = { x: ox, y: oy, w, h };
    drawWindowPanel(graphics, rect, scale);
    const title = ctx.makeText(ctx.uiString('miscwindow', 180, messages().hud.statistics), 'white');
    deps.container.addChild(title.container);
    runs.push(title);
    for (const text of rows) {
      const run = ctx.makeText(text, 'white');
      deps.container.addChild(run.container);
      runs.push(run);
    }
    place();
  };

  const close = (): void => {
    open = false;
    key = '';
    clear();
  };

  return {
    isOpen: () => open,
    toggle: () => {
      if (open) close();
      else open = true; // built on the next refresh (the frame's HUD read-view supplies the rows)
    },
    close,
    claims: (x, y) => open && rect !== null && contains(rect, x, y),
    handleClick: (x, y): boolean => {
      if (!open || rect === null || !contains(rect, x, y)) return false;
      close();
      return true;
    },
    refresh: (hud): void => {
      if (!open) return;
      // Change-detection key excludes the volatile tick line (`layoutHud` row 0 is `Tribe N · tick T`): the
      // tick advances every frame, so keying on it would defeat the guard and rebuild the ~hundreds of glyph
      // meshes each frame. Keyed by row index (0 is the tick row), not a substring match, so a future tally
      // row containing "tick" can't silently drop out of change detection. One string-building pass, no
      // intermediate arrays (this runs every frame).
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
