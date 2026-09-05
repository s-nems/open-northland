import { Container, Graphics } from 'pixi.js';
import { type GuiArt, makeGuiSprite } from '../../../content/gui-art.js';
import type { MissionBrief } from '../../../game/mission-brief.js';
import { messages } from '../../../i18n/index.js';
import { drawCloseX, drawScrollbar, drawWindowPanel } from '../../chrome.js';
import { contains } from '../../geometry.js';
import type { ParagraphRun } from '../../text-run.js';
import type { PanelContext } from '../context.js';
import {
  addRun,
  centreRun,
  clearFills,
  paintPlate,
  ROW_PX,
  type WindowLayers,
} from '../window-family/index.js';
import { createWindowShell, type ToolWindow } from '../window-shell.js';
import {
  clampScroll,
  hitTestMissionWindow,
  layoutMissionWindow,
  MISSION_BODY_PX,
  MISSION_HEADING_PX,
  MISSION_TITLE_PX,
  type MissionWindowLayout,
  PARAGRAPH_GAP,
  SECTION_GAP,
  scrollThumb,
  TITLE_GAP,
  WHEEL_STEP,
} from './model.js';

/** The large papyrus sheet in `ls_gui_window` (`content/gui-atlas-map.ts` frame 25). */
const MISSION_SHEET_GFX = 0x19;
/** The decoded original strings the window prefers over the catalog fallbacks (`miscwindow`). */
const GOALS_STRING_ID = 66;
const GOAL_BULLET = '•';

export interface MissionWindowDeps {
  readonly ctx: PanelContext;
  readonly container: Container;
  /** The decoded GUI sheet; without it the window falls back to the flat parchment panel. */
  readonly art: GuiArt | null;
  /** What to show, read as the window opens; null opens an empty sheet. */
  readonly brief: () => MissionBrief | null;
  /** The original stops game time behind this large window; the host holds the pause. */
  readonly onOpenChange?: (open: boolean) => void;
}

/** The mission window: the map's briefing over its goal list, scrolling when it overflows the sheet. */
export interface MissionWindow extends ToolWindow {
  handleWheel(x: number, y: number, deltaY: number): boolean;
  /** Per-frame hook: reflow when the canvas size changed. */
  refresh(): void;
}

interface PlacedParagraph {
  readonly run: ParagraphRun;
  /** Top edge in screen px, relative to the unscrolled content top. */
  readonly y: number;
  readonly centred: boolean;
}

export function createMissionWindow(deps: MissionWindowDeps): MissionWindow {
  const { ctx } = deps;
  const shell = createWindowShell(deps.container);
  const back = new Container();
  shell.container.addChildAt(back, 0);
  const content = new Container();
  const mask = new Graphics();
  const scrollGraphics = new Graphics();
  content.mask = mask;
  shell.container.addChild(content, mask, scrollGraphics);
  const layers: WindowLayers = {
    ctx,
    container: shell.container,
    back,
    graphics: shell.graphics,
    runs: shell.runs,
  };

  let layout: MissionWindowLayout | null = null;
  let paragraphs: PlacedParagraph[] = [];
  let contentHeight = 0;
  let scroll = 0;
  let screenKey = '';

  const clear = (): void => {
    shell.clear();
    for (const p of paragraphs) p.run.destroy();
    paragraphs = [];
    clearFills(back);
    mask.clear();
    scrollGraphics.clear();
    layout = null;
  };

  const placeRuns = (): void => {
    if (layout === null) return;
    const { viewport, scale } = layout;
    for (const { run, y, centred } of paragraphs) {
      const x = centred ? viewport.x + (viewport.w - run.width * scale) / 2 : viewport.x;
      run.place(x, viewport.y + y - scroll);
    }
  };

  const paintScroll = (): void => {
    if (layout === null) return;
    scrollGraphics.clear();
    const thumb = scrollThumb(layout.scrollbar, scroll, contentHeight, layout.viewport.h, layout.scale);
    if (thumb !== null) drawScrollbar(scrollGraphics, layout.scrollbar, thumb, layout.scale);
  };

  const build = (): void => {
    clear();
    const screen = ctx.screen();
    screenKey = `${screen.width}x${screen.height}`;
    const built = layoutMissionWindow({ scale: ctx.scale, screen, stripWidth: ctx.layout.width });
    layout = built;
    const { scale } = built;

    const sheet =
      deps.art === null
        ? null
        : makeGuiSprite(deps.art, MISSION_SHEET_GFX, { defaultPalette: 'papyrus', colorKey: 'full' });
    if (sheet !== null) {
      const { x, y, w, h } = built.window;
      sheet.sprite.stretchToRect(x, y, w, h, screen.width, screen.height);
      back.addChild(sheet.sprite);
    } else {
      drawWindowPanel(shell.graphics, built.window, scale);
    }
    drawCloseX(shell.graphics, built.closeRect, scale);

    const copy = messages().hud;
    let y = 0;
    const push = (text: string, px: number, gapAfter: number, centred = false): void => {
      const run = ctx.makeParagraph(text, 'dark', px, built.wrapWidth, centred ? 'center' : 'left');
      content.addChild(run.container);
      paragraphs.push({ run, y, centred });
      y += Math.round(run.height * scale) + Math.round(gapAfter * scale);
    };
    const brief = deps.brief();
    if (brief !== null) {
      if (brief.title !== '') push(brief.title, MISSION_TITLE_PX, TITLE_GAP, true);
      for (const p of brief.paragraphs) {
        push(p.text, p.style === 'title' ? MISSION_HEADING_PX : MISSION_BODY_PX, PARAGRAPH_GAP);
      }
      if (brief.goals.length > 0) {
        y += Math.round(SECTION_GAP * scale);
        push(
          ctx.uiString('miscwindow', GOALS_STRING_ID, copy.missionGoals),
          MISSION_HEADING_PX,
          PARAGRAPH_GAP,
        );
        for (const goal of brief.goals) push(`${GOAL_BULLET} ${goal}`, MISSION_BODY_PX, PARAGRAPH_GAP);
      }
    }
    contentHeight = y;
    scroll = clampScroll(scroll, contentHeight, built.viewport.h);
    mask.rect(built.viewport.x, built.viewport.y, built.viewport.w, built.viewport.h).fill(0xffffff);

    paintPlate(layers, built.okRect, false);
    centreRun(layers, addRun(layers, copy.missionOk, 'white', ROW_PX), built.okRect);
    placeRuns();
    paintScroll();
  };

  const setOpen = (open: boolean): void => {
    if (open === shell.isOpen()) return;
    shell.setOpen(open);
    if (open) {
      scroll = 0;
      build();
    } else {
      clear();
    }
    deps.onOpenChange?.(open);
  };

  return {
    isOpen: () => shell.isOpen(),
    toggle: () => setOpen(!shell.isOpen()),
    close: () => setOpen(false),
    claims: (x, y) => shell.claims(layout?.window ?? null, x, y),
    handleClick(x, y): boolean {
      if (!shell.isOpen() || layout === null) return false;
      const hit = hitTestMissionWindow(layout, x, y);
      if (hit === null) return false;
      if (hit.kind === 'close') setOpen(false);
      return true;
    },
    handleWheel(x, y, deltaY): boolean {
      if (!shell.isOpen() || layout === null || !contains(layout.window, x, y)) return false;
      const next = clampScroll(
        scroll + Math.sign(deltaY) * WHEEL_STEP * layout.scale,
        contentHeight,
        layout.viewport.h,
      );
      if (next === scroll) return true;
      scroll = next;
      placeRuns();
      paintScroll();
      return true;
    },
    refresh(): void {
      if (!shell.isOpen()) return;
      const screen = ctx.screen();
      if (`${screen.width}x${screen.height}` !== screenKey) build();
    },
  };
}
