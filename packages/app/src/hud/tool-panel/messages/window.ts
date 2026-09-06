import type { Container } from 'pixi.js';
import { Container as PixiContainer } from 'pixi.js';
import { messages } from '../../../i18n/index.js';
import { contains, type Rect } from '../../geometry.js';
import type { PanelContext } from '../context.js';
import {
  addRun,
  CLOSE_BOX,
  centreRun,
  clearFills,
  HEADLINE_H,
  paintPlate,
  paintTitledTabWindow,
  ROW_H,
  ROW_INSET_X,
  ROW_PX,
  TAB_CONTENT_GAP,
  WINDOW_FAMILY_PAD,
  type WindowLayers,
} from '../window-family/index.js';
import { createWindowShell } from '../window-shell.js';
import {
  MESSAGE_REMOVE_STRING_ID,
  MESSAGE_SELECT_STRING_ID,
  MESSAGE_STRINGS_TABLE,
  MESSAGE_WINDOW_TITLE_STRING_ID,
} from './text.js';
import type { UserMessage } from './types.js';

/** The window's design-px size, centred on the screen (approximation: macOS build symbols); its wood
 *  chrome is the HUD family's rather than the original's papyrus backdrop. */
export const MESSAGE_WINDOW_W = 0x1b8;
export const MESSAGE_WINDOW_H = 0xf0;
/** Body text line pitch (design px). */
const BODY_LINE_H = 14;
/** The two bottom plates (design px). */
const PLATE_W = 120;
const PLATE_H = ROW_H;

export interface MessageWindowLayout {
  readonly window: Rect;
  readonly titleRect: Rect;
  readonly closeRect: Rect;
  readonly body: Rect;
  readonly selectPlate: Rect;
  readonly removePlate: Rect;
}

export function layoutMessageWindow(
  scale: number,
  screen: { width: number; height: number },
): MessageWindowLayout {
  const px = (v: number): number => Math.round(v * scale);
  const w = px(MESSAGE_WINDOW_W);
  const h = px(MESSAGE_WINDOW_H);
  const x = Math.round((screen.width - w) / 2);
  const y = Math.round((screen.height - h) / 2);
  const pad = px(WINDOW_FAMILY_PAD);
  const headline = px(HEADLINE_H);
  const close = px(CLOSE_BOX);
  const plateH = px(PLATE_H);
  const plateW = px(PLATE_W);
  const bodyTop = y + headline + px(TAB_CONTENT_GAP);
  const platesTop = y + h - pad - plateH;
  return {
    window: { x, y, w, h },
    titleRect: { x, y, w, h: headline },
    closeRect: { x: x + w - pad - close, y: y + Math.round((headline - close) / 2), w: close, h: close },
    body: { x: x + pad, y: bodyTop, w: w - 2 * pad, h: platesTop - pad - bodyTop },
    selectPlate: { x: x + pad, y: platesTop, w: plateW, h: plateH },
    removePlate: { x: x + w - pad - plateW, y: platesTop, w: plateW, h: plateH },
  };
}

export interface MessageWindowDeps {
  readonly ctx: PanelContext;
  readonly container: Container;
  readonly onRemove: (id: number) => void;
  readonly onSelect: (id: number) => void;
}

/** The pop-up a note opens: the whole text, a Select button that centres the view, and Remove. */
export interface MessageWindow {
  open(message: UserMessage): void;
  close(): void;
  /** The id of the message shown, or null while closed. */
  current(): number | null;
  claims(x: number, y: number): boolean;
  handleClick(x: number, y: number): boolean;
  /** Re-lay the window when the screen size moved since it was drawn. */
  refresh(): void;
}

export function createMessageWindow(deps: MessageWindowDeps): MessageWindow {
  const { ctx } = deps;
  const { scale } = ctx;
  const shell = createWindowShell(deps.container);
  const back = new PixiContainer();
  shell.container.addChildAt(back, 0);
  const layers: WindowLayers = {
    ctx,
    container: shell.container,
    back,
    graphics: shell.graphics,
    runs: shell.runs,
  };

  let shown: UserMessage | null = null;
  let layout: MessageWindowLayout | null = null;
  let drawnWidth = -1;
  let drawnHeight = -1;

  const uiText = (id: number, fallback: string): string => ctx.uiString(MESSAGE_STRINGS_TABLE, id, fallback);

  /** Greedy word wrap by measured advance; `maxNative` is in native (design) px. */
  const wrap = (text: string, maxNative: number): string[] => {
    const measure = (t: string): number => {
      const run = ctx.makeText(t, 'white', ROW_PX);
      const width = run.width;
      run.destroy();
      return width;
    };
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (line !== '' && measure(candidate) > maxNative) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line !== '') lines.push(line);
    return lines;
  };

  const paint = (m: UserMessage): void => {
    shell.clear();
    clearFills(back);
    const screen = ctx.screen();
    const built = layoutMessageWindow(scale, screen);
    layout = built;
    drawnWidth = screen.width;
    drawnHeight = screen.height;
    const labels = messages().userMessages;
    paintTitledTabWindow(layers, built, [], uiText(MESSAGE_WINDOW_TITLE_STRING_ID, labels.title));
    const inset = ROW_INSET_X * scale;
    const maxNative = built.body.w / scale - 2 * ROW_INSET_X;
    const maxLines = Math.max(1, Math.floor(built.body.h / (BODY_LINE_H * scale)));
    wrap(m.text, maxNative)
      .slice(0, maxLines)
      .forEach((line, i) => {
        const run = addRun(layers, line, 'white', ROW_PX);
        const { width: rw, height: rh } = screen;
        run.place(
          Math.round(built.body.x + inset),
          Math.round(built.body.y + i * BODY_LINE_H * scale),
          scale,
          rw,
          rh,
        );
      });
    paintPlate(layers, built.selectPlate, false);
    centreRun(
      layers,
      addRun(layers, uiText(MESSAGE_SELECT_STRING_ID, labels.select), 'white', ROW_PX),
      built.selectPlate,
    );
    paintPlate(layers, built.removePlate, false);
    centreRun(
      layers,
      addRun(layers, uiText(MESSAGE_REMOVE_STRING_ID, labels.remove), 'white', ROW_PX),
      built.removePlate,
    );
  };

  const close = (): void => {
    shell.setOpen(false);
    shell.clear();
    clearFills(back);
    shown = null;
    layout = null;
  };

  return {
    open: (m): void => {
      shown = m;
      shell.setOpen(true);
      paint(m);
    },
    close,
    current: () => shown?.id ?? null,
    claims: (x, y) => shell.claims(layout?.window ?? null, x, y),
    handleClick: (x, y): boolean => {
      if (shown === null || layout === null || !shell.claims(layout.window, x, y)) return false;
      const id = shown.id;
      if (contains(layout.closeRect, x, y)) close();
      else if (contains(layout.selectPlate, x, y)) {
        // Closing first keeps the window off the spot the view is about to centre on (approximation).
        close();
        deps.onSelect(id);
      } else if (contains(layout.removePlate, x, y)) {
        close();
        deps.onRemove(id);
      }
      return true;
    },
    refresh: (): void => {
      if (shown === null) return;
      const screen = ctx.screen();
      if (screen.width !== drawnWidth || screen.height !== drawnHeight) paint(shown);
    },
  };
}
