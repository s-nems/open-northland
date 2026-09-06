import type { HypertextBook } from '@open-northland/data';
import { Container, Graphics } from 'pixi.js';
import type { GuiArt } from '../../../content/gui-art.js';
import type { MissionBrief } from '../../../game/mission-brief.js';
import { messages } from '../../../i18n/index.js';
import { drawCloseX, drawHoverHighlight } from '../../chrome.js';
import { contains, type Rect } from '../../geometry.js';
import type { PanelContext } from '../context.js';
import { addRun, centreRun, clearFills, paintPlate, type WindowLayers } from '../window-family/index.js';
import { createWindowShell, type ToolWindow } from '../window-shell.js';
import { type ContentSink, createContentSink, fillGoals, fillHistory, fillTask, pageOf } from './content.js';
import {
  BUTTON_SCROLL_STEP,
  clampScroll,
  hitTestMissionWindow,
  layoutMissionWindow,
  linkedRunAt,
  MISSION_TAB_PX,
  MISSION_TITLE_PX,
  type MissionTab,
  type MissionWindowLayout,
  placedLeft,
  WHEEL_STEP,
} from './model.js';
import { paintScrollButtons, paintSheet, sheetFrame } from './paint.js';
import { createPictureCache, type PictureLoader } from './pictures.js';

/** The decoded original strings (`miscwindow`) the window prefers over the catalog fallbacks. */
const STRING_TITLE = 60;
const STRING_TAB: Readonly<Record<MissionTab, number>> = { task: 61, goals: 62, history: 63 };
const STRING_GOALS_HEADING = 66;

export interface MissionWindowDeps {
  readonly ctx: PanelContext;
  readonly container: Container;
  /** The decoded GUI sheet; without it the window falls back to a flat parchment panel. */
  readonly art: GuiArt | null;
  /** What the task and goal tabs show, read as the window opens; null opens them empty. */
  readonly brief: () => MissionBrief | null;
  /** The history tab's book; null shows it empty. */
  readonly history: HypertextBook | null;
  /** The original stops game time behind this large window; the host holds the pause. */
  readonly onOpenChange?: (open: boolean) => void;
  /** Page pictures; the default reads them off the content route. */
  readonly loadPicture?: PictureLoader;
}

/** The mission window: the briefing, the goal list, and the history book, one tab each. */
export interface MissionWindow extends ToolWindow {
  handleWheel(x: number, y: number, deltaY: number): boolean;
  /** Light the tab, arrow or link under the pointer. */
  handleHover(x: number, y: number): void;
  clearHover(): void;
  /** Per-frame hook: reflow when the canvas size changed. */
  refresh(): void;
}

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

export function createMissionWindow(deps: MissionWindowDeps): MissionWindow {
  const pictures = createPictureCache(deps.loadPicture);
  const shell = createWindowShell(deps.container);
  const back = new Container();
  shell.container.addChildAt(back, 0);
  const content = new Container();
  const mask = new Graphics();
  content.mask = mask;
  const hover = new Graphics();
  shell.container.addChild(content, mask, hover);
  const sheet = sheetFrame(deps.art);

  let tab: MissionTab = 'task';
  let page = '';
  let layout: MissionWindowLayout | null = null;
  let sink: ContentSink | null = null;
  /** The Up/Down pair shows on the text tabs, and on the goals tab only once the list overflows. */
  let buttonsShown = false;
  let scroll = 0;
  let hovered: Rect | null = null;
  let screenKey = '';

  const clearHover = (): void => {
    if (hovered === null) return;
    hovered = null;
    hover.clear();
  };

  const clear = (): void => {
    shell.clear();
    for (const p of sink?.placed ?? []) p.destroy();
    sink = null;
    clearFills(back);
    mask.clear();
    clearHover();
    layout = null;
  };

  const placeRuns = (): void => {
    if (layout === null || sink === null) return;
    const { viewport } = layout;
    for (const p of sink.placed) p.place(viewport.x + placedLeft(p, viewport.w), viewport.y + p.y - scroll);
  };

  const scrollTo = (next: number): void => {
    if (layout === null || sink === null) return;
    const clamped = clampScroll(next, sink.height(), layout.viewport.h);
    if (clamped === scroll) return;
    scroll = clamped;
    placeRuns();
  };

  const build = (): void => {
    clear();
    const screen = deps.ctx.screen();
    screenKey = `${screen.width}x${screen.height}`;
    const built = layoutMissionWindow(screen, sheet);
    layout = built;
    const ctx = deps.ctx.atScale(built.scale);
    const layers: WindowLayers = {
      ctx,
      container: shell.container,
      back,
      graphics: shell.graphics,
      runs: shell.runs,
    };
    const copy = messages().hud;

    paintSheet(layers, deps.art, built, screen);
    centreRun(
      layers,
      addRun(layers, ctx.uiString('miscwindow', STRING_TITLE, copy.missionTitle), 'dark', MISSION_TITLE_PX),
      built.titleRect,
    );
    drawCloseX(shell.graphics, built.closeRect, built.scale);
    const tabLabels: Readonly<Record<MissionTab, string>> = {
      task: copy.missionTabTask,
      goals: copy.missionTabGoals,
      history: copy.missionTabHistory,
    };
    for (const t of built.tabs) {
      const selected = t.tab === tab;
      paintPlate(layers, t.rect, selected);
      const label = ctx.uiString('miscwindow', STRING_TAB[t.tab], tabLabels[t.tab]);
      centreRun(layers, addRun(layers, label, selected ? 'white' : 'dimmed', MISSION_TAB_PX), t.rect);
    }

    const filled = createContentSink(ctx, content, pictures);
    switch (tab) {
      case 'task':
        fillTask(filled, deps.brief(), built.wrapWidth, copy.missionNoBriefing);
        break;
      case 'goals':
        fillGoals(filled, deps.brief(), ctx.uiString('miscwindow', STRING_GOALS_HEADING, copy.missionGoals));
        break;
      case 'history':
        fillHistory(filled, pageOf(deps.history, page), built.wrapWidth, copy.missionNoHistory);
        break;
    }
    sink = filled;
    scroll = clampScroll(scroll, filled.height(), built.viewport.h);
    mask.rect(built.viewport.x, built.viewport.y, built.viewport.w, built.viewport.h).fill(0xffffff);
    buttonsShown = tab !== 'goals' || filled.height() > built.viewport.h;
    if (buttonsShown) paintScrollButtons(layers, deps.art, built, screen);
    placeRuns();
  };

  const setOpen = (open: boolean): void => {
    if (open === shell.isOpen()) return;
    shell.setOpen(open);
    if (open) {
      tab = 'task';
      page = deps.history?.start ?? '';
      scroll = 0;
      build();
    } else {
      clear();
    }
    deps.onOpenChange?.(open);
  };

  const showTab = (next: MissionTab): void => {
    if (next === tab) return;
    tab = next;
    scroll = 0;
    build();
  };

  const openPage = (next: string): void => {
    if (pageOf(deps.history, next) === undefined) return;
    page = next;
    scroll = 0;
    build();
  };

  /** The linked run under a viewport point, on the history tab. */
  const linkUnder = (x: number, y: number) =>
    tab === 'history' && layout !== null && sink !== null
      ? linkedRunAt(sink.placed, layout.viewport.w, x, y + scroll)
      : null;

  /** The control under the pointer to light: a tab, a shown arrow, or a link's visible box. */
  const hoverRectAt = (x: number, y: number): Rect | null => {
    if (layout === null) return null;
    const hit = hitTestMissionWindow(layout, x, y);
    if (hit === null) return null;
    switch (hit.kind) {
      case 'tab':
        return layout.tabs.find((t) => t.tab === hit.tab)?.rect ?? null;
      case 'scroll':
        return buttonsShown ? (hit.direction < 0 ? layout.scrollUp : layout.scrollDown) : null;
      case 'text': {
        const run = linkUnder(hit.x, hit.y);
        if (run === null) return null;
        const { viewport } = layout;
        const top = Math.max(viewport.y, viewport.y + run.y - scroll);
        const bottom = Math.min(viewport.y + viewport.h, viewport.y + run.y - scroll + run.h);
        return {
          x: viewport.x + placedLeft(run, viewport.w),
          y: top,
          w: run.width,
          h: Math.max(0, bottom - top),
        };
      }
      default:
        return null;
    }
  };

  return {
    isOpen: () => shell.isOpen(),
    toggle: () => setOpen(!shell.isOpen()),
    close: () => setOpen(false),
    claims: (x, y) => shell.claims(layout?.sheet ?? null, x, y),
    handleClick(x, y): boolean {
      if (!shell.isOpen() || layout === null) return false;
      const hit = hitTestMissionWindow(layout, x, y);
      if (hit === null) return false;
      switch (hit.kind) {
        case 'close':
          setOpen(false);
          break;
        case 'tab':
          showTab(hit.tab);
          break;
        case 'scroll':
          if (buttonsShown) scrollTo(scroll + hit.direction * BUTTON_SCROLL_STEP * layout.scale);
          break;
        case 'text': {
          const link = linkUnder(hit.x, hit.y)?.link ?? null;
          if (link !== null) openPage(link);
          break;
        }
        case 'window':
          break;
      }
      return true;
    },
    handleWheel(x, y, deltaY): boolean {
      if (!shell.isOpen() || layout === null || !contains(layout.sheet, x, y)) return false;
      scrollTo(scroll + Math.sign(deltaY) * WHEEL_STEP * layout.scale);
      return true;
    },
    handleHover(x, y): void {
      if (!shell.isOpen()) return;
      const next = hoverRectAt(x, y);
      if (sameRect(next, hovered)) return;
      hovered = next;
      hover.clear();
      if (next !== null) drawHoverHighlight(hover, next);
    },
    clearHover,
    refresh(): void {
      if (!shell.isOpen()) return;
      const screen = deps.ctx.screen();
      if (`${screen.width}x${screen.height}` !== screenKey) build();
    },
  };
}
