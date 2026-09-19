import type { HypertextBook } from '@open-northland/data';
import type { MapViewFrame } from '@open-northland/render';
import { Container, Graphics } from 'pixi.js';
import type { GuiArt } from '../../../content/gui-art.js';
import type { MissionBrief } from '../../../game/mission-brief.js';
import { messages } from '../../../i18n/index.js';
import { drawCloseX, drawHoverHighlight } from '../../chrome.js';
import { contains, insetRect, intersectRect, type Rect } from '../../geometry.js';
import type { PanelContext } from '../context.js';
import { addRun, centreRun, clearFills, paintPlate, type WindowLayers } from '../window-family/index.js';
import { createWindowShell, type ToolWindow } from '../window-shell.js';
import {
  type ContentSink,
  createContentSink,
  fillGoals,
  fillHistory,
  fillTask,
  pageOf,
  viewFrameWidth,
} from './content.js';
import { type SheetCreep, startCreep } from './creep.js';
import { type MissionWindowState, ShownPages } from './history.js';
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
import { paintHistoryButtons, paintScrollButtons, paintSheet, sheetFrame } from './paint.js';
import { createPictureCache, type PictureLoader } from './pictures.js';
import { type MissionHumanLookup, userIconBox } from './user-icons.js';

/** The decoded original strings (`miscwindow`) the window prefers over the catalog fallbacks. */
const STRING_TITLE = 60;
const STRING_TAB: Readonly<Record<MissionTab, number>> = { task: 61, goals: 62, history: 63 };
const STRING_GOALS_HEADING = 66;

export interface MissionWindowDeps {
  readonly ctx: PanelContext;
  readonly container: Container;
  /** The decoded GUI sheet; without it the window falls back to a flat parchment panel. */
  readonly art: GuiArt | null;
  /** What the task and goal tabs show for a briefing page (null for the map's fallback text), read
   *  as the window builds; null opens them empty. */
  readonly brief: (page: number | null) => MissionBrief | null;
  readonly briefingHistory?: () => readonly number[];
  /** The page the strip button opens on: the last replayable cutscene, or null before any. */
  readonly replayPage?: () => number | null;
  /** The history tab's book; null shows it empty. */
  readonly history: HypertextBook | null;
  readonly onOpenChange?: (open: boolean) => void;
  /** Page pictures; the default reads them off the content route. */
  readonly loadPicture?: PictureLoader;
  /** The human a page's picture of a mission id shows; without it those pictures draw nothing. */
  readonly missionHuman?: MissionHumanLookup;
  /** Monotonic ms clock the creep is timed against. */
  readonly now?: () => number;
}

/** The mission window: the briefing, the goal list, and the history book, one tab each. */
export interface MissionWindow extends ToolWindow {
  /** Open on briefing `page` (a `PlayCutscene`), which joins the pages the prev/next buttons walk. */
  showPage(page: number): void;
  /** The shown page and the pages shown so far, carried across a remount. */
  state(): MissionWindowState;
  restore(state: MissionWindowState): void;
  handleWheel(x: number, y: number, deltaY: number): boolean;
  /** Light the tab, arrow or link under the pointer. */
  handleHover(x: number, y: number): void;
  clearHover(): void;
  /** Per-frame hook: reflow when the canvas size changed. */
  refresh(): void;
  /** The world views the shown page's pictures paint this frame, clipped to the text viewport. */
  mapViews(): readonly MapViewFrame[];
}

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

const goalsKeyOf = (brief: MissionBrief | null): string =>
  brief === null ? '' : brief.goals.map((g) => `${g.state}:${g.text}`).join('\n');

const NO_VIEWS: readonly MapViewFrame[] = [];
const noHuman: MissionHumanLookup = () => null;

export function createMissionWindow(deps: MissionWindowDeps): MissionWindow {
  const pictures = createPictureCache(deps.loadPicture);
  const now = deps.now ?? (() => performance.now());
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
  const shown = new ShownPages();
  let layout: MissionWindowLayout | null = null;
  /** The shown tab's text viewport: the page fills the content element, the other tabs keep an inset. */
  let viewport: Rect | null = null;
  let sink: ContentSink | null = null;
  let views: { scroll: number; frames: readonly MapViewFrame[] } | null = null;
  /** The Up/Down pair shows on the text tabs, and on the goals tab only once the list overflows. */
  let buttonsShown = false;
  /** The prev/next briefing pair shows on the task tab once two pages have been shown. */
  let historyShown = false;
  /** What the goals tab was built from, so a changed mark rebuilds it and nothing else does. */
  let goalsKey = '';
  let scroll = 0;
  /** The opened sheet's own descent; null once the player takes the scroll. */
  let creep: SheetCreep | null = null;
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
    viewport = null;
    views = null;
  };

  const placeRuns = (): void => {
    if (viewport === null || sink === null) return;
    const { x, y, w } = viewport;
    for (const p of sink.placed) p.place(x + placedLeft(p, w), y + p.y - scroll);
  };

  const scrollTo = (next: number): void => {
    if (viewport === null || sink === null) return;
    const clamped = clampScroll(next, sink.height(), viewport.h);
    if (clamped === scroll) return;
    scroll = clamped;
    placeRuns();
  };

  /** A scroll the player asked for; the sheet stops creeping for as long as this view stays open. */
  const scrollBy = (delta: number): void => {
    creep = null;
    scrollTo(scroll + delta);
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

    const onTask = tab === 'task';
    const shownViewport = onTask ? built.pageViewport : built.viewport;
    viewport = shownViewport;
    const missionHuman = deps.missionHuman ?? noHuman;
    // Only the briefing hands its pictures a bitmap callback; the history book draws them as nothing.
    const filled = createContentSink(
      ctx,
      content,
      pictures,
      onTask ? (icon) => userIconBox(icon, missionHuman) : undefined,
    );
    const brief = tab === 'history' ? null : deps.brief(shown.page);
    goalsKey = goalsKeyOf(brief);
    switch (tab) {
      case 'task':
        fillTask(filled, brief, built.pageWrapWidth, copy.missionNoBriefing);
        break;
      case 'goals':
        fillGoals(
          filled,
          brief,
          ctx.uiString('miscwindow', STRING_GOALS_HEADING, copy.missionGoals),
          built.wrapWidth,
        );
        break;
      case 'history':
        fillHistory(filled, pageOf(deps.history, page), built.wrapWidth, copy.missionNoHistory);
        break;
    }
    sink = filled;
    scroll = clampScroll(scroll, filled.height(), shownViewport.h);
    mask.rect(shownViewport.x, shownViewport.y, shownViewport.w, shownViewport.h).fill(0xffffff);
    buttonsShown = tab !== 'goals' || filled.height() > shownViewport.h;
    if (buttonsShown) paintScrollButtons(layers, deps.art, built, screen);
    historyShown = tab === 'task' && shown.walkable;
    if (historyShown) paintHistoryButtons(layers, deps.art, built, screen);
    placeRuns();
  };

  /** Start on the task tab, on `next` when the caller has a page, reading fresh. */
  const openOn = (next: number | null): void => {
    shown.fold(deps.briefingHistory?.() ?? []);
    tab = 'task';
    page = deps.history?.start ?? '';
    scroll = 0;
    creep = startCreep(now());
    if (next !== null) shown.show(next);
    build();
  };

  /** From the strip the window opens on the map's replayable page (reading); a map whose pages all
   *  came without the replay flag reopens on the last one shown (approximation). */
  const setOpen = (open: boolean): void => {
    if (open === shell.isOpen()) return;
    shell.setOpen(open);
    if (open) openOn(deps.replayPage?.() ?? shown.page ?? deps.briefingHistory?.().at(-1) ?? null);
    else clear();
    deps.onOpenChange?.(open);
  };

  const showPage = (next: number): void => {
    if (!shell.isOpen()) {
      shell.setOpen(true);
      openOn(next);
      deps.onOpenChange?.(true);
      return;
    }
    openOn(next);
  };

  /** Step to the neighbouring shown page; the creep restarts as for a fresh page. */
  const stepHistory = (direction: -1 | 1): void => {
    const next = shown.neighbour(direction);
    if (next !== null) openOn(next);
  };

  const showTab = (next: MissionTab): void => {
    if (next === tab) return;
    tab = next;
    scroll = 0;
    creep = null;
    build();
  };

  /** A link opens its page in the book, from whichever tab carried the link. */
  const openPage = (next: string): void => {
    if (pageOf(deps.history, next) === undefined) return;
    page = next;
    tab = 'history';
    scroll = 0;
    creep = null;
    build();
  };

  /** The linked run under a viewport point. */
  const linkUnder = (x: number, y: number) =>
    viewport !== null && sink !== null ? linkedRunAt(sink.placed, viewport.w, x, y + scroll) : null;

  /** The control under the pointer to light: a tab, a shown arrow, or a link's visible box. */
  const hoverRectAt = (x: number, y: number): Rect | null => {
    if (layout === null || viewport === null) return null;
    const hit = hitTestMissionWindow(layout, x, y, viewport);
    if (hit === null) return null;
    switch (hit.kind) {
      case 'tab':
        return layout.tabs.find((t) => t.tab === hit.tab)?.rect ?? null;
      case 'scroll':
        return buttonsShown ? (hit.direction < 0 ? layout.scrollUp : layout.scrollDown) : null;
      case 'history':
        return historyShown ? (hit.direction < 0 ? layout.historyPrev : layout.historyNext) : null;
      case 'text': {
        const run = linkUnder(hit.x, hit.y);
        if (run === null) return null;
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
    showPage,
    state: () => shown.state(),
    restore: (state) => shown.restore(state),
    claims: (x, y) => shell.claims(layout?.sheet ?? null, x, y),
    handleClick(x, y): boolean {
      if (!shell.isOpen() || layout === null || viewport === null) return false;
      const hit = hitTestMissionWindow(layout, x, y, viewport);
      if (hit === null) return false;
      // The close box, a tab, a painted arrow or a link is a button; the sheet and plain text are not.
      if (hit.kind === 'close' || hoverRectAt(x, y) !== null) deps.ctx.cue('confirm');
      switch (hit.kind) {
        case 'close':
          setOpen(false);
          break;
        case 'tab':
          showTab(hit.tab);
          break;
        case 'scroll':
          if (buttonsShown) scrollBy(hit.direction * BUTTON_SCROLL_STEP * layout.scale);
          break;
        case 'history':
          if (historyShown) stepHistory(hit.direction);
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
      // A sideways swipe reaches here as a wheel with no vertical delta: it must not count as the
      // player taking the scroll.
      if (deltaY !== 0) scrollBy(Math.sign(deltaY) * WHEEL_STEP * layout.scale);
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
      // A mark on the goal list follows the sim; the sheet's text never moves under the reader.
      else if (tab === 'goals' && goalsKeyOf(deps.brief(shown.page)) !== goalsKey) build();
      if (creep !== null && layout !== null) scrollTo(creep.advance(now(), layout.scale));
    },
    mapViews(): readonly MapViewFrame[] {
      if (!shell.isOpen() || layout === null || viewport === null || sink === null) return NO_VIEWS;
      if (sink.views.length === 0) return NO_VIEWS;
      if (views?.scroll === scroll) return views.frames;
      const { scale } = layout;
      const frameW = viewFrameWidth(scale);
      const frames: MapViewFrame[] = [];
      for (const v of sink.views) {
        if (v.icon.target === null) continue;
        const box = { x: viewport.x + v.x, y: viewport.y + v.y - scroll, w: v.w, h: v.h };
        const clip = intersectRect(insetRect(box, frameW), viewport);
        if (clip === null) continue;
        frames.push({
          box,
          clip,
          target: v.icon.target,
          focusX: v.icon.focusX * scale,
          focusY: v.icon.focusY * scale,
          scale,
          ...(v.icon.soloFill !== undefined ? { soloFill: v.icon.soloFill } : {}),
        });
      }
      views = { scroll, frames };
      return frames;
    },
  };
}
